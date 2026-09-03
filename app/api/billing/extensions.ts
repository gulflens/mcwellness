import type { Hono } from 'hono';
import { isoDateIn } from '../../../domain/shared';
import { scrubReason } from '../_middleware/request-context';
import type { ApiEnv } from '../_middleware/request-context';
import { isUuid } from './ids';
import { mayExtend } from './access';
import { ExtendPurchaseInput, ExtendPurchaseResponse } from './ledger-schema';

/**
 * `POST /api/billing/package-purchases/:id/extension` — a programme gets
 * longer.
 *
 * Twelve months is the founder's decision of 2026-09-03, and so is the
 * escape from it: an extension is the coordinator's discretion and always
 * carries a reason. The reason is the whole point of the route. A family
 * whose programme ran out during a hospital stay is not the same as one that
 * simply did not book, and the practice should be able to see, a year later,
 * which it was.
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

const PRACTICE_TIME_ZONE = 'Asia/Dubai';

const PURCHASE_SQL =
  'select id, client_id, expires_on, extended_to, status from package_purchase ' +
  'where tenant_id = app.current_tenant_id() and id = $1';

const EXTEND_SQL =
  'update package_purchase set extended_to = $2, extension_reason = $3 where id = $1 ' +
  'returning id, client_id, package_id, package_name, package_name_ar, purchased_on, ' +
  'net_fils, vat_fils, list_price_fils, expires_on, extended_to, extension_reason, status, ' +
  'invoice_id';

type PurchaseDbRow = {
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
  status: 'active' | 'completed' | 'expired' | 'refunded' | 'cancelled';
  invoice_id: string | null;
};

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

    // Later than the date it replaces, which is the extension already in
    // force when there is one. The database says the same
    // (package_purchase_extension_moves_forward), and this says it as an
    // answer a person can read rather than as a 500.
    const currentEnd = purchase.extended_to ?? purchase.expires_on;
    if (input.extendedTo <= currentEnd) {
      return c.json({ error: 'bad_request', code: 'not_later', requestId }, 400);
    }
    const today = isoDateIn(now(), PRACTICE_TIME_ZONE);
    if (input.extendedTo < today) {
      return c.json({ error: 'bad_request', code: 'date_in_past', requestId }, 400);
    }

    await db.query("select set_config('app.reason', $1, true)", [scrubReason(input.reason)]);

    const updated = await db.query<PurchaseDbRow>(EXTEND_SQL, [
      purchaseId,
      input.extendedTo,
      input.reason,
    ]);
    const row = updated.rows[0];
    if (!row) {
      throw new Error('The extension updated no purchase.');
    }

    return c.json(
      ExtendPurchaseResponse.parse({
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
      }),
      201,
    );
  });
}
