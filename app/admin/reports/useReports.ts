import { useCallback, useEffect, useState } from 'react';
import { ReportListResponse, type ReportRow } from '../../api/reports/schema';
import { useAuth } from '../../shell/auth/AuthContext';

export type ReportsState =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; reports: readonly ReportRow[] };

/**
 * One fetch of `GET /api/reports?clientId=` per open of the Reports tab. The
 * server records it as a `list` (docs/SPEC/reports-v1.md section 8), so this
 * deliberately does not poll: a screen that refetched on a timer would write a
 * row into a household's trail every few seconds and say nothing by it.
 *
 * Refetched explicitly after every write, and the previous answer stays on
 * screen while the new one is fetched rather than blanking to "Loading".
 */
export function useReports(clientId: string): {
  state: ReportsState;
  refetch: () => Promise<void>;
} {
  const { apiFetch } = useAuth();
  const [state, setState] = useState<ReportsState>({ kind: 'loading' });

  const read = useCallback(async (): Promise<ReportsState> => {
    try {
      const res = await apiFetch(`/api/reports?clientId=${encodeURIComponent(clientId)}`);
      if (!res.ok) return { kind: 'error' };
      return { kind: 'ready', reports: ReportListResponse.parse(await res.json()).reports };
    } catch {
      return { kind: 'error' };
    }
  }, [apiFetch, clientId]);

  const refetch = useCallback(async (): Promise<void> => {
    setState(await read());
  }, [read]);

  // Fetching and setting are separate so the effect never calls setState in
  // its own body: it hands the answer to a callback, the way
  // `useClientRecord` does, and a tab closed mid-flight sets nothing.
  useEffect(() => {
    let live = true;
    void read().then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [read]);

  return { state, refetch };
}

/**
 * The chain, arranged as the tab shows it: each standing version, with the
 * versions it replaced beneath it (section 4.1).
 *
 * A superseded version is never a row of its own at the top level, so a
 * reader sees one report with a history rather than three near-duplicates. A
 * version whose successor this actor cannot see — a household reading its own
 * screen — falls back to standing on its own, which is the honest answer:
 * from where they are looking, it is the report they have.
 */
export function inChains(reports: readonly ReportRow[]): {
  head: ReportRow;
  superseded: readonly ReportRow[];
}[] {
  const bySupersededId = new Map(
    reports.filter((r) => r.supersedesId !== null).map((r) => [r.supersedesId as string, r]),
  );
  const replaced = new Set(bySupersededId.keys());
  const byId = new Map(reports.map((r) => [r.id, r]));

  return reports
    .filter((report) => !replaced.has(report.id))
    .map((head) => {
      const beneath: ReportRow[] = [];
      let at = head.supersedesId;
      while (at !== null) {
        const previous = byId.get(at);
        if (!previous) break;
        beneath.push(previous);
        at = previous.supersedesId;
      }
      return { head, superseded: beneath };
    });
}
