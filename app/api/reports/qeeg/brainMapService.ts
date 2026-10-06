import { BRAIN_MAP_SERVICE_CODE } from '../../../../domain/reports/qeeg/catalogue/ids';
import type { Db } from '../../_middleware/request-context';

/**
 * The practice's brain-map service, by its catalogue code; null where the
 * practice has none. A brain-map report is written and signed under it (the
 * operator's decision of 6 October 2026), so only a credential for that
 * service signs one.
 */
export async function brainMapService(db: Db): Promise<string | null> {
  const found = await db.query<{ id: string }>(
    'select id from service_type where tenant_id = app.current_tenant_id() and code = $1',
    [BRAIN_MAP_SERVICE_CODE],
  );
  return found.rows[0]?.id ?? null;
}
