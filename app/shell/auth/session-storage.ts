/**
 * Where this browser keeps a session, and the answer that decides it.
 *
 * Two memories, and keeping them apart is the whole point of this file.
 *
 * The first is the **store the last sign-in named**: `device`, where the
 * session is written to `localStorage` and survives the browser closing, or
 * `tab`, where it is written to `sessionStorage` and goes when the tab does.
 * It is the only thing `keptSessionStorage` reads, and it is written in one
 * place only — inside `supabaseAuth.signIn`, before the sign-in call runs.
 * That matters because Supabase writes the session on every token refresh and
 * not only at sign-in: a store read from anything a person can change without
 * signing in again would move a live session out from under them, into a
 * place they never asked for.
 *
 * The second is the **tick box's own memory**, so the box on the sign-in page
 * opens where this browser left it. The sign-in page writes it on change and
 * reads it on first render; nothing else touches it, so a toggle can never
 * move a session that is already held.
 *
 * An absent store reads `device`, which is where every session was kept
 * before this round: a session held today is neither moved nor lost.
 *
 * Every access is wrapped: a browser with storage switched off, a private
 * window, or a browser whose quota is full throws on the plain call, and none
 * of those is a reason for a sign-in page to fail. Such a browser simply holds
 * the session in memory for as long as the page is open.
 */

/** What Supabase asks of a storage adapter, and all this file promises. */
export type SessionStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/** Where a session is kept: on this device, or for this tab alone. */
export type SessionStoreName = 'device' | 'tab';

const STORE_KEY = 'mcwellness.session-store';
const KEEP_KEY = 'mcwellness.keep-signed-in';

function attempt<T>(action: () => T, fallback: T): T {
  try {
    return action();
  } catch {
    return fallback;
  }
}

/**
 * What the last sign-in on this browser answered. Nothing written, and no
 * storage at all, both read `device`: the store every session used before
 * this round, so nobody signed in today is moved or signed out by it.
 */
export function readSessionStore(): SessionStoreName {
  return attempt(
    () => (window.localStorage.getItem(STORE_KEY) === 'tab' ? 'tab' : 'device'),
    'device',
  );
}

/** Written by `supabaseAuth.signIn` and nowhere else. See the note above. */
export function writeSessionStore(store: SessionStoreName): void {
  attempt(() => window.localStorage.setItem(STORE_KEY, store), undefined);
}

/** The last answer this browser gave. No answer, and no storage at all, both read false. */
export function readKeepSignedIn(): boolean {
  return attempt(() => window.localStorage.getItem(KEEP_KEY) === 'yes', false);
}

/** Remembered per browser, so the box is where the person left it next time. */
export function writeKeepSignedIn(keep: boolean): void {
  attempt(() => window.localStorage.setItem(KEEP_KEY, keep ? 'yes' : 'no'), undefined);
}

export function keptSessionStorage(): SessionStore {
  return {
    /** Both stores, because a session already held was kept one way or the other. */
    getItem(key) {
      return (
        attempt(() => window.localStorage.getItem(key), null) ??
        attempt(() => window.sessionStorage.getItem(key), null)
      );
    },

    /**
     * The store the newest sign-in named, and never a copy left in the other:
     * a person who unticks the box and signs in again has said the session
     * should not outlive the browser, and a stale copy would outlive it.
     */
    setItem(key, value) {
      const onDevice = readSessionStore() === 'device';
      const into = onDevice ? window.localStorage : window.sessionStorage;
      const outOf = onDevice ? window.sessionStorage : window.localStorage;
      attempt(() => into.setItem(key, value), undefined);
      attempt(() => outOf.removeItem(key), undefined);
    },

    /**
     * Both stores. Supabase removes the session through this same method when
     * it signs out, so signing out clears both wherever the session was held.
     */
    removeItem(key) {
      attempt(() => window.localStorage.removeItem(key), undefined);
      attempt(() => window.sessionStorage.removeItem(key), undefined);
    },
  };
}
