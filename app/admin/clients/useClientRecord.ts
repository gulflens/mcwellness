import { useCallback, useEffect, useState } from 'react';
import { ClientRecordResponse } from '../../api/clients/record-schema';
import { useAuth } from '../../shell/auth/AuthContext';

export type ClientRecordState =
  | { kind: 'loading' }
  // GET /api/clients/:id can refuse an erased record without a reason (client-record.md section 8).
  | { kind: 'reason-required' }
  | { kind: 'error' }
  | { kind: 'ready'; record: ClientRecordResponse };

/**
 * One fetch of GET /api/clients/:id per drawer open (the server audits the
 * read, task brief item 1), refetchable after every write so every tab and
 * the enrolment wizard always judge `canActivate` against what the server
 * just returned rather than a locally-guessed state.
 *
 * `clientId` is nullable so the enrolment wizard can call this hook (rules
 * of hooks: unconditionally) before its identity step has created a client
 * at all — with no id there is nothing to fetch, and the state simply stays
 * `loading` until one exists.
 */
export function useClientRecord(clientId: string | null): {
  state: ClientRecordState;
  refetch: (reason?: string) => Promise<void>;
} {
  const { apiFetch } = useAuth();
  const [state, setState] = useState<ClientRecordState>({ kind: 'loading' });

  const fetchRecord = useCallback(
    async (reason?: string): Promise<ClientRecordState> => {
      if (clientId === null) return { kind: 'loading' };
      try {
        const res = await apiFetch(`/api/clients/${clientId}`, {
          headers: reason ? { 'x-reason': reason } : undefined,
        });
        if (res.status === 400) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          if (body?.error === 'reason_required') {
            return { kind: 'reason-required' };
          }
        }
        if (!res.ok) {
          return { kind: 'error' };
        }
        return { kind: 'ready', record: ClientRecordResponse.parse(await res.json()) };
      } catch {
        return { kind: 'error' };
      }
    },
    [apiFetch, clientId],
  );

  // Called explicitly after a save, so the previous, still-correct record stays on screen
  // until the fresh one replaces it — no synchronous reset to 'loading' here.
  const refetch = useCallback(
    async (reason?: string): Promise<void> => {
      setState(await fetchRecord(reason));
    },
    [fetchRecord],
  );

  // The one automatic fetch, on mount and whenever clientId first appears: every later
  // call is explicit (refetch above).
  useEffect(() => {
    if (clientId === null) return;
    let live = true;
    void fetchRecord().then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [clientId, fetchRecord]);

  return { state, refetch };
}
