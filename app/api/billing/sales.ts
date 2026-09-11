import type { Hono } from 'hono';
import {
  allocateEntitlements,
  combineDiscounts,
  expiryOn,
  resolveSaleVat,
  termWords,
  type AppliedDiscount,
  type PackageComponent,
} from '../../../domain/billing';
import { fils, isoDateIn } from '../../../domain/shared';
import type { ApiEnv } from '../_middleware/request-context';
import { maySell, mayDiscount } from './access';
import { toDiscount } from './schema';
import {
  IdempotencyKey,
  SellPackageInput,
  SellPackageResponse,
  type PurchaseRow,
} from './ledger-schema';
import { readPackages } from './packages';
import { readVatRegistered } from './supplier';

/**
 * `POST /api/billing/package-purchases` — a family buys a bundle.
 *
 * One request writes five things and they belong together: the purchase, the
 * invoice with its number, the invoice's line, the credits, and, when money
 * changed hands there and then, the payment. The request-context middleware
 * runs every route inside one transaction, so this is one transaction: a sale
 * that fails half-way leaves a practice with no half-sold package, no orphan
 * invoice number, and no credits a client did not pay for.
 *
 * **The price is still not typed here, and a discount is not a price.** The
 * sale takes the package price in force on the day of the purchase, from the
 * append-only list, and there is no `netFils` in the request body: selling at
 * a different *figure* means appending a price row first, which leaves a
 * reason behind it (the founder's arrangement of 2026-09-03).
 *
 * What the body may carry is an **extra discount** off the same list figure,
 * with a reason, given by the owner, an admin or finance and nobody else
 * (docs/SPEC/billing.md section 2.4, the operator's decision of 7 September
 * 2026). The price list's own discount and the extra are combined once by
 * `domain/billing/discount.ts`, so the invoice carries one discount rather
 * than two; the combined discount can never exceed the list figure, so a sale
 * never charges below nothing, and it can never be negative, so a sale never
 * charges more than the price list says.
 *
 * **The allocation.** Each credit carries its share of what was paid, worked
 * out from what its service costs on its own on the day of sale
 * (domain/billing/allocation.ts). The shares sum to the price exactly, and
 * the database refuses the transaction if they do not
 * (403_billing_entitlement.sql's deferred check).
 *
 * **VAT** comes from the rate stamped on the package price row, never typed
 * and never read off today's setting (CLAUDE.md rule 6) — and only while the
 * practice is registered for VAT. McWellness is not, so a sale today carries
 * none and the gross is the net (migration 406, docs/SPEC/billing.md section
 * 5.1). Prices are published net either way, so the family pays the figure the
 * price list showed; registering later adds five per cent on top of the same
 * net price and changes nothing already issued. The single-visit charge asks
 * the same question in SQL, in `app.charge_single_visit`.
 *
 * **The same press twice is one sale.** A sale writes into four tables that
 * grant no delete and no update, so a retried request — a double tap, a lost
 * response, a phone that changed network mid-request — would leave a second
 * purchase, a second invoice number, a second set of credits and a second
 * payment, correctable only by a credit note that does not exist yet. The
 * drawer generates an `Idempotency-Key` when the person presses the button
 * and sends it with every attempt of that press; a repeat replays the
 * original answer, from the row the first attempt wrote.
 */

const PRACTICE_TIME_ZONE = 'Asia/Dubai';

const CLIENT_SQL =
  "select id, status from client where tenant_id = app.current_tenant_id() and id = $1 and status <> 'erased'";

const INSERT_PURCHASE_SQL =
  'insert into package_purchase (tenant_id, client_id, package_id, package_name, package_name_ar, ' +
  'purchased_on, net_fils, vat_fils, vat_rate_basis_points, vat_setting_version, list_price_fils, ' +
  'discount_basis_points, discount_reason, expires_on, idempotency_key, created_by) ' +
  'values (app.current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, ' +
  'app.current_actor_id()) ' +
  'returning id, expires_on, status';

/** The practice opened in 2024; a sale before that is a mistyped year. */
const EARLIEST_SALE_ON = '2024-01-01';

/** The key a repeated press collides with (migration 403's `unique (tenant_id, idempotency_key)`). */
const PURCHASE_IDEMPOTENCY_CONSTRAINT = 'package_purchase_tenant_id_idempotency_key_key';

/**
 * Postgres: unique_violation on that key, and on no other — the same press
 * arriving twice. Named rather than assumed: replaying the first answer is
 * right only for the key, and a 23505 raised by anything else on the purchase
 * insert is a fault to be raised rather than a sale to be reported as already
 * made.
 */
function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === '23505' &&
    (error as { constraint?: string }).constraint === PURCHASE_IDEMPOTENCY_CONSTRAINT
  );
}

/**
 * A programme as the database holds it. Every statement that reads a purchase
 * selects these columns and hands the row to `purchaseRow` rather than
 * mapping it again: three copies of one mapping were three places for a new
 * field to be forgotten.
 */
export type PurchaseDbRow = {
  id: string;
  client_id: string;
  package_id: string;
  package_name: string;
  package_name_ar: string | null;
  purchased_on: string;
  net_fils: number;
  vat_fils: number;
  list_price_fils: number;
  discount_basis_points: number | null;
  discount_reason: string | null;
  /** Null when the programme was sold with no term at all (migration 412). */
  expires_on: string | null;
  status: PurchaseRow['status'];
  invoice_id: string | null;
};

/** One programme, as every screen and every response says it. */
export function purchaseRow(row: PurchaseDbRow): PurchaseRow {
  return {
    id: row.id,
    clientId: row.client_id,
    packageId: row.package_id,
    packageName: row.package_name,
    packageNameAr: row.package_name_ar,
    purchasedOn: row.purchased_on,
    netFils: row.net_fils,
    vatFils: row.vat_fils,
    grossFils: row.net_fils + row.vat_fils,
    listPriceFils: row.list_price_fils,
    // The gap between the list figure and what was charged; both are on the
    // row already, so the discount is never a third figure to keep right.
    discountFils: Math.max(0, row.list_price_fils - row.net_fils),
    discountBasisPoints: row.discount_basis_points,
    discountReason: row.discount_reason,
    // Null travels as null: a programme with no term has no date, and the
    // screen says so in words rather than showing an empty cell.
    expiresOn: row.expires_on,
    status: row.status,
    invoiceId: row.invoice_id,
  };
}

const REPLAY_SQL =
  'select p.id, p.client_id, p.package_id, p.package_name, p.package_name_ar, p.purchased_on, ' +
  'p.net_fils, p.vat_fils, p.list_price_fils, p.discount_basis_points, p.discount_reason, ' +
  'p.expires_on, p.status, p.invoice_id, i.reference, ' +
  '(select count(*)::int from entitlement e where e.package_purchase_id = p.id) as credits ' +
  'from package_purchase p left join invoice i on i.id = p.invoice_id ' +
  'where p.tenant_id = app.current_tenant_id() and p.idempotency_key = $1';

/**
 * The answer the first attempt gave, read back from what it wrote. Null when
 * this key has not been seen, which is the ordinary case.
 */
async function replaySale(
  db: {
    query: <R extends Record<string, unknown>>(t: string, p?: unknown[]) => Promise<{ rows: R[] }>;
  },
  key: string,
): Promise<SellPackageResponse | null> {
  const found = await db.query<PurchaseDbRow & { reference: string | null; credits: number }>(
    REPLAY_SQL,
    [key],
  );
  const row = found.rows[0];
  if (!row) {
    return null;
  }
  return SellPackageResponse.parse({
    purchase: purchaseRow(row),
    invoiceReference: row.reference ?? '',
    entitlements: row.credits,
  });
}

const INSERT_INVOICE_SQL =
  'insert into invoice (tenant_id, client_id, number, kind, issued_on, package_purchase_id, ' +
  'net_fils, vat_fils, gross_fils, created_by) values (app.current_tenant_id(), $1, ' +
  "app.next_invoice_number(), 'package', $2, $3, $4, $5, $6, app.current_actor_id()) " +
  'returning id, reference';

// The unit is the list figure and the net is what is charged, with the
// discount between them: the rendered invoice prints all three, and the check
// constraint holds net = quantity x unit - discount (migration 409).
const INSERT_LINE_SQL =
  'insert into invoice_line (tenant_id, invoice_id, client_id, line_no, description, ' +
  'description_ar, package_id, quantity, unit_net_fils, discount_fils, discount_basis_points, ' +
  'net_fils, vat_rate_basis_points, vat_setting_version, vat_fils, gross_fils, created_by) ' +
  'values (app.current_tenant_id(), $1, $2, 1, $3, $4, $5, 1, $6, $7, $8, $9, $10, $11, $12, $13, ' +
  'app.current_actor_id())';

// Every credit in one statement rather than forty-seven round trips.
const INSERT_ENTITLEMENTS_SQL =
  'insert into entitlement (tenant_id, client_id, service_type_id, source_type, ' +
  'package_purchase_id, allocated_net_fils, vat_rate_basis_points, vat_setting_version, ' +
  'expires_on, created_by) ' +
  "select app.current_tenant_id(), $1, e.service_type_id, 'package', $2, e.allocated_net_fils, " +
  '$3, $4, $5, app.current_actor_id() ' +
  'from unnest($6::uuid[], $7::int[]) as e(service_type_id, allocated_net_fils)';

const INSERT_PAYMENT_SQL =
  'insert into payment (tenant_id, client_id, method, amount_fils, received_at, reference, ' +
  'invoice_id, created_by) ' +
  'values (app.current_tenant_id(), $1, $2, $3, $4, $5, $6, app.current_actor_id())';

export function mountSales(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.post('/api/billing/package-purchases', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!maySell(actor, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const body = SellPackageInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const input = body.data;
    const today = isoDateIn(now(), PRACTICE_TIME_ZONE);
    if (input.purchasedOn > today) {
      // Money cannot have arrived tomorrow. Backdating a sale recorded late
      // is ordinary and stays allowed.
      return c.json({ error: 'bad_request', code: 'purchase_in_future', requestId }, 400);
    }
    // And not from before the practice existed. A far-past date is a typo or
    // a paste, and it would set an expiry that had already run out.
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
      const replay = await replaySale(db, idempotencyKey);
      if (replay) {
        // The same answer as the first attempt, including its invoice number:
        // the caller cannot tell a retry from the original, which is the whole
        // point of it being a retry.
        return c.json(replay, 201);
      }
    }

    const client = await db.query<{ id: string }>(CLIENT_SQL, [input.clientId]);
    if (!client.rows[0]) {
      return c.json({ error: 'not_found', requestId }, 404);
    }

    // The catalogue as it stood on the day of the sale: the package price and
    // every component's standalone price in force then, not today's.
    // The registration decides the money figures on the rows this returns;
    // the sale below reads it again, in one statement with the price row, for
    // the reason written there. Nothing here reads those figures — the sale
    // charges from the price and its own resolveSaleVat — but a list that
    // says one thing and a sale that charges another would be a trap for the
    // next reader.
    const packages = await readPackages(db, input.purchasedOn, await readVatRegistered(db));
    const bundle = packages.find((row) => row.id === input.packageId);
    if (!bundle) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (!bundle.sellable || bundle.currentPrice === null) {
      // Withdrawn, empty, unpriced, or holding a component with no price of
      // its own: any of the four means a share of the price cannot honestly
      // be worked out, so nothing is sold rather than something guessed.
      return c.json({ error: 'unprocessable', code: 'not_sellable', requestId }, 422);
    }

    const price = bundle.currentPrice;

    // An extra discount is the owner's, an admin's or finance's: the three
    // roles migration 408 lets forgive a charge. Refused before anything is
    // read, so a role that may sell but may not discount is told plainly
    // rather than quietly sold at the list price.
    if (input.extraDiscount && !mayDiscount(actor, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }

    // The price list's own discount and the extra, combined once against the
    // same list figure (domain/billing/discount.ts). Everything below charges
    // `applied.netFils`: the allocation, the VAT, the purchase, the line and
    // the invoice, so there is one net and the books read it as they always
    // have.
    let applied: AppliedDiscount;
    try {
      applied = combineDiscounts(
        fils(price.listPriceFils),
        { discountFils: fils(price.discountFils), basisPoints: price.discountBasisPoints },
        toDiscount(input.extraDiscount?.discount),
      );
    } catch {
      return c.json({ error: 'bad_request', code: 'discount_too_large', requestId }, 400);
    }

    const components: PackageComponent[] = bundle.components.map((component) => ({
      serviceTypeId: component.serviceTypeId,
      quantity: component.quantity,
      standaloneNetFils: fils(component.standaloneNetFils ?? 0),
    }));

    let allocation;
    try {
      allocation = allocateEntitlements(components, applied.netFils);
    } catch {
      // The one shape the catalogue's own `sellable` cannot rule out: every
      // component priced at zero, under a package that is not free.
      return c.json({ error: 'unprocessable', code: 'not_allocatable', requestId }, 422);
    }

    // The rate and the setting version the price row was stamped with, so the
    // purchase records the same VAT the price list showed, whatever today's
    // setting happens to be (CLAUDE.md rule 6) — and whether the practice may
    // charge it at all, which is the registration's to say and not the price
    // row's.
    //
    // Both in one statement, but the *stamp* happens in another: the invoice
    // insert below reads `tenant` again through app.stamp_invoice_supplier, and
    // under read committed that row can move between the two. What makes it safe
    // is not that it cannot happen but that only one direction is dangerous, and
    // that direction fails rather than lands. If the practice deregisters in
    // between, VAT is computed here and the stamp writes false, and
    // app.guard_invoice_vat (migration 406) refuses the insert — the whole sale
    // rolls back and nobody is charged tax under no registration. If it
    // registers in between, the sale charges no VAT under a live registration,
    // which is an undercharge the practice can correct rather than a
    // misstatement on a document.
    const stamped = await db.query<{ vat_setting_version: number; vat_registered: boolean }>(
      'select pp.vat_setting_version, app.tenant_charges_vat(app.current_tenant_id()) ' +
        'as vat_registered from package_price pp ' +
        'where pp.tenant_id = app.current_tenant_id() and pp.id = $1',
      [price.id],
    );
    const version = stamped.rows[0]?.vat_setting_version;
    if (version === undefined) {
      throw new Error('The package price just read has no VAT setting version.');
    }
    // VAT falls on the net after every discount, as UAE VAT values a supply
    // net of discounts (docs/SPEC/billing.md section 2.4).
    const vat = resolveSaleVat(
      applied.netFils,
      { rateBasisPoints: price.vatRateBasisPoints, version },
      { vatRegistered: stamped.rows[0]?.vat_registered === true },
    );

    // The bundle's own term, whatever it is — or none, in which case the
    // credits never expire and no date is written anywhere (the operator's
    // ruling of 12 September 2026). The rule is the domain's; the route reads
    // the row and writes what it answers.
    const expiresOn = expiryOn(input.purchasedOn, bundle.term);

    // Two presses at the same moment both read no purchase for the key, and
    // both go on to insert one. The second blocks on the unique index until
    // the first commits and then fails on it — which, without this, surfaced
    // as a 500 telling a coordinator that a sale which had in fact gone
    // through had failed. The savepoint is what makes the recovery possible:
    // a failed statement poisons the whole transaction otherwise, and this
    // request's transaction belongs to the middleware, not to this route.
    if (idempotencyKey !== null) {
      await db.query('savepoint sale_attempt');
    }
    let purchase;
    try {
      purchase = await db.query<{
        id: string;
        // Null for a programme sold with no term: its credits never expire
        // (migration 412), so there is no end date to return.
        expires_on: string | null;
        status: PurchaseRow['status'];
      }>(INSERT_PURCHASE_SQL, [
        input.clientId,
        bundle.id,
        bundle.name,
        bundle.nameAr,
        input.purchasedOn,
        applied.netFils,
        vat.vatFils,
        // The purchase records what was charged, so its rate is the charged
        // one; the credits below keep the price row's own standard rate, which
        // is a fact about the service and is never printed on a document.
        vat.rateBasisPoints,
        version,
        // The price row's own snapshot, not the bundle's published list: the
        // discount on this sale was taken off that figure, and the bundle's
        // may be edited tomorrow.
        applied.listFils,
        applied.basisPoints,
        input.extraDiscount?.reason ?? null,
        expiresOn,
        idempotencyKey,
      ]);
    } catch (error) {
      if (idempotencyKey === null || !isDuplicateKey(error)) {
        throw error;
      }
      await db.query('rollback to savepoint sale_attempt');
      // The transaction that won has committed by now — it held the index
      // entry this one waited on — so its rows are readable here.
      const replay = await replaySale(db, idempotencyKey);
      if (!replay) {
        throw error;
      }
      return c.json(replay, 201);
    }

    const purchaseId = purchase.rows[0]?.id;
    if (!purchaseId) {
      throw new Error('Insert of a package purchase did not return an id.');
    }

    const invoice = await db.query<{ id: string; reference: string }>(INSERT_INVOICE_SQL, [
      input.clientId,
      input.purchasedOn,
      purchaseId,
      applied.netFils,
      vat.vatFils,
      vat.grossFils,
    ]);
    const invoiceId = invoice.rows[0]?.id;
    const reference = invoice.rows[0]?.reference;
    if (!invoiceId || !reference) {
      throw new Error('Insert of an invoice did not return an id and a reference.');
    }

    // The line stamps the rate that was *charged*, which is zero while the
    // practice is unregistered, not the rate the price row records. The
    // rendered document reads the line, so the two must not disagree.
    //
    // The term is said here too, in both languages: the operator's decision 9
    // (docs/PLAN/package-terms.md) is that a programme's length is on the
    // invoice, not only in the Sell drawer the family saw once. A programme
    // with no term names none — the line is the bundle's name and nothing
    // after it, rather than a form of words about credits that never expire.
    const term = termWords(bundle.term);
    const description = term ? `${bundle.name}, ${term.en}` : bundle.name;
    const descriptionAr =
      bundle.nameAr === null ? null : term ? `${bundle.nameAr}، ${term.ar}` : bundle.nameAr;
    await db.query(INSERT_LINE_SQL, [
      invoiceId,
      input.clientId,
      description,
      descriptionAr,
      bundle.id,
      applied.listFils,
      applied.discountFils,
      applied.basisPoints,
      applied.netFils,
      vat.rateBasisPoints,
      version,
      vat.vatFils,
      vat.grossFils,
    ]);

    await db.query('update package_purchase set invoice_id = $1 where id = $2', [
      invoiceId,
      purchaseId,
    ]);

    await db.query(INSERT_ENTITLEMENTS_SQL, [
      input.clientId,
      purchaseId,
      price.vatRateBasisPoints,
      version,
      expiresOn,
      allocation.map((unit) => unit.serviceTypeId),
      allocation.map((unit) => unit.allocatedNetFils),
    ]);

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
      SellPackageResponse.parse({
        purchase: {
          id: purchaseId,
          clientId: input.clientId,
          packageId: bundle.id,
          packageName: bundle.name,
          packageNameAr: bundle.nameAr,
          purchasedOn: input.purchasedOn,
          netFils: applied.netFils,
          vatFils: vat.vatFils,
          grossFils: vat.grossFils,
          listPriceFils: applied.listFils,
          discountFils: applied.discountFils,
          discountBasisPoints: applied.basisPoints,
          discountReason: input.extraDiscount?.reason ?? null,
          expiresOn,
          status: 'active',
          invoiceId,
        },
        invoiceReference: reference,
        entitlements: allocation.length,
      }),
      201,
    );
  });
}
