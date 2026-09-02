/**
 * How the browser holds a session. Two implementations: Supabase (staging and
 * production) and the development door (a laptop only). The rest of the shell
 * sees only this interface.
 */
export type SeededPerson = { authId: string; displayName: string; roles: string[] };

export type AuthProvider = {
  kind: 'supabase' | 'development';
  signIn(email: string, password: string): Promise<void>;
  signInAs?(authId: string): Promise<void>;
  seededPeople?(): Promise<SeededPerson[]>;
  signOut(): Promise<void>;
  getAccessToken(): Promise<string | null>;
  onChange(listener: () => void): () => void;
};
