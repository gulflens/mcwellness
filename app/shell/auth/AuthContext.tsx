import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { MeResponse } from '../../api/_middleware/actor-schema';
import type { AuthProvider } from './types';

/**
 * Who is signed in, for the whole shell. On load it asks the provider for a
 * token and the API for /api/me; a 401 anywhere clears the session.
 */
export type Actor = MeResponse;

export type Session =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; actor: Actor; token: string };

export type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

type AuthValue = {
  provider: AuthProvider;
  session: Session;
  apiFetch: ApiFetch;
  signOut(): Promise<void>;
};

const AuthCtx = createContext<AuthValue | null>(null);

export function AuthProviderBoundary({
  provider,
  children,
  fetchImpl = fetch,
}: {
  provider: AuthProvider;
  children: ReactNode;
  fetchImpl?: typeof fetch;
}) {
  const [session, setSession] = useState<Session>({ status: 'loading' });

  const load = useCallback(async () => {
    const token = await provider.getAccessToken();
    if (!token) {
      setSession({ status: 'signed-out' });
      return;
    }
    const res = await fetchImpl('/api/me', { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) {
      await provider.signOut();
      setSession({ status: 'signed-out' });
      return;
    }
    const actor = MeResponse.parse(await res.json());
    setSession({ status: 'signed-in', actor, token });
  }, [provider, fetchImpl]);

  useEffect(() => {
    // Subscribe, then load once in a microtask: the effect itself sets no state.
    const run = () => void load();
    const unsubscribe = provider.onChange(run);
    queueMicrotask(run);
    return unsubscribe;
  }, [provider, load]);

  const apiFetch = useCallback<ApiFetch>(
    async (path, init) => {
      const token = await provider.getAccessToken();
      const headers = new Headers(init?.headers);
      if (token) headers.set('authorization', `Bearer ${token}`);
      headers.set('x-request-id', crypto.randomUUID());
      const res = await fetchImpl(path, { ...init, headers });
      if (res.status === 401) {
        await provider.signOut();
        setSession({ status: 'signed-out' });
      }
      return res;
    },
    [provider, fetchImpl],
  );

  const signOut = useCallback(async () => {
    await provider.signOut();
    setSession({ status: 'signed-out' });
  }, [provider]);

  const value = useMemo(
    () => ({ provider, session, apiFetch, signOut }),
    [provider, session, apiFetch, signOut],
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthCtx);
  if (!value) throw new Error('useAuth needs an AuthProviderBoundary above it.');
  return value;
}
