import { useSyncExternalStore } from 'react';

/**
 * A window left open keeps running the build it started with.
 *
 * The console is a single-page app, and an installed one at that: it fetches
 * its own code once, when the document loads, and moving from Clients to
 * Billing never asks the server for the app again. A window opened on Monday
 * is still Monday's code on Thursday, however many passes have gone live since,
 * and an installed window has no reload button to suggest otherwise. The owner
 * met exactly this on 2026-09-20: a change live for nine hours, and a screen
 * that had not changed.
 *
 * So the window asks. When it is looked at again it fetches the page it was
 * loaded from and reads the name of the entry script out of it. Vite names that
 * file by its contents, so a different name is a different build. Nothing else
 * happens here: this module only ever *knows*. What is done about it is the
 * rail's (`app/shell/components/Rail.tsx`): the next time a section is chosen,
 * the link is an ordinary one and the browser loads the document afresh.
 *
 * **Why it never reloads by itself.** A form half filled, a drawer open, a
 * payment being taken: a page that reloads under somebody loses their work.
 * Choosing a section is the one moment the person has already decided to leave
 * the screen they are on.
 *
 * **Why it does not ask the service worker to update.** `registration.update()`
 * would find the new build too, and would be worse: the new worker takes the
 * window over at once (`app/shell/sw.ts` skips waiting and claims), and clears
 * the old build's files out of the precache as it does. The window would then
 * be old code holding the names of screen files that no longer exist anywhere,
 * and the next screen it opened lazily would fail to load. This module does not
 * bring that state about. The browser can, by itself: it re-checks the worker's
 * script when another window in scope navigates, and on any request once the
 * registration is a day old. A window that has been taken over that way is
 * exactly the window this reload mends, which is the better half of the case
 * for it.
 *
 * **What it sends.** `GET /`, with no cookies and no cache. The answer is the
 * public shell every visitor is handed before they sign in. No personal data
 * travels either way, and a failure of any kind reads as "nothing new".
 */

/** Looked at again sooner than this, the window does not ask twice. */
const AT_MOST_EVERY_MS = 5 * 60_000;

// A `<script>` whose source is the build's hashed entry. Only the tag and its
// `src` are asked for: the order of a tag's attributes is the bundler's to
// choose, and a pattern that depended on it would fail silently the day that
// changed, leaving the feature switched off with nothing to say so. A preload
// of the same file is a `<link>`, and is not matched.
const ENTRY = /<script\b[^>]*\ssrc="\/assets\/(index-[A-Za-z0-9_-]+\.js)"/;

/** The entry script a page starts from, or null where there is no built one. */
export function entryOf(html: string): string | null {
  return ENTRY.exec(html)?.[1] ?? null;
}

let ready = false;
const listeners = new Set<() => void>();
let stop: (() => void) | null = null;

export function isNewBuildReady(): boolean {
  return ready;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True once the site serves a build other than the one this window runs. */
export function useNewBuildReady(): boolean {
  return useSyncExternalStore(subscribe, isNewBuildReady, () => false);
}

export function watchForNewBuild(options: {
  /** The entry this window is running; null on a dev server, where nothing is watched. */
  running: string | null;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): { check: () => Promise<void>; subscribe: typeof subscribe } {
  const { running, fetchImpl = fetch, now = Date.now } = options;
  // When an answer last *arrived*. A question that got no answer does not
  // count, so the next look asks again at once rather than in five minutes.
  let lastAnswered: number | null = null;
  // Focus and visibility arrive together; one question is enough.
  let asking = false;

  const check = async (): Promise<void> => {
    if (running === null || ready || asking) return;
    const at = now();
    if (lastAnswered !== null && at - lastAnswered < AT_MOST_EVERY_MS) return;
    asking = true;
    try {
      const response = await fetchImpl('/', { cache: 'no-store', credentials: 'omit' });
      if (!response.ok) return;
      const served = entryOf(await response.text());
      if (served === null) return;
      lastAnswered = at;
      if (served !== running) {
        ready = true;
        for (const listener of listeners) listener();
      }
    } catch {
      // No signal, or the host mid-deploy. Nothing is known, so nothing changes,
      // and the next look asks again.
    } finally {
      asking = false;
    }
  };

  // One watcher at a time: a second start takes the first one's listeners down
  // rather than leaving two asking the same question.
  stop?.();
  stop = null;
  if (running !== null) {
    const onLook = () => {
      if (document.visibilityState === 'visible') void check();
    };
    window.addEventListener('focus', onLook);
    document.addEventListener('visibilitychange', onLook);
    stop = () => {
      window.removeEventListener('focus', onLook);
      document.removeEventListener('visibilitychange', onLook);
    };
  }

  return { check, subscribe };
}

/**
 * Go to an address and load the document afresh, even where the address is
 * another part of the page already open. A link alone cannot do that: from
 * `/admin/billing` to `/admin/billing#invoices` is a fragment move, and a
 * fragment move loads nothing however ordinary the link is. Setting the
 * address first keeps the row the person chose; the reload brings the build.
 */
export function reloadAt(to: string): void {
  window.location.assign(to);
  window.location.reload();
}

/** The entry script of the document this code is running in. */
export function runningEntry(): string | null {
  return entryOf(document.documentElement.outerHTML);
}

export function resetFreshBuildForTests(): void {
  ready = false;
  listeners.clear();
  stop?.();
  stop = null;
}
