// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  keptSessionStorage,
  readKeepSignedIn,
  readSessionStore,
  writeKeepSignedIn,
  writeSessionStore,
} from './session-storage';

/** The key Supabase itself would use. The adapter never reads its shape. */
const KEY = 'sb-test-auth-token';

function clearBoth() {
  localStorage.clear();
  sessionStorage.clear();
}

beforeEach(clearBoth);
afterEach(() => {
  vi.restoreAllMocks();
  clearBoth();
});

describe('the keep-me-signed-in flag', () => {
  it('is ticked on a browser that has never been asked', () => {
    expect(readKeepSignedIn()).toBe(true);
  });

  it('remembers the last answer for this browser', () => {
    writeKeepSignedIn(true);
    expect(readKeepSignedIn()).toBe(true);
    writeKeepSignedIn(false);
    expect(readKeepSignedIn()).toBe(false);
  });

  it('reads ticked on a browser whose storage is shut, and does not throw writing to it', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage is not available');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage is not available');
    });
    expect(readKeepSignedIn()).toBe(true);
    expect(() => writeKeepSignedIn(false)).not.toThrow();
  });
});

describe('the store the last sign-in named', () => {
  it('is the device on a browser that has never signed in', () => {
    expect(readSessionStore()).toBe('device');
  });

  it('remembers what the last sign-in answered', () => {
    writeSessionStore('tab');
    expect(readSessionStore()).toBe('tab');
    writeSessionStore('device');
    expect(readSessionStore()).toBe('device');
  });

  it('reads the device on a browser whose storage is shut, and does not throw writing to it', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage is not available');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage is not available');
    });
    expect(readSessionStore()).toBe('device');
    expect(() => writeSessionStore('tab')).not.toThrow();
  });
});

describe('where the session is kept', () => {
  it('keeps the session past the browser closing when the last sign-in said device', () => {
    writeSessionStore('device');
    keptSessionStorage().setItem(KEY, 'a-session');
    expect(localStorage.getItem(KEY)).toBe('a-session');
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('ends the session with the tab when the last sign-in said tab', () => {
    writeSessionStore('tab');
    keptSessionStorage().setItem(KEY, 'a-session');
    expect(sessionStorage.getItem(KEY)).toBe('a-session');
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('moves a session to the store the newest sign-in names, leaving no copy behind', () => {
    const store = keptSessionStorage();
    // A sign-in, then a session; then a second sign-in answering the other way.
    writeSessionStore('tab');
    store.setItem(KEY, 'first');
    writeSessionStore('device');
    store.setItem(KEY, 'second');
    expect(localStorage.getItem(KEY)).toBe('second');
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('does not move a held session when the tick box alone is toggled', () => {
    const store = keptSessionStorage();
    writeSessionStore('tab');
    store.setItem(KEY, 'a-session');
    // The box on the sign-in page, ticked with no sign-in behind it. Supabase
    // then refreshes the token, which writes the session again.
    writeKeepSignedIn(true);
    store.setItem(KEY, 'a-refreshed-session');
    expect(sessionStorage.getItem(KEY)).toBe('a-refreshed-session');
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('keeps a session on the device when no sign-in has named a store', () => {
    const store = keptSessionStorage();
    // A browser that signed in before this round: nothing has answered, and
    // the device is where every session was kept until now.
    store.setItem(KEY, 'a-session');
    expect(localStorage.getItem(KEY)).toBe('a-session');
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('finds a session held either way, and nothing when there is nothing', () => {
    const store = keptSessionStorage();
    localStorage.setItem(KEY, 'kept');
    expect(store.getItem(KEY)).toBe('kept');
    localStorage.clear();
    sessionStorage.setItem(KEY, 'this visit only');
    expect(store.getItem(KEY)).toBe('this visit only');
    sessionStorage.clear();
    expect(store.getItem(KEY)).toBeNull();
  });

  it('clears both stores when the session is removed', () => {
    localStorage.setItem(KEY, 'kept');
    sessionStorage.setItem(KEY, 'this visit only');
    keptSessionStorage().removeItem(KEY);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('answers nothing rather than throwing on a browser whose storage is shut', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage is not available');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage is not available');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage is not available');
    });
    const store = keptSessionStorage();
    expect(store.getItem(KEY)).toBeNull();
    expect(() => store.setItem(KEY, 'a-session')).not.toThrow();
    expect(() => store.removeItem(KEY)).not.toThrow();
  });
});
