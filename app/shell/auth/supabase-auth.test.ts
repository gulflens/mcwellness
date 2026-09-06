// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readKeepSignedIn,
  readSessionStore,
  writeKeepSignedIn,
  writeSessionStore,
  type SessionStore,
} from './session-storage';
import { supabaseAuth } from './supabase-auth';

/**
 * The seam this file guards is the order: the browser is told where to keep a
 * session before Supabase is asked for one. Written the other way round, the
 * first session of every sign-in lands in the wrong store. The second seam is
 * that this is the only place the store is written at all, so a token refresh
 * follows the last sign-in and never the tick box.
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
    let storeWhenAsked: string | null = null;
    supabase.auth.signInWithPassword.mockImplementation(async () => {
      storeWhenAsked = readSessionStore();
      return { error: null };
    });
    const auth = supabaseAuth('https://example.supabase.co', 'anon-key');

    await auth.signIn(EMAIL, FAKE_CREDENTIAL, { keepSignedIn: true });
    expect(storeWhenAsked).toBe('device');
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: EMAIL,
      password: FAKE_CREDENTIAL,
    });

    await auth.signIn(EMAIL, FAKE_CREDENTIAL, { keepSignedIn: false });
    expect(storeWhenAsked).toBe('tab');
  });

  /**
   * The portal's invitation sign-in (app/client/InvitePage.tsx) calls signIn
   * with two arguments and no answer to a question it never asked. It keeps a
   * person signed in on the device, as every sign-in did before this round.
   */
  it('keeps the session on the device when no answer is given', async () => {
    writeKeepSignedIn(false);
    const auth = supabaseAuth('https://example.supabase.co', 'anon-key');
    await auth.signIn(EMAIL, FAKE_CREDENTIAL);
    expect(readSessionStore()).toBe('device');
    expect(readKeepSignedIn()).toBe(false);
  });

  it('leaves the tick box alone: signing in answers the store and nothing else', async () => {
    writeKeepSignedIn(false);
    const auth = supabaseAuth('https://example.supabase.co', 'anon-key');
    await auth.signIn(EMAIL, FAKE_CREDENTIAL, { keepSignedIn: true });
    expect(readSessionStore()).toBe('device');
    expect(readKeepSignedIn()).toBe(false);
  });

  it('hands the client a store that follows the last sign-in', () => {
    supabaseAuth('https://example.supabase.co', 'anon-key');
    const storage = supabase.options[0]?.auth?.storage;
    expect(storage).toBeDefined();

    writeSessionStore('device');
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
