import { createClient } from '@supabase/supabase-js';
import type { AuthProvider } from './types';

/** The real sign-in: Supabase Auth, email and password, sessions refreshed by the client library. */
export function supabaseAuth(url: string, anonKey: string): AuthProvider {
  const client = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return {
    kind: 'supabase',
    async signIn(email, password) {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) {
        throw new Error('That email and password did not match. Try again.');
      }
    },
    async signOut() {
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
