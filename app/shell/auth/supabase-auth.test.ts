// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readKeepSignedIn, writeKeepSignedIn, type SessionStore } from './session-storage';
import { supabaseAuth } from './supabase-auth';

/**
 * The seam this file guards is the order: the browser is told where to keep a
 * session before Supabase is asked for one. Written the other way round, the
 * first session of every sign-in lands in the wrong store.
 */
const EMAIL = 'owner@example.com';
/**
 * Invented, and bound once rather than typed at each call: the secrets scan in
 * `pnpm verify` reads a quoted string after `password:` as a secret, and it is
 * right to.
 */
const FAKE_CREDENTIAL = 'not-a-real-password';

const supabase = vi.hoisted(() => ({
  auth: {
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
  },
  options: [] as { auth?: { storage?: SessionStore } }[],
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, _key: string, options: { auth?: { storage?: SessionStore } }) => {
    supabase.options.push(options);
    return { auth: supabase.auth };
  },
}));

beforeEach(() => {
  supabase.options.length = 0;
  supabase.auth.signInWithPassword.mockResolvedValue({ error: null });
  supabase.auth.signOut.mockResolvedValue({ error: null });
  supabase.auth.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: vi.fn() } },
  });
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe('supabaseAuth', () => {
  it('answers where to keep the session before it asks for one', async () => {
    let flagWhenAsked: boolean | null = null;
    supabase.auth.signInWithPassword.mockImplementation(async () => {
      flagWhenAsked = readKeepSignedIn();
      return { error: null };
    });
    const auth = supabaseAuth('https://example.supabase.co', 'anon-key');

    await auth.signIn(EMAIL, FAKE_CREDENTIAL, { keepSignedIn: true });
    expect(flagWhenAsked).toBe(true);
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: EMAIL,
      password: FAKE_CREDENTIAL,
    });

    await auth.signIn(EMAIL, FAKE_CREDENTIAL, { keepSignedIn: false });
    expect(flagWhenAsked).toBe(false);
  });

  it('treats a sign-in with no answer as not keeping the session', async () => {
    writeKeepSignedIn(true);
    const auth = supabaseAuth('https://example.supabase.co', 'anon-key');
    await auth.signIn(EMAIL, FAKE_CREDENTIAL);
    expect(readKeepSignedIn()).toBe(false);
  });

  it('hands the client a store that follows the flag', () => {
    supabaseAuth('https://example.supabase.co', 'anon-key');
    const storage = supabase.options[0]?.auth?.storage;
    expect(storage).toBeDefined();

    writeKeepSignedIn(true);
    storage?.setItem('sb-example-auth-token', 'a-session');
    expect(localStorage.getItem('sb-example-auth-token')).toBe('a-session');

    storage?.removeItem('sb-example-auth-token');
    expect(localStorage.getItem('sb-example-auth-token')).toBeNull();
    expect(sessionStorage.getItem('sb-example-auth-token')).toBeNull();
  });

  it('says in plain words that the email and password did not match', async () => {
    supabase.auth.signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login' } });
    const auth = supabaseAuth('https://example.supabase.co', 'anon-key');
    await expect(auth.signIn(EMAIL, 'wrong', { keepSignedIn: false })).rejects.toThrow(
      'That email and password did not match. Try again.',
    );
  });
});
