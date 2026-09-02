import type { Hono } from 'hono';
import { resolveVat, validateNewPrice, type Price } from '../../../domain/billing';
import { canActor, fils, isoDateIn } from '../../../domain/shared';
import type { ApiEnv } from '../_middleware/request-context';
import { CreatePriceInput, CreatePriceResponse, PriceRow, PricesResponse } from './schema';

/**
 * GET and POST /api/billing/prices. The price in force today is the one
 * shown; a price dated in the future is accepted but stays invisible here
 * until its own day, exactly as domain/billing/price.ts's currentPriceFor
 * says it should (the route uses the same date maths the DB query does,
 * proved together in tests/billing/db/prices.test.ts).
 */

const PRACTICE_TIME_ZONE = 'Asia/Dubai';

type PriceListRow = {
  id: string;
  service_type_id: string;
  service_type_code: string;
  service_type_name: string;
  service_type_name_ar: string | null;
  unit_price_fils: number;
  vat_rate_basis_points: number;
  vat_setting_version: number;
  valid_from: string;
};

// One row per service type: the price with the greatest valid_from at or
// before today (currentPriceFor, expressed in SQL for the listing query).
const LIST_SQL =
  'select distinct on (p.service_type_id) p.id, p.service_type_id, ' +
  'st.code as service_type_code, st.name as service_type_name, st.name_ar as service_type_name_ar, ' +
  'p.unit_price_fils, p.vat_rate_basis_points, p.vat_setting_version, p.valid_from ' +
  'from price p join service_type st on st.id = p.service_type_id ' +
  'where p.valid_from <= $1 ' +
  'order by p.service_type_id, p.valid_from desc';

const LATEST_FOR_SERVICE_SQL =
  'select id, unit_price_fils, valid_from from price where service_type_id = $1 ' +
  'order by valid_from desc limit 1';

const CURRENT_VAT_SETTING_SQL =
  'select rate_basis_points, version from vat_setting order by version desc limit 1';

const INSERT_PRICE_SQL =
  'insert into price (tenant_id, service_type_id, unit_price_fils, vat_rate_basis_points, ' +
  'vat_setting_version, valid_from) values (app.current_tenant_id(), $1, $2, $3, $4, $5) returning id';

function toPriceRow(row: {
  id: string;
  service_type_id: string;
  service_type_code: string;
  service_type_name: string;
  service_type_name_ar: string | null;
  unit_price_fils: number;
  vat_rate_basis_points: number;
  vat_setting_version: number;
  valid_from: string;
}): PriceRow {
  // Recomputed from the row's own stamped setting, not the tenant's current
  // one, so a later VAT change can never quietly alter a price already shown.
  const resolution = resolveVat(fils(row.unit_price_fils), {
    rateBasisPoints: row.vat_rate_basis_points,
    version: row.vat_setting_version,
  });
  return {
    id: row.id,
    serviceTypeId: row.service_type_id,
    serviceTypeCode: row.service_type_code,
    serviceTypeName: row.service_type_name,
    serviceTypeNameAr: row.service_type_name_ar,
    unitPriceFils: row.unit_price_fils,
    vatRateBasisPoints: resolution.rateBasisPoints,
    vatFils: resolution.vatFils,
    grossFils: resolution.grossFils,
    validFrom: row.valid_from,
  };
}

export function mountPrices(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/billing/prices', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!canActor(actor, { type: 'billing.price.read' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const today = isoDateIn(now(), PRACTICE_TIME_ZONE);
    const { rows } = await c.get('db').query<PriceListRow>(LIST_SQL, [today]);
    return c.json(PricesResponse.parse({ prices: rows.map(toPriceRow) }));
  });

  api.post('/api/billing/prices', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!canActor(actor, { type: 'billing.price.write' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const body = CreatePriceInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'bad_request', requestId }, 400);
    }
    const db = c.get('db');

    // Row security limits this to a service type in the caller's own tenant;
    // a service in a different tenant, or no such service at all, reads the same.
    const serviceType = await db.query<{
      id: string;
      code: string;
      name: string;
      name_ar: string | null;
    }>('select id, code, name, name_ar from service_type where id = $1', [body.data.serviceTypeId]);
    const service = serviceType.rows[0];
    if (!service) {
      return c.json({ error: 'not_found', requestId }, 404);
    }

    const existing = await db.query<{ id: string; unit_price_fils: number; valid_from: string }>(
      LATEST_FOR_SERVICE_SQL,
      [body.data.serviceTypeId],
    );
    const currentRow = existing.rows[0];
    const currentPrice: Price | null = currentRow
      ? {
          id: currentRow.id,
          serviceTypeId: body.data.serviceTypeId,
          unitPriceFils: fils(currentRow.unit_price_fils),
          validFrom: currentRow.valid_from,
        }
      : null;

    const today = isoDateIn(now(), PRACTICE_TIME_ZONE);
    const approval = validateNewPrice(currentPrice, { validFrom: body.data.validFrom }, today);
    if (!approval.ok) {
      return c.json({ error: 'bad_request', reason: approval.reason, requestId }, 400);
    }

    const vatSetting = await db.query<{ rate_basis_points: number; version: number }>(
      CURRENT_VAT_SETTING_SQL,
    );
    const setting = vatSetting.rows[0];
    if (!setting) {
      // Nothing in this pull request lets the owner set the rate yet
      // (docs/CHANGE-REQUESTS/billing-01.md); this is the honest answer
      // until it exists, not a guessed default.
      return c.json({ error: 'no_vat_setting', requestId }, 422);
    }

    const resolution = resolveVat(fils(body.data.unitPriceFils), {
      rateBasisPoints: setting.rate_basis_points,
      version: setting.version,
    });

    const inserted = await db.query<{ id: string }>(INSERT_PRICE_SQL, [
      body.data.serviceTypeId,
      body.data.unitPriceFils,
      resolution.rateBasisPoints,
      resolution.settingVersion,
      body.data.validFrom,
    ]);
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error('Insert of a price did not return an id.');
    }

    return c.json(
      CreatePriceResponse.parse({
        price: toPriceRow({
          id,
          service_type_id: body.data.serviceTypeId,
          service_type_code: service.code,
          service_type_name: service.name,
          service_type_name_ar: service.name_ar,
          unit_price_fils: body.data.unitPriceFils,
          vat_rate_basis_points: resolution.rateBasisPoints,
          vat_setting_version: resolution.settingVersion,
          valid_from: body.data.validFrom,
        }),
      }),
      201,
    );
  });
}
