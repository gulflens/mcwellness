/// <reference lib="webworker" />
import { precacheAndRoute } from 'workbox-precaching';

/**
 * The practitioner app's service worker (docs/SPEC/practitioner-phone.md
 * section 3.2, docs/CHANGE-REQUESTS/session-capture-02.md section 1d).
 *
 * **What it is for.** A practitioner who opens the app with no signal at all
 * gets the browser's offline page, because nothing has cached the shell. The
 * outbox survives that on its own — IndexedDB is not the HTTP cache — but the
 * app they would resume the visit in does not load. This is the other half.
 *
 * **Why a precache and not runtime caching alone** (decision 1). A runtime
 * cache holds only what was opened while online, so a chunk or a font subset
 * never fetched online is missing in the lift. `vite-plugin-pwa` in
 * `injectManifest` mode writes the whole build's hashed asset list into
 * `self.__WB_MANIFEST` below, so the precache holds it by construction.
 * Everything else is this file's own, in the shape the change request drafted
 * by hand.
 *
 * **Three runtime rules and no others:**
 *
 *   1. a navigation is network-first and falls back to the cached shell, so
 *      the app opens with no signal and the outbox can resume the visit —
 *      except that the day map's own document is never written into that
 *      cache (`WIDENED_DOCUMENTS` below);
 *   2. `/assets/*` is served from the precache, because it is immutable and
 *      hashed;
 *   3. exactly the GET reads section 3.4 names keep their last good answer,
 *      network-first, one entry per query string — so one day sheet per date
 *      is kept rather than one overwriting another.
 *
 * **Nothing else touching `/api` is cached, ever**: no POST, no PUT, no close,
 * no signed link, no audit read, no check-in context, nothing under
 * `/api/sessions/:id`, `/api/kit`, `/api/billing` or `/api/me`. The list below
 * is the whole of it, matched on the path alone.
 *
 * **And two messages**: `forget-reads` empties the read cache, and a `sync`
 * event tagged `session-outbox` posts `flush-outbox` to every open client
 * rather than re-implementing the outbox in here. The queue lives in the
 * page's IndexedDB and is flushed by the page; where there is no client, it
 * waits for the next open, which is what iOS does in every case anyway.
 */

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: { url: string; revision: string | null }[];
};

const SHELL = 'mcwellness-shell-v1';
const READS = 'mcwellness-reads-v1';
const KEEP = [SHELL, READS];

/**
 * The read routes whose last good answer is worth keeping (section 3.4).
 * Matched on the path alone; a query string is part of the cache key, so one
 * day sheet per date is kept and one picture per fingerprint.
 *
 * Every one of these is a read of the practitioner's own day. Nothing here
 * carries a clinical note, a balance, a signed link or a consent, and nothing
 * under `/api/sessions/:id` is here at all: a visit in progress is the
 * outbox's, not the HTTP cache's.
 */
/**
 * The addresses the API serves with a wider content security policy, because
 * a browser map cannot run under the strict one
 * (`MAP_DOCUMENT_PATHS` in app/api/_middleware/security.ts, docs/SECURITY.md).
 *
 * **Why the worker has to know.** The shell cache is keyed on `/` alone, so
 * whatever document was last fetched successfully answers every later
 * navigation that has no signal. One visit to the day map would therefore make
 * that widened document this device's shell, and an offline navigation to
 * Clients, to the practitioner's Today, to the sign-in form would boot the
 * whole app under `'unsafe-eval'` and `'strict-dynamic'` (the re-check of pull
 * request 121). The map returns a page to a signed-out visitor too, so one
 * visit to that address by anybody is enough.
 *
 * Reading still falls back to the cached shell for this path, which is honest:
 * with no signal the map cannot draw anyway, and the page says so.
 *
 * The list is duplicated here rather than imported because the worker is its
 * own bundle and the API's copy is server code. It is one line in both places
 * and `tests/security/headers.test.ts` pins the server's.
 */
const WIDENED_DOCUMENTS = ['/admin/schedule/map', '/admin/clients/pin'];

/**
 * Whether this navigation is for one of them. The path is decoded first, as
 * the API's own router decodes it before matching (`decodeURI`, which leaves
 * `%2F` alone), so `/admin/schedule/%6dap` — served widened — is recognised
 * here too. A malformed escape is not one of these paths and is not this
 * function's business to complain about.
 */
function isWidenedDocument(pathname: string): boolean {
  try {
    return WIDENED_DOCUMENTS.includes(decodeURI(pathname));
  } catch {
    return false;
  }
}

const CACHEABLE_READS = [
  '/api/appointments',
  '/api/sessions/service-types',
  '/api/routing/day',
  '/api/routing/day-picture',
];

// The whole build, written in at build time. This is the line that makes the
// app open in a lift it has never been in.
precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener('install', (event) => {
  // The shell itself, so a navigation to any address falls back to something.
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.add('/'))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith('mcwellness-') && !KEEP.includes(name))
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(
  request: Request,
  cacheName: string,
  options: { fallbackRequest?: Request; keepTheAnswer?: boolean } = {},
): Promise<Response> {
  const { fallbackRequest, keepTheAnswer = true } = options;
  const cache = await caches.open(cacheName);
  const key = fallbackRequest ?? request;
  try {
    const response = await fetch(request);
    // `no-store` on the answer does not stop this: Cache.put is an explicit
    // act by this worker, not the HTTP cache obeying a header, and keeping the
    // day the practitioner last saw is the whole point (section 3.4).
    if (keepTheAnswer && response.ok) await cache.put(key, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(key);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      networkFirst(request, SHELL, {
        fallbackRequest: new Request('/'),
        // Read from the shell, never written into it: this document carries a
        // policy no other screen of the practice may be rendered under.
        keepTheAnswer: !isWidenedDocument(url.pathname),
      }),
    );
    return;
  }
  if (CACHEABLE_READS.includes(url.pathname)) {
    event.respondWith(networkFirst(request, READS));
  }
  // Everything else — every write, every other read — goes to the network
  // untouched, and fails when there is none. That is the honest answer.
});

// Background sync where the browser has it (Android Chrome). `SyncEvent` is
// not in the standard lib, so the shape is named here rather than imported.
type SyncLikeEvent = ExtendableEvent & { tag: string };

self.addEventListener('sync', ((event: SyncLikeEvent) => {
  if (event.tag !== 'session-outbox') return;
  event.waitUntil(
    self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
      for (const client of clients) client.postMessage({ type: 'flush-outbox' });
    }),
  );
}) as EventListener);

self.addEventListener('message', ((event: ExtendableMessageEvent) => {
  // Sign-out clears every cached read: the day sheet holds a given name and an
  // initial, and a signed-out device keeps nothing of anybody
  // (section 3.5, .claude/rules/compliance.md).
  if ((event.data as { type?: string } | null)?.type === 'forget-reads') {
    event.waitUntil(caches.delete(READS));
  }
}) as EventListener);
