import {
  sessionWindow,
  type SessionWindow,
} from '../../../../domain/reports/qeeg/sessionsCompleted';
import type { Db } from '../../_middleware/request-context';

/**
 * How many sessions a follow-up says were completed since the report it is
 * compared with (docs/SPEC/reports-qeeg.md section 10, the last paragraph).
 *
 * **The practice's count, whoever asks** (brief S, fix round 1). Session row
 * security shows a practitioner only the visits on her own row, so a count
 * read as the caller changed with who saved. The database counts on the
 * practice's behalf instead (`app.completed_session_count`, migration 605),
 * behind the same gate as drafting a report, reading the practice's time zone
 * itself. The rule is `countCompletedSessions`'s, which a test holds the
 * function to on one fixture.
 *
 * **The window.** `after` and `before` are left out. While the new recording
 * has no day, the count runs to today, today included, which the function is
 * asked as "before the day after today".
 *
 * **Refused, never 0.** The function raises `insufficient_privilege` for
 * anyone the gate refuses. That is asked inside a savepoint and answered as
 * `null`, so the caller refuses the request rather than printing a count of
 * none, and the transaction stays usable. The callers have already asked who
 * may draft, so this happens only where the route and the database read a
 * schedule differently at its edge.
 *
 * The caller has already logged its read of the client, before the answer.
 */

const COUNT_SQL =
  'select app.completed_session_count($1::uuid, $2::date, coalesce($3::date, $4::date + 1)) as n';

export type Counted = { readonly count: number; readonly window: SessionWindow };

export async function countedSessions(
  db: Db,
  input: {
    readonly clientId: string;
    readonly earlierDay: string;
    readonly laterDay: string | null;
    /** Today in the practice's time zone. */
    readonly today: string;
  },
): Promise<Counted | null> {
  const window = sessionWindow(input.earlierDay, input.laterDay, input.today);
  await db.query('savepoint qeeg_session_count');
  try {
    const found = await db.query<{ n: number }>(COUNT_SQL, [
      input.clientId,
      window.after,
      window.before,
      window.through,
    ]);
    await db.query('release savepoint qeeg_session_count');
    return { count: Number(found.rows[0]?.n ?? 0), window };
  } catch (error) {
    if ((error as { code?: unknown }).code !== '42501') throw error;
    await db.query('rollback to savepoint qeeg_session_count');
    return null;
  }
}
