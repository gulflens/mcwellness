// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The service worker's own rules (docs/SPEC/practitioner-phone.md section 3.2,
 * docs/CHANGE-REQUESTS/session-capture-02.md section 1d), exercised against
 * the file itself with a fake scope.
 *
 * **Why a test and not only the drill.** The worker is thirty lines of policy
 * about what is kept and what is never kept, and "never kept" is exactly the
 * kind of claim a manual walk cannot prove: opening the app in a lift shows
 * that the day is there, and shows nothing at all about whether a signed link
 * or a check-in context went into a cache beside it. So the three rules and
 * the two messages are asserted here, one by one, and the drill in section 13
 * proves the whole thing on a real browser.
 *
 * The scope is a fake because a service worker has no `window`: the module
 * registers its listeners on `self`, so `self` is replaced with an object that
 * collects them and each is then called with an event of the right shape.
 */

vi.mock('workbox-precaching', () => ({ precacheAndRoute: vi.fn() }));

type Listener = (event: Record<string, unknown>) => void;

type FakeCache = {
  put: (key: Request | string, response: Response) => Promise<void>;
  match: (key: Request | string) => Promise<Response | undefined>;
  add: (key: string) => Promise<void>;
  entries: Map<string, Response>;
};

const caches = new Map<string, FakeCache>();
let listeners: Record<string, Listener>;
let fetchImpl: ReturnType<typeof vi.fn>;
let posted: unknown[];

function keyOf(key: Request | string): string {
  return typeof key === 'string' ? key : key.url;
}

function fakeCache(): FakeCache {
  const entries = new Map<string, Response>();
  return {
    entries,
    put: async (key, response) => {
      entries.set(keyOf(key), response);
    },
    match: async (key) => entries.get(keyOf(key)),
    add: async (key) => {
      entries.set(new Request(key).url, new Response('the shell'));
    },
  };
}

const cacheStorage = {
  open: async (name: string) => {
    const existing = caches.get(name);
    if (existing) return existing;
    const made = fakeCache();
    caches.set(name, made);
    return made;
  },
  keys: async () => [...caches.keys()],
  delete: async (name: string) => caches.delete(name),
  match: async () => undefined,
};

/** Runs the fetch listener and hands back what it decided to respond with. */
async function handleFetch(request: Request): Promise<Response | 'not handled'> {
  let answered: Promise<Response> | null = null;
  listeners.fetch?.({
    request,
    respondWith: (value: Promise<Response>) => {
      answered = value;
    },
  } as unknown as Record<string, unknown>);
  if (answered === null) return 'not handled';
  return answered;
}

beforeEach(async () => {
  vi.resetModules();
  caches.clear();
  listeners = {};
  posted = [];
  fetchImpl = vi.fn(async (request: Request) => new Response(`live ${request.url}`));

  const scope = {
    location: { origin: 'https://app.example.com' },
    addEventListener: (name: string, listener: Listener) => {
      listeners[name] = listener;
    },
    skipWaiting: vi.fn(async () => undefined),
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async () => [{ postMessage: (message: unknown) => posted.push(message) }]),
    },
    __WB_MANIFEST: [],
  };
  vi.stubGlobal('self', scope);
  vi.stubGlobal('caches', cacheStorage);
  vi.stubGlobal('fetch', fetchImpl);
  // A service worker resolves a relative address against its own script URL;
  // Node's Request has no base at all and refuses one. The shim gives the
  // worker's own `new Request('/')` the base a browser would have given it.
  const Real = Request;
  vi.stubGlobal(
    'Request',
    class extends Real {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(
          typeof input === 'string' ? new URL(input, 'https://app.example.com').toString() : input,
          init,
        );
      }
    },
  );
  await import('./sw');
  // Install and activate, as a browser would.
  const waited: Promise<unknown>[] = [];
  listeners.install?.({ waitUntil: (work: Promise<unknown>) => waited.push(work) } as never);
  listeners.activate?.({ waitUntil: (work: Promise<unknown>) => waited.push(work) } as never);
  await Promise.all(waited);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const day = () => new Request('https://app.example.com/api/appointments?date=2026-09-07&scope=own');

describe('rule 1: a navigation falls back to the cached shell', () => {
  it('serves the shell when the network is gone', async () => {
    const navigation = new Request('https://app.example.com/today/check-in');
    Object.defineProperty(navigation, 'mode', { value: 'navigate' });
    fetchImpl.mockRejectedValueOnce(new Error('offline'));
    const response = await handleFetch(navigation);
    expect(response).not.toBe('not handled');
    expect(await (response as Response).text()).toBe('the shell');
  });
});

describe('rule 3: the named reads keep their last good answer', () => {
  it('keeps one entry per query string, so two dates are two answers', async () => {
    await handleFetch(day());
    fetchImpl.mockRejectedValue(new Error('offline'));
    const offline = await handleFetch(day());
    expect(await (offline as Response).text()).toContain('/api/appointments?date=2026-09-07');

    // A day never seen online has nothing to fall back to, and says so rather
    // than answering with a different day's sheet.
    const other = new Request('https://app.example.com/api/appointments?date=2026-09-08&scope=own');
    await expect(handleFetch(other)).rejects.toThrow('offline');
  });

  it('keeps the day, the services, the drives and the picture, and nothing else', async () => {
    for (const path of [
      '/api/appointments?date=2026-09-07&scope=own',
      '/api/sessions/service-types',
      '/api/routing/day?date=2026-09-07',
      '/api/routing/day-picture?date=2026-09-07&v=3-abc',
    ]) {
      await handleFetch(new Request(`https://app.example.com${path}`));
    }
    const reads = caches.get('mcwellness-reads-v1');
    expect([...(reads?.entries.keys() ?? [])]).toHaveLength(4);
  });
});

describe('what is never cached, ever', () => {
  it('leaves every write, every signed link and every other read alone', async () => {
    const never = [
      ['GET', '/api/me'],
      ['GET', '/api/kit'],
      ['GET', '/api/billing/clients/x/stop-balance'],
      ['GET', '/api/sessions/00000000-0000-4000-8000-000000000001/photo'],
      ['GET', '/api/sessions/photo/00000000-0000-4000-8000-0000000000f9/link'],
      ['GET', '/api/audit/timeline'],
      ['POST', '/api/sessions/00000000-0000-4000-8000-000000000001/events'],
      ['PUT', '/api/sessions/00000000-0000-4000-8000-000000000001/photo'],
      ['POST', '/api/sessions/00000000-0000-4000-8000-000000000001/close'],
    ] as const;
    for (const [method, path] of never) {
      const answer = await handleFetch(new Request(`https://app.example.com${path}`, { method }));
      expect(answer, `${method} ${path}`).toBe('not handled');
    }
    expect(caches.get('mcwellness-reads-v1')).toBeUndefined();
  });

  it('leaves another origin alone entirely', async () => {
    expect(await handleFetch(new Request('https://maps.googleapis.com/maps/api/staticmap'))).toBe(
      'not handled',
    );
  });
});

describe('the two messages', () => {
  it('empties the cached reads on sign-out, and keeps the shell', async () => {
    await handleFetch(day());
    expect(caches.get('mcwellness-reads-v1')?.entries.size).toBe(1);

    const waited: Promise<unknown>[] = [];
    listeners.message?.({
      data: { type: 'forget-reads' },
      waitUntil: (work: Promise<unknown>) => waited.push(work),
    } as never);
    await Promise.all(waited);

    expect(caches.has('mcwellness-reads-v1')).toBe(false);
    // The shell is not a person's day and stays: an app that would not open
    // after a sign-out is an app nobody can sign into again in a basement.
    expect(caches.has('mcwellness-shell-v1')).toBe(true);
  });

  it('wakes the page to flush rather than re-implementing the outbox', async () => {
    const waited: Promise<unknown>[] = [];
    listeners.sync?.({
      tag: 'session-outbox',
      waitUntil: (work: Promise<unknown>) => waited.push(work),
    } as never);
    await Promise.all(waited);
    expect(posted).toEqual([{ type: 'flush-outbox' }]);

    posted.length = 0;
    listeners.sync?.({ tag: 'something-else', waitUntil: () => undefined } as never);
    expect(posted).toEqual([]);
  });
});
