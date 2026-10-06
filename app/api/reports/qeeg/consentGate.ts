import { ageOn, isoDateIn } from '../../../../domain/shared';
import {
  brainMapConsentRefusals,
  type BrainMapConsentRefusal,
} from '../../../../domain/reports/qeeg/consents';
import type { Db } from '../../_middleware/request-context';
import { practiceTimeZone } from '../gather';

/**
 * The household's agreements for a brain-map report, read at the moment of
 * writing (`domain/reports/qeeg/consents.ts`): the purposes active at `at`
 * (an expiry is a moment, so one that passed earlier today no longer counts)
 * and whether the client is a minor on the practice's own date. Read under the caller's own row rules, as
 * every other read of the client's record is; a client the caller cannot see
 * was already refused by the route before this is asked.
 */
export async function brainMapConsentGate(
  db: Db,
  clientId: string,
  at: Date,
): Promise<BrainMapConsentRefusal[]> {
  const today = isoDateIn(at, await practiceTimeZone(db));
  const [consents, client] = await Promise.all([
    db.query<{ purpose: string }>(
      "select distinct purpose::text as purpose from consent where client_id = $1 and status = 'active' " +
        'and (expires_at is null or expires_at > $2::timestamptz)',
      [clientId, at.toISOString()],
    ),
    db.query<{ date_of_birth: string | null }>(
      "select to_char(date_of_birth, 'YYYY-MM-DD') as date_of_birth from client where id = $1",
      [clientId],
    ),
  ]);
  const born = client.rows[0]?.date_of_birth ?? null;
  return brainMapConsentRefusals({
    active: consents.rows.map((row) => row.purpose),
    isMinor: born === null ? null : ageOn(born, today) < 18,
  });
}
