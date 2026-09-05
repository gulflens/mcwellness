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
import { forgetDevice } from '../../therapist/session/outbox/store';
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

  /**
   * **A signed-out device keeps nothing of anybody**
   * (docs/SPEC/practitioner-phone.md section 3.5,
   * docs/CHANGE-REQUESTS/session-capture-02.md sections 1f and 5b,
   * .claude/rules/compliance.md).
   *
   * Two caches, two owners, one sentence. The device's own queue and its
   * open-visit note hold ratings, observation chips and a household's given
   * name and initial; the worker's read cache holds the day sheet, which holds
   * the same name again. `forgetDevice` is the session module's own function,
   * so the rule stays written where it belongs and the shell only says when;
   * `forget-reads` is the message the worker answers.
   *
   * Both run here rather than in a screen, because a practitioner who signs
   * out from Today is signing out of a screen the session module does not own,
   * and an effect there would never fire. Neither call throws on a device that
   * has never run a visit, and neither needs a worker to be running.
   */
  const signOut = useCallback(async () => {
    await provider.signOut();
    await forgetDevice();
    navigator.serviceWorker?.controller?.postMessage({ type: 'forget-reads' });
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
