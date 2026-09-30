import {
  countCompletedSessions,
  sessionWindow,
  type SessionWindow,
  type VisitForCount,
} from '../../../../domain/reports/qeeg/sessionsCompleted';
import type { Db } from '../../_middleware/request-context';

/**
 * How many sessions a follow-up says were completed since the report it is
 * compared with (docs/SPEC/reports-qeeg.md section 10, the last paragraph):
 * the client's visits, read here, and counted by the domain's rule
 * (`countCompletedSessions`), which alone decides which count.
 *
 * **Four columns and no fifth.** Whose visit, its status, whether it was
 * closed, and the practice's day of its check-in. Nothing that identifies
 * anybody leaves this query, and the answer is a single number.
 *
 * **Read as the caller, through row security**, as the progress report reads
 * the same table (`gather.ts`). The owner and the lead practitioner see every
 * visit of the client; a practitioner sees the visits on her own row, so her
 * count is of those. This is said in the brief's report as a concern.
 *
 * The caller has already logged its read of the client, before the answer.
 */

const VISITS_SQL =
  'select client_id, status::text as status, closed_at is not null as closed, ' +
  "to_char(checked_in_at at time zone $2, 'YYYY-MM-DD') as day " +
  'from session where tenant_id = app.current_tenant_id() and client_id = $1';

export type Counted = { readonly count: number; readonly window: SessionWindow };

export async function countedSessions(
  db: Db,
  input: {
    readonly clientId: string;
    readonly earlierDay: string;
    readonly laterDay: string | null;
    readonly today: string;
    readonly timeZone: string;
  },
): Promise<Counted> {
  const window = sessionWindow(input.earlierDay, input.laterDay, input.today);
  const found = await db.query<{ client_id: string; status: string; closed: boolean; day: string }>(
    VISITS_SQL,
    [input.clientId, input.timeZone],
  );
  const visits: VisitForCount[] = found.rows.map((row) => ({
    clientId: row.client_id,
    status: row.status,
    closed: row.closed,
    day: row.day,
  }));
  return { count: countCompletedSessions(visits, input.clientId, window), window };
}
