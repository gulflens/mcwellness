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
   * A new password for the person who is signed in (app/shell/pages/PasswordPage.tsx),
   * proven by the current one: the projects require it (Supabase Auth's
   * "require current password", switched on 2026-09-10), so a session found
   * on an unattended device cannot set a new one. Absent on the development
   * door, which has no passwords to change. Throws `PasswordChangeError`.
   */
  updatePassword?(newPassword: string, currentPassword: string): Promise<void>;
  /** The signed-in address, for the password manager's own record of a change; null when unknown. */
  currentEmail?(): Promise<string | null>;
  getAccessToken(): Promise<string | null>;
  onChange(listener: () => void): () => void;
};

/**
 * Why a password change was refused, in the four ways a person can act on.
 * The provider's own message never crosses: only the code does, and the page
 * holds one fixed sentence per code.
 */
export type PasswordChangeReason = 'weak' | 'same' | 'current' | 'session' | 'unknown';
export class PasswordChangeError extends Error {
  readonly reason: PasswordChangeReason;
  constructor(reason: PasswordChangeReason, message: string) {
    super(message);
    this.name = 'PasswordChangeError';
    this.reason = reason;
  }
}
