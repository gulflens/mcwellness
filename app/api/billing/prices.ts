import type { Hono } from 'hono';
import {
  applyDiscount,
  resolveSaleVat,
  resolveVat,
  validateNewPrice,
  type AppliedDiscount,
  type Price,
} from '../../../domain/billing';
import { canActor, fils, isoDateIn } from '../../../domain/shared';
import type { ApiEnv } from '../_middleware/request-context';
import {
  CreatePriceInput,
  CreatePriceResponse,
  PriceRow,
  PricesResponse,
  toDiscount,
} from './schema';
import { readVatRegistered } from './supplier';

/**
 * GET and POST /api/billing/prices. The price in force today is the one
 * shown; a price dated in the future is accepted but stays invisible here
 * until its own day, exactly as domain/billing/price.ts's currentPriceFor
 * says it should (the route uses the same date maths the DB query does,
 * proved together in tests/billing/db/prices.test.ts).
 *
 * Every query below carries an explicit tenant_id = app.current_tenant_id()
 * predicate: row security already enforces this, but a mistaken query here
 * should fail loudly in review and in tests/billing/db/rls.test.ts, not rely
 * on RLS being the only thing standing between one practice's prices and
 * another's. jurisdiction and recipient type are pinned to 'AE' and
 * 'individual' — the only values the check constraints allow today
 * (00-data-model.md section 6's key shape, kept for when that changes).
 */

const PRACTICE_TIME_ZONE = 'Asia/Dubai';
const JURISDICTION = 'AE';
const RECIPIENT_TYPE = 'individual';

/**
 * A stable code for each of validateNewPrice's two refusals
 * (domain/billing/price.ts), so a 400 body carries something the screen can
 * map to a fixed sentence — the security review's finding this round: the
 * domain's own reason text must never reach the browser to be rendered
 * unmediated. Domain code is out of this worktree's edit paths, so the two
 * reason strings are mirrored here rather than carried as a field on
 * NewPriceRefusal; a third refusal added there without a matching branch
 * here falls back to 'invalid', which is still a safe, fixed sentence.
 */
function refusalCode(reason: string): 'date_not_future' | 'date_not_after_current' | 'invalid' {
  if (reason === 'A new price cannot take effect before today.') {
    return 'date_not_future';
  }
  if (reason === 'A new price must take effect after the price it supersedes.') {
    return 'date_not_after_current';
  }
  return 'invalid';
}

type PriceListRow = {
  id: string;
  service_type_id: string;
  service_type_code: string;
  service_type_name: string;
  service_type_name_ar: string | null;
  list_price_fils: number;
  discount_fils: number;
  discount_basis_points: number | null;
  unit_price_fils: number;
  vat_rate_basis_points: number;
  vat_setting_version: number;
  valid_from: string;
  supersedes_id: string | null;
  amendment_reason: string;
};

// One row per service type: the price with the greatest valid_from at or
// before today (currentPriceFor, expressed in SQL for the listing query).
// Only an active service type is offered; a retired one drops off the list
// but its price history stays in the table, untouched.
const LIST_SQL =
  'select distinct on (p.service_type_id) p.id, p.service_type_id, ' +
  'st.code as service_type_code, st.name as service_type_name, st.name_ar as service_type_name_ar, ' +
  'p.list_price_fils, p.discount_fils, p.discount_basis_points, ' +
  'p.unit_price_fils, p.vat_rate_basis_points, p.vat_setting_version, p.valid_from, ' +
  'p.supersedes_id, p.amendment_reason ' +
  'from price p join service_type st on st.id = p.service_type_id ' +
  'where p.tenant_id = app.current_tenant_id() and p.jurisdiction = $2 and p.recipient_type = $3 ' +
  "and st.status = 'active' and p.valid_from <= $1 " +
  'order by p.service_type_id, p.valid_from desc';

// The term comes back with the figure because the row about to supersede this
// one has to carry it forward: see INSERT_PRICE_SQL below.
const LATEST_FOR_SERVICE_SQL =
  'select id, unit_price_fils, valid_from, expiry_amount, expiry_unit from price ' +
  'where tenant_id = app.current_tenant_id() and service_type_id = $1 ' +
  'and jurisdiction = $2 and recipient_type = $3 ' +
  'order by valid_from desc limit 1';

// The VAT setting in force on the date being priced — the price's own
// valid_from, not "today" and not simply the newest row: a rate scheduled
// for the future must not apply to a price that starts before it does.
const VAT_SETTING_ON_DATE_SQL =
  'select rate_basis_points, version from vat_setting ' +
  'where tenant_id = app.current_tenant_id() and effective_from <= $1 ' +
  'order by effective_from desc, version desc limit 1';

/**
 * **The term is written here, carried from the row this one supersedes.**
 *
 * A price amendment is a new row, not an edit (docs/SPEC/billing.md section
 * 2). The practice's term lives on the price row as of migration 412, so a
 * column list that did not name it would make every change of figure quietly
 * reset a deliberate term to "never expires" — a household's credits becoming
 * eternal, or a practice's intent discarded, with nobody having typed
 * anything. The term follows the figure until somebody changes it on purpose.
 */
const INSERT_PRICE_SQL =
  'insert into price (tenant_id, service_type_id, jurisdiction, recipient_type, ' +
  'list_price_fils, discount_fils, discount_basis_points, unit_price_fils, ' +
  'vat_rate_basis_points, vat_setting_version, valid_from, supersedes_id, amendment_reason, ' +
  'expiry_amount, expiry_unit) ' +
  'values (app.current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) ' +
  'returning id';

function toPriceRow(
  row: {
    id: string;
    service_type_id: string;
    service_type_code: string;
    service_type_name: string;
    service_type_name_ar: string | null;
    list_price_fils: number;
    discount_fils: number;
    discount_basis_points: number | null;
    unit_price_fils: number;
    vat_rate_basis_points: number;
    vat_setting_version: number;
    valid_from: string;
    supersedes_id: string | null;
    amendment_reason: string;
  },
  vatRegistered: boolean,
): PriceRow {
  // The rate is the row's own — stamped when the price was written, never
  // the tenant's current one, so a later rate change cannot quietly alter a
  // price already shown. The charging follows the registration: an
  // unregistered practice charges nothing at that rate, so its gross is its
  // net and the list shows a family the figure it will actually pay
  // (migration 406; domain/billing/vat.ts's resolveSaleVat).
  const resolution = resolveSaleVat(
    fils(row.unit_price_fils),
    { rateBasisPoints: row.vat_rate_basis_points, version: row.vat_setting_version },
    { vatRegistered },
  );
  return {
    id: row.id,
    serviceTypeId: row.service_type_id,
    serviceTypeCode: row.service_type_code,
    serviceTypeName: row.service_type_name,
    serviceTypeNameAr: row.service_type_name_ar,
    listPriceFils: row.list_price_fils,
    discountFils: row.discount_fils,
    discountBasisPoints: row.discount_basis_points,
    unitPriceFils: row.unit_price_fils,
    // The stamp itself, unchanged by the registration: what the standard rate
    // was on the day, which is what makes the row live again if a
    // registration is granted.
    vatRateBasisPoints: row.vat_rate_basis_points,
    vatFils: resolution.vatFils,
    grossFils: resolution.grossFils,
    validFrom: row.valid_from,
    supersedesId: row.supersedes_id,
    amendmentReason: row.amendment_reason,
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
    const db = c.get('db');
    // Once per request, not once per row: every price on the list is charged
    // under the same registration.
    const vatRegistered = await readVatRegistered(db);
    const { rows } = await db.query<PriceListRow>(LIST_SQL, [today, JURISDICTION, RECIPIENT_TYPE]);
    return c.json(
      PricesResponse.parse({
        prices: rows.map((row) => toPriceRow(row, vatRegistered)),
        vatRegistered,
      }),
    );
  });

  api.post('/api/billing/prices', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!canActor(actor, { type: 'billing.price.write' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const body = CreatePriceInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const db = c.get('db');

    // Row security limits this to a service type in the caller's own tenant;
    // a service in a different tenant, or no such service at all, reads the same.
    const serviceType = await db.query<{
      id: string;
      code: string;
      name: string;
      name_ar: string | null;
    }>(
      'select id, code, name, name_ar from service_type ' +
        'where id = $1 and tenant_id = app.current_tenant_id()',
      [body.data.serviceTypeId],
    );
    const service = serviceType.rows[0];
    if (!service) {
      return c.json({ error: 'not_found', requestId }, 404);
    }

    const existing = await db.query<{
      id: string;
      unit_price_fils: number;
      valid_from: string;
      expiry_amount: number | null;
      expiry_unit: 'day' | 'month' | null;
    }>(LATEST_FOR_SERVICE_SQL, [body.data.serviceTypeId, JURISDICTION, RECIPIENT_TYPE]);
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
      return c.json({ error: 'bad_request', code: refusalCode(approval.reason), requestId }, 400);
    }

    const vatSetting = await db.query<{ rate_basis_points: number; version: number }>(
      VAT_SETTING_ON_DATE_SQL,
      [body.data.validFrom],
    );
    const setting = vatSetting.rows[0];
    if (!setting) {
      // Every tenant gets a rate the moment it exists (migration 400); this is
      // the honest answer for the one shape that could still reach here — a
      // valid_from dated before the tenant's earliest setting — not a guess.
      return c.json({ error: 'no_vat_setting', requestId }, 422);
    }

    // The list figure less whatever is off it, worked out once by the one rule
    // (domain/billing/discount.ts) and written whole: the browser's preview
    // calls the same function, so a family is never shown one figure and
    // charged another.
    let applied: AppliedDiscount;
    try {
      applied = applyDiscount(fils(body.data.listPriceFils), toDiscount(body.data.discount));
    } catch {
      return c.json({ error: 'bad_request', code: 'discount_too_large', requestId }, 400);
    }

    // VAT falls on the net after the discount: UAE VAT values a supply net of
    // discounts (docs/SPEC/billing.md sections 2.4 and 5.1).
    const resolution = resolveVat(applied.netFils, {
      rateBasisPoints: setting.rate_basis_points,
      version: setting.version,
    });

    const inserted = await db.query<{ id: string }>(INSERT_PRICE_SQL, [
      body.data.serviceTypeId,
      JURISDICTION,
      RECIPIENT_TYPE,
      applied.listFils,
      applied.discountFils,
      applied.basisPoints,
      applied.netFils,
      resolution.rateBasisPoints,
      resolution.settingVersion,
      body.data.validFrom,
      currentPrice?.id ?? null,
      body.data.amendmentReason,
      // The superseded row's term, unchanged. Null on a first price, and null
      // on every price the practice has never given a term to, which is all
      // of them until somebody sets one.
      currentRow?.expiry_amount ?? null,
      currentRow?.expiry_unit ?? null,
    ]);
    const id = inserted.rows[0]?.id;
    if (!id) {
      throw new Error('Insert of a price did not return an id.');
    }

    // The row is stamped with the rate above; what it reports as charged is
    // what the practice would charge for it today.
    const vatRegistered = await readVatRegistered(db);
    return c.json(
      CreatePriceResponse.parse({
        price: toPriceRow(
          {
            id,
            service_type_id: body.data.serviceTypeId,
            service_type_code: service.code,
            service_type_name: service.name,
            service_type_name_ar: service.name_ar,
            list_price_fils: applied.listFils,
            discount_fils: applied.discountFils,
            discount_basis_points: applied.basisPoints,
            unit_price_fils: applied.netFils,
            vat_rate_basis_points: resolution.rateBasisPoints,
            vat_setting_version: resolution.settingVersion,
            valid_from: body.data.validFrom,
            supersedes_id: currentPrice?.id ?? null,
            amendment_reason: body.data.amendmentReason,
          },
          vatRegistered,
        ),
      }),
      201,
    );
  });
}
