import type { Hono } from 'hono';
import {
  allocateEntitlements,
  expiryOn,
  resolveVat,
  type PackageComponent,
} from '../../../domain/billing';
import { fils, isoDateIn } from '../../../domain/shared';
import type { ApiEnv } from '../_middleware/request-context';
import { maySell } from './access';
import {
  IdempotencyKey,
  SellPackageInput,
  SellPackageResponse,
  type PurchaseRow,
} from './ledger-schema';
import { readPackages } from './packages';

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
 * **The price is not typed here.** The sale takes the package price in force
 * on the day of the purchase, from the append-only list. Selling at a
 * different figure means appending a price row first, which leaves a reason
 * behind it — the founder's own arrangement (2026-09-03: a package price is a
 * figure she sets), and the reason there is no `netFils` in the request body.
 *
 * **The allocation.** Each credit carries its share of what was paid, worked
 * out from what its service costs on its own on the day of sale
 * (domain/billing/allocation.ts). The shares sum to the price exactly, and
 * the database refuses the transaction if they do not
 * (403_billing_entitlement.sql's deferred check).
 *
 * **VAT** comes from the rate stamped on the package price row, never typed
 * and never read off today's setting (CLAUDE.md rule 6). Prices are net; VAT
 * is added on top at write time.
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
  'expires_on, idempotency_key, created_by) ' +
  'values (app.current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, ' +
  'app.current_actor_id()) ' +
  'returning id, expires_on, status';

/** The practice opened in 2024; a sale before that is a mistyped year. */
const EARLIEST_SALE_ON = '2024-01-01';

const REPLAY_SQL =
  'select p.id, p.client_id, p.package_id, p.package_name, p.package_name_ar, p.purchased_on, ' +
  'p.net_fils, p.vat_fils, p.list_price_fils, p.expires_on, p.extended_to, p.extension_reason, ' +
  'p.status, p.invoice_id, i.reference, ' +
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
  const found = await db.query<{
    id: string;
    client_id: string;
    package_id: string;
    package_name: string;
    package_name_ar: string | null;
    purchased_on: string;
    net_fils: number;
    vat_fils: number;
    list_price_fils: number;
    expires_on: string;
    extended_to: string | null;
    extension_reason: string | null;
    status: PurchaseRow['status'];
    invoice_id: string | null;
    reference: string | null;
    credits: number;
  }>(REPLAY_SQL, [key]);
  const row = found.rows[0];
  if (!row) {
    return null;
  }
  return SellPackageResponse.parse({
    purchase: {
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
      expiresOn: row.expires_on,
      extendedTo: row.extended_to,
      extensionReason: row.extension_reason,
      status: row.status,
      invoiceId: row.invoice_id,
    },
    invoiceReference: row.reference ?? '',
    entitlements: row.credits,
  });
}

const INSERT_INVOICE_SQL =
  'insert into invoice (tenant_id, client_id, number, kind, issued_on, package_purchase_id, ' +
  'net_fils, vat_fils, gross_fils, created_by) values (app.current_tenant_id(), $1, ' +
  "app.next_invoice_number(), 'package', $2, $3, $4, $5, $6, app.current_actor_id()) " +
  'returning id, reference';

const INSERT_LINE_SQL =
  'insert into invoice_line (tenant_id, invoice_id, client_id, line_no, description, ' +
  'description_ar, package_id, quantity, unit_net_fils, net_fils, vat_rate_basis_points, ' +
  'vat_setting_version, vat_fils, gross_fils, created_by) ' +
  'values (app.current_tenant_id(), $1, $2, 1, $3, $4, $5, 1, $6, $6, $7, $8, $9, $10, ' +
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
    const packages = await readPackages(db, input.purchasedOn);
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
    const components: PackageComponent[] = bundle.components.map((component) => ({
      serviceTypeId: component.serviceTypeId,
      quantity: component.quantity,
      standaloneNetFils: fils(component.standaloneNetFils ?? 0),
    }));

    let allocation;
    try {
      allocation = allocateEntitlements(components, fils(price.amountFils));
    } catch {
      // The one shape the catalogue's own `sellable` cannot rule out: every
      // component priced at zero, under a package that is not free.
      return c.json({ error: 'unprocessable', code: 'not_allocatable', requestId }, 422);
    }

    // The rate and the setting version the price row was stamped with, so the
    // purchase records the same VAT the price list showed, whatever today's
    // setting happens to be (CLAUDE.md rule 6).
    const stamped = await db.query<{ vat_setting_version: number }>(
      'select vat_setting_version from package_price ' +
        'where tenant_id = app.current_tenant_id() and id = $1',
      [price.id],
    );
    const version = stamped.rows[0]?.vat_setting_version;
    if (version === undefined) {
      throw new Error('The package price just read has no VAT setting version.');
    }
    const vat = resolveVat(fils(price.amountFils), {
      rateBasisPoints: price.vatRateBasisPoints,
      version,
    });

    const expiresOn = expiryOn(input.purchasedOn, bundle.expiryMonths);

    const purchase = await db.query<{
      id: string;
      expires_on: string;
      status: PurchaseRow['status'];
    }>(INSERT_PURCHASE_SQL, [
      input.clientId,
      bundle.id,
      bundle.name,
      bundle.nameAr,
      input.purchasedOn,
      price.amountFils,
      vat.vatFils,
      price.vatRateBasisPoints,
      version,
      bundle.listPriceFils,
      expiresOn,
      idempotencyKey,
    ]);
    const purchaseId = purchase.rows[0]?.id;
    if (!purchaseId) {
      throw new Error('Insert of a package purchase did not return an id.');
    }

    const invoice = await db.query<{ id: string; reference: string }>(INSERT_INVOICE_SQL, [
      input.clientId,
      input.purchasedOn,
      purchaseId,
      price.amountFils,
      vat.vatFils,
      vat.grossFils,
    ]);
    const invoiceId = invoice.rows[0]?.id;
    const reference = invoice.rows[0]?.reference;
    if (!invoiceId || !reference) {
      throw new Error('Insert of an invoice did not return an id and a reference.');
    }

    await db.query(INSERT_LINE_SQL, [
      invoiceId,
      input.clientId,
      bundle.name,
      bundle.nameAr,
      bundle.id,
      price.amountFils,
      price.vatRateBasisPoints,
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
          netFils: price.amountFils,
          vatFils: vat.vatFils,
          grossFils: vat.grossFils,
          listPriceFils: bundle.listPriceFils,
          expiresOn,
          extendedTo: null,
          extensionReason: null,
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
