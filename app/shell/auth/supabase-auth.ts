import { createClient } from '@supabase/supabase-js';
import { keptSessionStorage, writeSessionStore } from './session-storage';
import { PasswordChangeError, type AuthProvider } from './types';

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
      // The one place the store is written. Before the call, not after: the
      // session Supabase is about to write must find the answer already there,
      // or the first write goes to the wrong store. Every later write — and
      // Supabase writes on each token refresh — reads this same answer, so a
      // held session follows the sign-in that made it and nothing else.
      // No answer means the device: the portal's invitation sign-in
      // (app/client/InvitePage.tsx) asks nobody the question, and a person who
      // has just set a password should be kept signed in as they were before
      // this round. Only an explicit no puts the session in the tab alone.
      writeSessionStore(options?.keepSignedIn === false ? 'tab' : 'device');
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) {
        throw new Error('That email and password did not match. Try again.');
      }
    },
    async signOut() {
      // Supabase removes the session through the store above, which clears both.
      await client.auth.signOut();
    },
    async updatePassword(newPassword, currentPassword) {
      // Supabase verifies the current password (a project setting, on since
      // 2026-09-10), applies its own floor and its leaked-password check, and
      // keeps this browser signed in. The practice's own rule for what a
      // password may be is the page's (domain/shared/password.ts). Only the
      // error's code is read, never its message.
      const { error } = await client.auth.updateUser({
        password: newPassword,
        current_password: currentPassword,
      });
      if (error) {
        const code = (error as { code?: string }).code ?? '';
        if (code === 'weak_password') {
          throw new PasswordChangeError(
            'weak',
            'That password is on a list of leaked passwords, or too short. Choose another.',
          );
        }
        if (code === 'same_password') {
          throw new PasswordChangeError('same', 'That is the password you already have.');
        }
        if (code === 'invalid_credentials' || code === 'reauthentication_not_valid') {
          throw new PasswordChangeError('current', 'The current password is not right.');
        }
        if (
          code === 'session_not_found' ||
          code === 'reauthentication_needed' ||
          error.name === 'AuthSessionMissingError'
        ) {
          throw new PasswordChangeError('session', 'Sign in again, then change it.');
        }
        throw new PasswordChangeError('unknown', 'The password could not be changed. Try again.');
      }
    },
    async currentEmail() {
      const { data } = await client.auth.getSession();
      return data.session?.user.email ?? null;
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
