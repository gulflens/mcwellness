import type { Hono } from 'hono';
import { nextExtension } from '../../../domain/billing';
import { scrubReason } from '../_middleware/request-context';
import type { ApiEnv } from '../_middleware/request-context';
import { isUuid } from './ids';
import { mayExtend } from './access';
import { ExtendPurchaseInput, ExtendPurchaseResponse } from './ledger-schema';
import { EXTENSIONS_USED_SQL, purchaseRow, type PurchaseDbRow } from './sales';

/**
 * `POST /api/billing/package-purchases/:id/extension` — a programme gets
 * longer.
 *
 * Six months is the operator's decision 9 of 2026-09-10, and so is the
 * escape from it: a programme may be extended twice, by exactly three months
 * each, so it runs twelve months at most — the term it had before, reached
 * only by asking. The body carries a reason and nothing else. The length is
 * not the coordinator's to choose and neither is the count: the third
 * request is refused for everybody, the owner included, because a limit that
 * bends for whoever asks loudest is not a limit
 * (docs/PLAN/package-terms.md).
 *
 * The reason is the whole point of what remains. A family whose programme
 * ran out during a hospital stay is not the same as one that simply did not
 * book, and the practice should be able to see, a year later, which it was.
 *
 * **Both readers of an expiry now agree.** `domain/billing/balance.ts` counts
 * a credit as remaining while the extension holds, and
 * `app.oldest_available_entitlement` finds that same credit when the visit is
 * delivered (403_billing_entitlement.sql). Before, only the first of those
 * knew about extensions, so an extended programme showed sessions remaining
 * while every delivered visit found no credit and raised a fresh single-visit
 * invoice: the family paid twice for what they had already bought.
 *
 * **The reason reaches the audit trail.** It is stamped onto `app.reason` for
 * the rest of the transaction, so the `update` row the audit trigger writes
 * carries it without the screen having to remember a header
 * (docs/SPEC/audit.md section 5). The route is the authority on why this
 * particular write happened; a header the browser may or may not have sent
 * is not.
 */

const PURCHASE_SQL =
  'select id, client_id, expires_on, extended_to, status from package_purchase ' +
  'where tenant_id = app.current_tenant_id() and id = $1';

const USED_SQL =
  'select count(*)::int as n from package_extension ' +
  'where tenant_id = app.current_tenant_id() and purchase_id = $1';

const INSERT_EXTENSION_SQL =
  'insert into package_extension (tenant_id, client_id, purchase_id, ordinal, from_on, to_on, ' +
  'reason, created_by) ' +
  'values (app.current_tenant_id(), $1, $2, $3, $4, $5, $6, app.current_actor_id())';

// Aliased so the returning list can carry the count of extensions the same
// way every other read of a purchase does, this transaction's new row
// included.
const EXTEND_SQL =
  'update package_purchase p set extended_to = $2, extension_reason = $3 where p.id = $1 ' +
  'returning p.id, p.client_id, p.package_id, p.package_name, p.package_name_ar, ' +
  'p.purchased_on, p.net_fils, p.vat_fils, p.list_price_fils, p.discount_basis_points, ' +
  'p.discount_reason, p.expires_on, p.extended_to, p.extension_reason, p.status, ' +
  'p.invoice_id, ' +
  EXTENSIONS_USED_SQL;

export function mountExtensions(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.post('/api/billing/package-purchases/:id/extension', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!mayExtend(actor, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const purchaseId = c.req.param('id');
    if (!isUuid(purchaseId)) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const body = ExtendPurchaseInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const input = body.data;
    const db = c.get('db');

    const found = await db.query<{
      id: string;
      client_id: string;
      expires_on: string;
      extended_to: string | null;
      status: PurchaseDbRow['status'];
    }>(PURCHASE_SQL, [purchaseId]);
    const purchase = found.rows[0];
    if (!purchase) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (purchase.status === 'refunded' || purchase.status === 'cancelled') {
      // A programme that has been refunded or called off is not one whose
      // time can be extended; giving it more would be giving away sessions
      // nobody is holding.
      return c.json({ error: 'conflict', code: 'not_extendable', requestId }, 409);
    }

    // Three months from the end it has now, which is the extension already in
    // force when there is one; and nothing at all once it has had its two.
    // The count is the database's rather than a number kept on the purchase
    // row, so two coordinators asking at once cannot both be the second: the
    // unique key on (purchase_id, ordinal) refuses the loser (migration 410).
    const currentEnd = purchase.extended_to ?? purchase.expires_on;
    const used = await db.query<{ n: number }>(USED_SQL, [purchaseId]);
    const next = nextExtension(currentEnd, used.rows[0]?.n ?? 0);
    if (next === null) {
      return c.json({ error: 'conflict', code: 'extension_limit_reached', requestId }, 409);
    }

    await db.query("select set_config('app.reason', $1, true)", [scrubReason(input.reason)]);

    await db.query(INSERT_EXTENSION_SQL, [
      purchase.client_id,
      purchaseId,
      next.ordinal,
      next.fromOn,
      next.toOn,
      input.reason,
    ]);

    // The purchase keeps the latest extension's end and reason beside the
    // date it was sold with, which is what every reader of a programme's end
    // already reads (migration 410's header).
    const updated = await db.query<PurchaseDbRow>(EXTEND_SQL, [
      purchaseId,
      next.toOn,
      input.reason,
    ]);
    const row = updated.rows[0];
    if (!row) {
      throw new Error('The extension updated no purchase.');
    }

    return c.json(ExtendPurchaseResponse.parse({ purchase: purchaseRow(row) }), 201);
  });
}
