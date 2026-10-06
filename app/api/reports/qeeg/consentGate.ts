import { ageOn, type IsoDate } from '../../../../domain/shared';
import {
  brainMapConsentRefusals,
  type BrainMapConsentRefusal,
} from '../../../../domain/reports/qeeg/consents';
import type { Db } from '../../_middleware/request-context';

/**
 * The household's agreements for a brain-map report, read at the moment of
 * writing (`domain/reports/qeeg/consents.ts`): the purposes active on `today`
 * and whether the client is a minor. Read under the caller's own row rules, as
 * every other read of the client's record is; a client the caller cannot see
 * was already refused by the route before this is asked.
 */
export async function brainMapConsentGate(
  db: Db,
  clientId: string,
  today: IsoDate,
): Promise<BrainMapConsentRefusal[]> {
  const [consents, client] = await Promise.all([
    db.query<{ purpose: string }>(
      "select distinct purpose::text as purpose from consent where client_id = $1 and status = 'active' " +
        'and (expires_at is null or expires_at > $2::date)',
      [clientId, today],
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
