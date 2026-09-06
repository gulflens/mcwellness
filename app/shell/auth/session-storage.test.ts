// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keptSessionStorage, readKeepSignedIn, writeKeepSignedIn } from './session-storage';

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
  it('is off on a browser that has never been asked', () => {
    expect(readKeepSignedIn()).toBe(false);
  });

  it('remembers the last answer for this browser', () => {
    writeKeepSignedIn(true);
    expect(readKeepSignedIn()).toBe(true);
    writeKeepSignedIn(false);
    expect(readKeepSignedIn()).toBe(false);
  });

  it('reads off on a browser whose storage is shut, and does not throw writing to it', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage is not available');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage is not available');
    });
    expect(readKeepSignedIn()).toBe(false);
    expect(() => writeKeepSignedIn(true)).not.toThrow();
  });
});

describe('where the session is kept', () => {
  it('keeps the session past the browser closing when the flag is on', () => {
    writeKeepSignedIn(true);
    keptSessionStorage().setItem(KEY, 'a-session');
    expect(localStorage.getItem(KEY)).toBe('a-session');
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it('ends the session with the browser when the flag is off', () => {
    writeKeepSignedIn(false);
    keptSessionStorage().setItem(KEY, 'a-session');
    expect(sessionStorage.getItem(KEY)).toBe('a-session');
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('moves a session to the store the newest answer names, leaving no copy behind', () => {
    const store = keptSessionStorage();
    writeKeepSignedIn(false);
    store.setItem(KEY, 'first');
    writeKeepSignedIn(true);
    store.setItem(KEY, 'second');
    expect(localStorage.getItem(KEY)).toBe('second');
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
