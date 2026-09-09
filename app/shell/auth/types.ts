/**
 * How the browser holds a session. Two implementations: Supabase (staging and
 * production) and the development door (a laptop only). The rest of the shell
 * sees only this interface.
 */
export type SeededPerson = { authId: string; displayName: string; roles: string[] };

/**
 * What the sign-in page knows that the provider cannot: whether this person
 * asked to be kept signed in on this browser. Absent means the caller never
 * asked, and the session is kept on the device as every sign-in did before
 * the box existed (app/shell/auth/session-storage.ts).
 */
export type SignInOptions = { keepSignedIn: boolean };

export type AuthProvider = {
  kind: 'supabase' | 'development';
  signIn(email: string, password: string, options?: SignInOptions): Promise<void>;
  signInAs?(authId: string): Promise<void>;
  seededPeople?(): Promise<SeededPerson[]>;
  signOut(): Promise<void>;
  /**
   * A new password for the person who is signed in (app/shell/pages/PasswordPage.tsx).
   * Absent on the development door, which has no passwords to change.
   */
  updatePassword?(newPassword: string): Promise<void>;
  getAccessToken(): Promise<string | null>;
  onChange(listener: () => void): () => void;
};
