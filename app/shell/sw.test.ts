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
 *
 * **`workbox-precaching` is the real thing here, not a mock.** It registers a
 * fetch listener of its own, ahead of this file's, and a browser gives the
 * first listener that calls `respondWith` the answer — so the two handlers'
 * composed behaviour is the only behaviour that matters, and mocking the
 * precache away proved the half that was never in doubt. The listeners are
 * therefore collected as lists and run in the order they were registered, as
 * a browser runs them.
 */

type Listener = (event: Record<string, unknown>) => void;

type FakeCache = {
  put: (key: Request | string, response: Response) => Promise<void>;
  match: (key: Request | string) => Promise<Response | undefined>;
  add: (key: string) => Promise<void>;
  keys: () => Promise<Request[]>;
  delete: (key: Request | string) => Promise<boolean>;
  entries: Map<string, Response>;
};

/**
 * The origin everything here is asked for. It is the environment's own rather
 * than a name of our choosing, because `workbox-precaching` resolves every
 * precached address against the global `location` — so a made-up origin would
 * put the precache's list and these requests on two different hosts, and the
 * composition this file exists to prove would never happen.
 */
const ORIGIN = location.origin;

/**
 * A precache list in the shape the build writes: hashed assets, and **no
 * `index.html`**. That absence is the point (vite.shared.ts's `globIgnores`).
 * The precache route answers a directory address by appending `index.html`, so
 * a precached one would serve `/` from the cache before this worker's own
 * listener ever ran, and rule 1's network-first navigation would not hold for
 * the root — which is the address the app actually opens at.
 */
const MANIFEST = [{ url: '/assets/app-abcdef12.js', revision: null }];

/** An install or activate event, of a class the precache will accept. */
class FakeExtendableEvent {
  readonly waited: Promise<unknown>[] = [];
  waitUntil(work: Promise<unknown>): void {
    this.waited.push(work);
  }
}

const caches = new Map<string, FakeCache>();
let listeners: Record<string, Listener[]>;
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
    keys: async () => [...entries.keys()].map((url) => new Request(url)),
    delete: async (key) => entries.delete(keyOf(key)),
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

/**
 * Runs every fetch listener in the order they were registered and hands back
 * what the first one to answer decided — which is what a browser does, and why
 * the precache being registered first is the whole question here.
 */
async function handleFetch(request: Request): Promise<Response | 'not handled'> {
  let answered: Promise<Response> | null = null;
  for (const listener of listeners.fetch ?? []) {
    if (answered !== null) break;
    listener({
      request,
      respondWith: (value: Promise<Response>) => {
        answered = value;
      },
    } as unknown as Record<string, unknown>);
  }
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
    location: { origin: ORIGIN },
    addEventListener: (name: string, listener: Listener) => {
      (listeners[name] ??= []).push(listener);
    },
    skipWaiting: vi.fn(async () => undefined),
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async () => [{ postMessage: (message: unknown) => posted.push(message) }]),
    },
    // The precache reaches for the store through `self`, not the bare global.
    caches: cacheStorage,
    __WB_MANIFEST: MANIFEST,
  };
  vi.stubGlobal('self', scope);
  vi.stubGlobal('caches', cacheStorage);
  vi.stubGlobal('fetch', fetchImpl);
  // Neither class exists outside a worker, and the precache checks both: it
  // asks `options instanceof FetchEvent` to tell an event from a plain options
  // object, and it insists an install event really is an `ExtendableEvent`. So
  // the install and activate events below are instances of the one, and
  // nothing is an instance of the other.
  vi.stubGlobal('FetchEvent', class FetchEvent {});
  vi.stubGlobal('ExtendableEvent', FakeExtendableEvent);
  // A service worker resolves a relative address against its own script URL;
  // Node's Request has no base at all and refuses one. The shim gives the
  // worker's own `new Request('/')` the base a browser would have given it.
  const Real = Request;
  vi.stubGlobal(
    'Request',
    class extends Real {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(typeof input === 'string' ? new URL(input, ORIGIN).toString() : input, init);
      }
    },
  );
  await import('./sw');
  // Install and activate, as a browser would — every listener, the precache's
  // own included.
  const event = new FakeExtendableEvent();
  for (const listener of listeners.install ?? []) listener(event as never);
  for (const listener of listeners.activate ?? []) listener(event as never);
  await Promise.all(event.waited);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const day = () => new Request(`${ORIGIN}/api/appointments?date=2026-09-07&scope=own`);

describe('rule 1: a navigation falls back to the cached shell', () => {
  it('serves the shell when the network is gone', async () => {
    const navigation = new Request(`${ORIGIN}/today/check-in`);
    Object.defineProperty(navigation, 'mode', { value: 'navigate' });
    fetchImpl.mockRejectedValueOnce(new Error('offline'));
    const response = await handleFetch(navigation);
    expect(response).not.toBe('not handled');
    expect(await (response as Response).text()).toBe('the shell');
  });

  it('holds for the root, with the real precache route registered ahead of it', async () => {
    // The precache is registered first and would answer `/` from its own cache
    // if `index.html` were in its list, before this worker's listener ever ran.
    // It is not in the list, so the root is network-first like every other
    // navigation — and the shell is what a lift gets.
    expect((listeners.fetch ?? []).length).toBeGreaterThan(1);

    const root = new Request(`${ORIGIN}/`);
    Object.defineProperty(root, 'mode', { value: 'navigate' });

    // With no signal, the shell the install put there — not a precached
    // index.html, and not the browser's offline page.
    fetchImpl.mockRejectedValueOnce(new Error('offline'));
    const offline = await handleFetch(root);
    expect(await (offline as Response).text()).toBe('the shell');

    // And with signal, the network: network-first, which is the half a
    // cache-first precache route would have taken away.
    const online = await handleFetch(root);
    expect(await (online as Response).text()).toBe(`live ${ORIGIN}/`);
  });
});

describe('rule 1, continued: the day map never becomes the offline shell', () => {
  /**
   * The day map is served with a wider content security policy than the rest
   * of the console, because a browser map needs it (docs/SECURITY.md,
   * docs/SPEC/route-planning.md section 8). The shell cache is keyed on `/`
   * alone, so whatever document was last fetched successfully is what every
   * offline navigation is answered with — and one visit to the map would
   * otherwise make that widened document the shell for Clients, for the
   * practitioner's Today, for everything (the re-check of pull request 121).
   */
  it('leaves the shell as it was when the map is opened online', async () => {
    const map = new Request(`${ORIGIN}/admin/schedule/map?date=2026-09-10`);
    Object.defineProperty(map, 'mode', { value: 'navigate' });
    const answer = await handleFetch(map);
    // The person still gets their map: only the cache is left alone.
    expect(await (answer as Response).text()).toBe(
      `live ${ORIGIN}/admin/schedule/map?date=2026-09-10`,
    );
    const shell = caches.get('mcwellness-shell-v1')?.entries.get(`${ORIGIN}/`);
    expect(await (shell as Response).text()).toBe('the shell');
  });

  it('still keeps the last console document a device saw as its shell', async () => {
    const clients = new Request(`${ORIGIN}/admin/clients`);
    Object.defineProperty(clients, 'mode', { value: 'navigate' });
    await handleFetch(clients);
    const shell = caches.get('mcwellness-shell-v1')?.entries.get(`${ORIGIN}/`);
    expect(await (shell as Response).text()).toBe(`live ${ORIGIN}/admin/clients`);
  });

  it('recognises the map however the address was written', async () => {
    // The API decodes the path before it decides which policy to serve, so
    // `/admin/schedule/%6dap` is served widened too (the near misses pinned in
    // tests/security/headers.test.ts). The worker decodes for the same reason.
    const map = new Request(`${ORIGIN}/admin/schedule/%6dap`);
    Object.defineProperty(map, 'mode', { value: 'navigate' });
    await handleFetch(map);
    const shell = caches.get('mcwellness-shell-v1')?.entries.get(`${ORIGIN}/`);
    expect(await (shell as Response).text()).toBe('the shell');
  });

  it('still answers the map from the shell when there is no signal, rather than nothing', async () => {
    // Offline the map cannot draw anyway and the page says so; what matters
    // is that the app opens at all.
    const map = new Request(`${ORIGIN}/admin/schedule/map`);
    Object.defineProperty(map, 'mode', { value: 'navigate' });
    fetchImpl.mockRejectedValueOnce(new Error('offline'));
    const answer = await handleFetch(map);
    expect(await (answer as Response).text()).toBe('the shell');
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
    const other = new Request(`${ORIGIN}/api/appointments?date=2026-09-08&scope=own`);
    await expect(handleFetch(other)).rejects.toThrow('offline');
  });

  it('keeps the day, the services, the drives and the picture, and nothing else', async () => {
    for (const path of [
      '/api/appointments?date=2026-09-07&scope=own',
      '/api/sessions/service-types',
      '/api/routing/day?date=2026-09-07',
      '/api/routing/day-picture?date=2026-09-07&v=3-abc',
    ]) {
      await handleFetch(new Request(`${ORIGIN}${path}`));
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
      // A signed link: fetched fresh or not at all, because a cached one
      // outlives its own expiry.
      ['GET', '/api/assessments/file/00000000-0000-4000-8000-0000000000f9/link'],
      ['GET', '/api/audit/timeline'],
      ['POST', '/api/sessions/00000000-0000-4000-8000-000000000001/events'],
      ['POST', '/api/sessions/00000000-0000-4000-8000-000000000001/close'],
      // A path the API does not answer at all, which is the same answer: the
      // worker handles what it names and nothing else.
      ['GET', '/api/sessions/00000000-0000-4000-8000-000000000001/no-such-thing'],
    ] as const;
    for (const [method, path] of never) {
      const answer = await handleFetch(new Request(`${ORIGIN}${path}`, { method }));
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
    for (const listener of listeners.message ?? []) {
      listener({
        data: { type: 'forget-reads' },
        waitUntil: (work: Promise<unknown>) => waited.push(work),
      } as never);
    }
    await Promise.all(waited);

    expect(caches.has('mcwellness-reads-v1')).toBe(false);
    // The shell is not a person's day and stays: an app that would not open
    // after a sign-out is an app nobody can sign into again in a basement.
    expect(caches.has('mcwellness-shell-v1')).toBe(true);
  });

  it('wakes the page to flush rather than re-implementing the outbox', async () => {
    const waited: Promise<unknown>[] = [];
    for (const listener of listeners.sync ?? []) {
      listener({
        tag: 'session-outbox',
        waitUntil: (work: Promise<unknown>) => waited.push(work),
      } as never);
    }
    await Promise.all(waited);
    expect(posted).toEqual([{ type: 'flush-outbox' }]);

    posted.length = 0;
    for (const listener of listeners.sync ?? []) {
      listener({ tag: 'something-else', waitUntil: () => undefined } as never);
    }
    expect(posted).toEqual([]);
  });
});
