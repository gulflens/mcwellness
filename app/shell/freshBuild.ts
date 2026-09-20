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
 * **Why it leaves the service worker alone.** Asking the worker to update
 * (`registration.update()`) would work too, and would be worse: the new worker
 * takes the window over at once (`app/shell/sw.ts` skips waiting and claims),
 * and clears the old build's files out of the precache as it does. The window
 * would then be old code holding the names of screen files that no longer exist
 * anywhere, and the next screen it opened lazily would fail to load. Left
 * alone, the old window keeps the old worker and the old worker keeps every
 * file that window can ask for, until the reload replaces all three together.
 *
 * **What it sends.** `GET /`, with no cookies and no cache. The answer is the
 * public shell every visitor is handed before they sign in. No personal data
 * travels either way, and a failure of any kind reads as "nothing new".
 */

/** Looked at again sooner than this, the window does not ask twice. */
const AT_MOST_EVERY_MS = 5 * 60_000;

const ENTRY = /<script[^>]+type="module"[^>]+src="\/assets\/(index-[A-Za-z0-9_-]+\.js)"/;

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
  let lastAsked: number | null = null;

  const check = async (): Promise<void> => {
    if (running === null || ready) return;
    const at = now();
    if (lastAsked !== null && at - lastAsked < AT_MOST_EVERY_MS) return;
    lastAsked = at;
    try {
      const response = await fetchImpl('/', { cache: 'no-store', credentials: 'omit' });
      if (!response.ok) return;
      const served = entryOf(await response.text());
      if (served !== null && served !== running) {
        ready = true;
        for (const listener of listeners) listener();
      }
    } catch {
      // No signal, or the host mid-deploy. Nothing is known, so nothing changes;
      // the next look asks again.
    }
  };

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
