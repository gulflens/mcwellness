import { createClient } from '@supabase/supabase-js';
import { keptSessionStorage, writeKeepSignedIn } from './session-storage';
import type { AuthProvider } from './types';

/** The real sign-in: Supabase Auth, email and password, sessions refreshed by the client library. */
export function supabaseAuth(url: string, anonKey: string): AuthProvider {
  const client = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      // Where a session is kept is the person's own answer, given on the
      // sign-in page and read at each write (app/shell/auth/session-storage.ts).
      storage: keptSessionStorage(),
    },
  });
  return {
    kind: 'supabase',
    async signIn(email, password, options) {
      // Before the call, not after: the session Supabase is about to write must
      // find the answer already there, or the first write goes to the wrong store.
      writeKeepSignedIn(options?.keepSignedIn ?? false);
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) {
        throw new Error('That email and password did not match. Try again.');
      }
    },
    async signOut() {
      // Supabase removes the session through the store above, which clears both.
      await client.auth.signOut();
    },
    async getAccessToken() {
      const { data } = await client.auth.getSession();
      return data.session?.access_token ?? null;
    },
    onChange(listener) {
      const { data } = client.auth.onAuthStateChange(() => listener());
      return () => data.subscription.unsubscribe();
    },
  };
}
