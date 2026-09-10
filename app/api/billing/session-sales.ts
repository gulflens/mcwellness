import type { Hono } from 'hono';
import {
  SINGLE_SESSION_MONTHS,
  combineDiscounts,
  expiryOn,
  resolveSaleVat,
  type AppliedDiscount,
} from '../../../domain/billing';
import { fils, isoDateIn } from '../../../domain/shared';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { maySell, mayDiscount } from './access';
import { toDiscount } from './schema';
import { IdempotencyKey, SellSessionInput, SellSessionResponse } from './ledger-schema';

/**
 * `POST /api/billing/session-purchases` — a family buys one session ahead of
 * the visit (the operator's decision of 10 September 2026).
 *
 * The package sale's shape (`sales.ts`), for a package of one: the price row
 * in force on the day, the practice's discount and an optional extra one
 * combined once against the list figure, VAT resolved from the row's stamp
 * and the registration, and in one transaction an invoice of kind
 * `single_session` (migration 411) with one line, one credit of source
 * `single` pointing at the invoice, and the payment when money changed
 * hands. A retry with the same `Idempotency-Key` replays the first answer
 * from what it wrote; the key is kept on the invoice itself, since a single
 * sale has no purchase row of its own to hold it (migration 411 adds
 * `invoice.idempotency_key`, a nullable `text` column with a partial unique
 * index on `(tenant_id, idempotency_key) where idempotency_key is not
 * null` — the package sale's own key lives on `package_purchase` instead,
 * because a package sale always writes one).
 *
 * The one-off term is fixed at `SINGLE_SESSION_MONTHS` (twelve months,
 * `domain/billing/expiry.ts`) rather than any package's own term: a single
 * credit has no package behind it to take a term from.
 *
 * Nothing changes for a visit with no credit: `app.charge_single_visit`
 * still invoices it when it closes (migration 404).
 */

const PRACTICE_TIME_ZONE = 'Asia/Dubai';
const JURISDICTION = 'AE';
const RECIPIENT_TYPE = 'individual';

/** The practice opened in 2024; a sale before that is a mistyped year (sales.ts's own guard). */
const EARLIEST_SALE_ON = '2024-01-01';

/** The key a repeated press collides with — migration 411's partial unique index on `invoice`. */
const INVOICE_IDEMPOTENCY_CONSTRAINT = 'invoice_one_per_idempotency_key';

const CLIENT_SQL =
  "select id from client where tenant_id = app.current_tenant_id() and id = $1 and status <> 'erased'";

// The price in force on the day, with the service's name for the line and the
// answer: the same row app.charge_single_visit reads, chosen the same way
// (migration 404's own price lookup).
const PRICE_SQL =
  'select p.id, p.list_price_fils, p.discount_fils, p.discount_basis_points, ' +
  'p.vat_rate_basis_points, p.vat_setting_version, st.name as service_type_name, ' +
  'st.name_ar as service_type_name_ar, ' +
  'app.tenant_charges_vat(app.current_tenant_id()) as vat_registered ' +
  'from price p join service_type st on st.id = p.service_type_id ' +
  'where p.tenant_id = app.current_tenant_id() and st.tenant_id = app.current_tenant_id() ' +
  "and p.service_type_id = $1 and p.jurisdiction = $2 and p.recipient_type = $3 and st.status = 'active' " +
  'and p.valid_from <= $4 order by p.valid_from desc limit 1';

const INSERT_INVOICE_SQL =
  'insert into invoice (tenant_id, client_id, number, kind, issued_on, net_fils, vat_fils, ' +
  'gross_fils, idempotency_key, created_by) values (app.current_tenant_id(), $1, ' +
  "app.next_invoice_number(), 'single_session', $2, $3, $4, $5, $6, app.current_actor_id()) " +
  'returning id, reference';

// Same shape as sales.ts's own INSERT_LINE_SQL, with service_type_id in place
// of package_id: invoice_line carries both columns (402_billing_document.sql),
// and app.charge_single_visit (404, lines 275-280) writes service_type_id the
// same way for the charge-on-close path.
const INSERT_LINE_SQL =
  'insert into invoice_line (tenant_id, invoice_id, client_id, line_no, description, ' +
  'description_ar, service_type_id, quantity, unit_net_fils, discount_fils, ' +
  'discount_basis_points, net_fils, vat_rate_basis_points, vat_setting_version, vat_fils, ' +
  'gross_fils, created_by) ' +
  'values (app.current_tenant_id(), $1, $2, 1, $3, $4, $5, 1, $6, $7, $8, $9, $10, $11, $12, $13, ' +
  'app.current_actor_id())';

const INSERT_ENTITLEMENT_SQL =
  'insert into entitlement (tenant_id, client_id, service_type_id, source_type, invoice_id, ' +
  'allocated_net_fils, vat_rate_basis_points, vat_setting_version, expires_on, created_by) ' +
  "values (app.current_tenant_id(), $1, $2, 'single', $3, $4, $5, $6, $7, app.current_actor_id()) " +
  'returning id';

const INSERT_PAYMENT_SQL =
  'insert into payment (tenant_id, client_id, method, amount_fils, received_at, reference, ' +
  'invoice_id, created_by) ' +
  'values (app.current_tenant_id(), $1, $2, $3, $4, $5, $6, app.current_actor_id())';

const REPLAY_SQL =
  'select i.id, i.reference, i.net_fils, i.vat_fils, i.gross_fils, e.id as entitlement_id, ' +
  'e.expires_on, st.name as service_type_name from invoice i ' +
  'join entitlement e on e.invoice_id = i.id join service_type st on st.id = e.service_type_id ' +
  "where i.tenant_id = app.current_tenant_id() and i.kind = 'single_session' and i.idempotency_key = $1";

/**
 * Postgres: unique_violation on the invoice's own idempotency key, and on no
 * other — the same press arriving twice. Named rather than assumed, as
 * `sales.ts`'s own `isDuplicateKey` names `package_purchase`'s constraint:
 * replaying the first answer is right only for this key, and a 23505 raised
 * by anything else on the invoice insert (the number sequence, say) is a
 * fault to be raised rather than a sale to be reported as already made.
 */
function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === '23505' &&
    (error as { constraint?: string }).constraint === INVOICE_IDEMPOTENCY_CONSTRAINT
  );
}

/** The answer the first attempt gave, read back from what it wrote. Null when this key is new. */
async function replay(db: Db, key: string): Promise<SellSessionResponse | null> {
  const found = await db.query<{
    id: string;
    reference: string;
    net_fils: number;
    vat_fils: number;
    gross_fils: number;
    entitlement_id: string;
    expires_on: string;
    service_type_name: string;
  }>(REPLAY_SQL, [key]);
  const row = found.rows[0];
  if (!row) return null;
  return SellSessionResponse.parse({
    invoiceId: row.id,
    invoiceReference: row.reference,
    entitlementId: row.entitlement_id,
    serviceTypeName: row.service_type_name,
    netFils: row.net_fils,
    vatFils: row.vat_fils,
    grossFils: row.gross_fils,
    expiresOn: row.expires_on,
  });
}

export function mountSessionSales(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.post('/api/billing/session-purchases', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!maySell(actor, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const body = SellSessionInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const input = body.data;
    const today = isoDateIn(now(), PRACTICE_TIME_ZONE);
    if (input.purchasedOn > today) {
      return c.json({ error: 'bad_request', code: 'purchase_in_future', requestId }, 400);
    }
    if (input.purchasedOn < EARLIEST_SALE_ON) {
      return c.json({ error: 'bad_request', code: 'purchase_too_old', requestId }, 400);
    }
    const header = c.req.header('idempotency-key');
    let idempotencyKey: string | null = null;
    if (header !== undefined) {
      const parsed = IdempotencyKey.safeParse(header);
      if (!parsed.success) {
        return c.json({ error: 'bad_request', code: 'invalid_idempotency_key', requestId }, 400);
      }
      idempotencyKey = parsed.data;
    }
    const db = c.get('db');
    if (idempotencyKey !== null) {
      const seen = await replay(db, idempotencyKey);
      if (seen) return c.json(seen, 201);
    }

    const client = await db.query<{ id: string }>(CLIENT_SQL, [input.clientId]);
    if (!client.rows[0]) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    const priced = await db.query<{
      id: string;
      list_price_fils: number;
      discount_fils: number;
      discount_basis_points: number | null;
      vat_rate_basis_points: number;
      vat_setting_version: number;
      service_type_name: string;
      service_type_name_ar: string | null;
      vat_registered: boolean;
    }>(PRICE_SQL, [input.serviceTypeId, JURISDICTION, RECIPIENT_TYPE, input.purchasedOn]);
    const price = priced.rows[0];
    if (!price) {
      // No price in force on that day: nothing is sold rather than something
      // guessed, as the package sale refuses an unpriced bundle.
      return c.json({ error: 'unprocessable', code: 'not_priced', requestId }, 422);
    }
    if (input.extraDiscount && !mayDiscount(actor, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    let applied: AppliedDiscount;
    try {
      applied = combineDiscounts(
        fils(price.list_price_fils),
        { discountFils: fils(price.discount_fils), basisPoints: price.discount_basis_points },
        toDiscount(input.extraDiscount?.discount),
      );
    } catch {
      return c.json({ error: 'bad_request', code: 'discount_too_large', requestId }, 400);
    }
    const vat = resolveSaleVat(
      applied.netFils,
      { rateBasisPoints: price.vat_rate_basis_points, version: price.vat_setting_version },
      { vatRegistered: price.vat_registered },
    );
    const expiresOn = expiryOn(input.purchasedOn, SINGLE_SESSION_MONTHS);

    // Same defence sales.ts's own sale takes for the same reason: two presses
    // at once both read no invoice for the key and both go on to insert one;
    // the savepoint lets the loser recover onto the winner's row instead of
    // surfacing a 500 for a sale that in fact went through.
    if (idempotencyKey !== null) {
      await db.query('savepoint session_sale_attempt');
    }
    let invoice;
    try {
      invoice = await db.query<{ id: string; reference: string }>(INSERT_INVOICE_SQL, [
        input.clientId,
        input.purchasedOn,
        applied.netFils,
        vat.vatFils,
        vat.grossFils,
        idempotencyKey,
      ]);
    } catch (error) {
      if (idempotencyKey === null || !isDuplicateKey(error)) throw error;
      await db.query('rollback to savepoint session_sale_attempt');
      const seen = await replay(db, idempotencyKey);
      if (!seen) throw error;
      return c.json(seen, 201);
    }
    const invoiceId = invoice.rows[0]?.id;
    const reference = invoice.rows[0]?.reference;
    if (!invoiceId || !reference) {
      throw new Error('Insert of an invoice did not return an id and a reference.');
    }
    await db.query(INSERT_LINE_SQL, [
      invoiceId,
      input.clientId,
      price.service_type_name,
      price.service_type_name_ar,
      input.serviceTypeId,
      applied.listFils,
      applied.discountFils,
      applied.basisPoints,
      applied.netFils,
      vat.rateBasisPoints,
      price.vat_setting_version,
      vat.vatFils,
      vat.grossFils,
    ]);
    const credit = await db.query<{ id: string }>(INSERT_ENTITLEMENT_SQL, [
      input.clientId,
      input.serviceTypeId,
      invoiceId,
      applied.netFils,
      price.vat_rate_basis_points,
      price.vat_setting_version,
      expiresOn,
    ]);
    const entitlementId = credit.rows[0]?.id;
    if (!entitlementId) {
      throw new Error('Insert of an entitlement did not return an id.');
    }
    if (input.payment) {
      await db.query(INSERT_PAYMENT_SQL, [
        input.clientId,
        input.payment.method,
        input.payment.amountFils,
        now().toISOString(),
        input.payment.reference ?? null,
        invoiceId,
      ]);
    }
    return c.json(
      SellSessionResponse.parse({
        invoiceId,
        invoiceReference: reference,
        entitlementId,
        serviceTypeName: price.service_type_name,
        netFils: applied.netFils,
        vatFils: vat.vatFils,
        grossFils: vat.grossFils,
        expiresOn,
      }),
      201,
    );
  });
}
