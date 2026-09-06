/**
 * Where this browser keeps a session, and the one answer that decides it.
 *
 * "Keep me signed in" is the person's own answer to a plain question: should
 * closing the browser sign them out? Ticked, the session is written to
 * `localStorage` and survives the browser closing. Unticked — the default, on
 * a shared laptop or a hotel machine — it is written to `sessionStorage` and
 * goes when the tab does.
 *
 * The Supabase client is created once, before anybody has answered anything,
 * so the choice cannot be a client option. It is a store of our own that reads
 * the answer at the moment of each write: `keptSessionStorage`. The answer
 * itself is written at sign-in time, before the sign-in call runs.
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

const KEEP_KEY = 'mcwellness.keep-signed-in';

function attempt<T>(action: () => T, fallback: T): T {
  try {
    return action();
  } catch {
    return fallback;
  }
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
     * The store the newest answer names, and never a copy left in the other:
     * a person who unticks the box and signs in again has said the session
     * should not outlive the browser, and a stale copy would outlive it.
     */
    setItem(key, value) {
      const keep = readKeepSignedIn();
      const into = keep ? window.localStorage : window.sessionStorage;
      const outOf = keep ? window.sessionStorage : window.localStorage;
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
