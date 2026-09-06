import type { AuthProvider, SeededPerson } from './types';

/**
 * The development door, browser side. Works only when the server has opened
 * POST /api/dev/session, which it does on a laptop and nowhere else. The token
 * lives in memory and sessionStorage for this tab.
 */
const KEY = 'mcwellness.dev-session';

type Stored = { token: string; expiresAt: number };

function read(): Stored | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (typeof parsed.token !== 'string' || typeof parsed.expiresAt !== 'number') return null;
    return parsed.expiresAt * 1000 > Date.now()
      ? { token: parsed.token, expiresAt: parsed.expiresAt }
      : null;
  } catch {
    return null;
  }
}

export function devAuth(fetchImpl: typeof fetch = fetch): AuthProvider {
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());
  return {
    kind: 'development',
    /**
     * Takes the same three arguments as the real provider and ignores all of
     * them, keep-me-signed-in included: this door holds its token in
     * sessionStorage for this tab and nowhere else, by design.
     */
    async signIn() {
      throw new Error('Email sign-in is not configured on this laptop. Use a seeded person below.');
    },
    async signInAs(authId) {
      const res = await fetchImpl('/api/dev/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ authId }),
      });
      if (!res.ok) {
        throw new Error(
          'The development sign-in door is closed. Start the API with APP_ENV=development.',
        );
      }
      const stored = (await res.json()) as Stored;
      sessionStorage.setItem(KEY, JSON.stringify(stored));
      notify();
    },
    async seededPeople() {
      const res = await fetchImpl('/api/dev/session');
      if (!res.ok) return [];
      const body = (await res.json()) as { people?: SeededPerson[] };
      return body.people ?? [];
    },
    async signOut() {
      sessionStorage.removeItem(KEY);
      notify();
    },
    async getAccessToken() {
      return read()?.token ?? null;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
