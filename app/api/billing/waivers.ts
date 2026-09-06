import type { Hono } from 'hono';
import { scrubReason } from '../_middleware/request-context';
import type { ApiEnv } from '../_middleware/request-context';
import { isUuid } from './ids';
import { mayWaive } from './access';
import {
  WaiveCallOutFeeInput,
  WaiveCallOutFeeResponse,
  WaiveEntitlementInput,
  WaiveEntitlementResponse,
} from './ledger-schema';

/**
 * `POST /api/billing/entitlements/:id/waiver` — the one-click waiver
 * docs/SPEC/billing.md section 4.3 asks for, with the reason field it asks
 * for too.
 *
 * A visit called off inside the notice period takes a credit
 * (404_billing_consumption.sql). Sometimes it should not have: the family had
 * a genuine emergency, or the practice moved something. This gives the credit
 * back.
 *
 * **It gives it back without rewriting what happened.** The consumed row
 * moves to `waived` and carries the reason and the person, and a replacement
 * credit is written beside it — same service, same allocated value, same
 * expiry, pointing back at the row it stands in for. The client is whole, the
 * late cancellation is still on the record, and the balance counts the waived
 * row as neither delivered nor remaining (domain/billing/balance.ts). A
 * database constraint holds the sale's credits to the price paid across the
 * swap (403's `check_allocation`), so the arithmetic cannot drift.
 *
 * Only a credit taken by a cancellation or a no-show may be waived. A
 * delivered session is not waivable here: the family had the visit, and
 * unwinding that is a credit note, not a waiver.
 */

const ENTITLEMENT_SQL =
  'select id, client_id, service_type_id, source_type, package_purchase_id, invoice_id, ' +
  'allocated_net_fils, vat_rate_basis_points, vat_setting_version, status, consumption_kind, ' +
  'expires_on from entitlement where tenant_id = app.current_tenant_id() and id = $1';

const WAIVE_SQL =
  "update entitlement set status = 'waived', waiver_reason = $2, waived_at = now(), " +
  'waived_by = app.current_actor_id() where id = $1';

const REPLACEMENT_SQL =
  'insert into entitlement (tenant_id, client_id, service_type_id, source_type, ' +
  'package_purchase_id, invoice_id, allocated_net_fils, vat_rate_basis_points, ' +
  'vat_setting_version, expires_on, replaces_entitlement_id, created_by) ' +
  'values (app.current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, ' +
  'app.current_actor_id()) returning id';

type EntitlementDbRow = {
  id: string;
  client_id: string;
  service_type_id: string;
  source_type: 'package' | 'single' | 'insurance' | 'complimentary';
  package_purchase_id: string | null;
  invoice_id: string | null;
  allocated_net_fils: number;
  vat_rate_basis_points: number;
  vat_setting_version: number;
  status: 'available' | 'consumed' | 'expired' | 'refunded' | 'waived';
  consumption_kind: 'session' | 'late_cancellation' | 'no_show' | null;
  expires_on: string | null;
};

const WAIVE_FEE_SQL = 'select waived, gross_fils from app.waive_call_out_fee($1, $2)';

const FEE_INVOICE_SQL =
  'select id, kind::text as kind, waived_at from invoice ' +
  'where tenant_id = app.current_tenant_id() and id = $1';

/**
 * `POST /api/billing/invoices/:id/waiver` — forgiving a call-out fee
 * (migration 408, the founder's decision of 2026-09-04).
 *
 * The same door as the credit waiver above, for the row the ledger's shape
 * gives this act to reach. A visit called off inside the notice period no
 * longer takes one of the family's sessions; it posts the practice's call-out
 * fee as a charge. Sometimes it should not have — the family had a genuine
 * emergency — and section 4.3's "one-click waiver with a reason field" is the
 * way back, whatever the charge is made of.
 *
 * **It forgives without rewriting what happened.** The invoice stays, with its
 * number, its line and the visit it names; `waived_at`, `waived_by` and
 * `waiver_reason` say the practice let it go, and `app.billing_ledger` stops
 * counting it towards what the family owes. `invoice` grants no update to any
 * caller, so the one transition it has goes through
 * `app.waive_call_out_fee`, a security definer door that can set exactly these
 * three columns on exactly one kind of invoice.
 *
 * Only a call-out fee is waivable. A session or a package invoice is a bill
 * for something the family had, and unwinding one of those is a credit note
 * and a conversation, not a switch.
 */
function mountCallOutFeeWaiver(api: Hono<ApiEnv>, now: () => Date): void {
  api.post('/api/billing/invoices/:id/waiver', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!mayWaive(actor, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const invoiceId = c.req.param('id');
    if (!isUuid(invoiceId)) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const body = WaiveCallOutFeeInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const db = c.get('db');

    // Read first, so a caller is told which of the three things went wrong
    // rather than being handed one refusal for all of them. The definer door
    // below asks the same questions again for itself, because it runs with row
    // security switched off.
    const found = await db.query<{ id: string; kind: string; waived_at: Date | null }>(
      FEE_INVOICE_SQL,
      [invoiceId],
    );
    const invoice = found.rows[0];
    if (!invoice) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (invoice.kind !== 'call_out_fee') {
      return c.json({ error: 'conflict', code: 'not_a_fee', requestId }, 409);
    }
    if (invoice.waived_at !== null) {
      return c.json({ error: 'conflict', code: 'already_waived', requestId }, 409);
    }

    // Why the charge was forgiven belongs in the audit trail, not only in the
    // column: the update this makes is stamped by the row trigger with
    // `app.reason`, and the route is the authority on that reason
    // (docs/SPEC/audit.md section 5), not a header the browser may or may not
    // have sent.
    await db.query("select set_config('app.reason', $1, true)", [scrubReason(body.data.reason)]);

    const waived = await db.query<{ waived: boolean; gross_fils: number }>(WAIVE_FEE_SQL, [
      invoiceId,
      body.data.reason,
    ]);
    const row = waived.rows[0];
    // Nothing was written: somebody waived it between the read above and this
    // write. That is not an error to raise — the fee is forgiven either way —
    // but it is not this caller's waiver to report either.
    if (!row?.waived) {
      return c.json({ error: 'conflict', code: 'already_waived', requestId }, 409);
    }

    return c.json(
      WaiveCallOutFeeResponse.parse({
        waivedInvoiceId: invoiceId,
        waivedGrossFils: row.gross_fils,
      }),
      201,
    );
  });
}

export function mountWaivers(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  mountCallOutFeeWaiver(api, now);

  api.post('/api/billing/entitlements/:id/waiver', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!mayWaive(actor, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const entitlementId = c.req.param('id');
    // An id from the path, checked as a uuid before it reaches a query, the
    // way the invoice book checks its own filter.
    if (!isUuid(entitlementId)) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const body = WaiveEntitlementInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const db = c.get('db');

    const found = await db.query<EntitlementDbRow>(ENTITLEMENT_SQL, [entitlementId]);
    const credit = found.rows[0];
    if (!credit) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (credit.status !== 'consumed') {
      return c.json({ error: 'conflict', code: 'not_consumed', requestId }, 409);
    }
    if (credit.consumption_kind === 'session') {
      return c.json({ error: 'conflict', code: 'session_delivered', requestId }, 409);
    }

    // Why the charge was forgiven belongs in the audit trail, not only in the
    // column: the two rows this writes are an `update` and an `insert` the
    // trigger stamps with `app.reason`, and the route is the authority on
    // that reason (docs/SPEC/audit.md section 5), not a header the browser
    // may or may not have sent.
    await db.query("select set_config('app.reason', $1, true)", [scrubReason(body.data.reason)]);

    await db.query(WAIVE_SQL, [credit.id, body.data.reason]);
    const replacement = await db.query<{ id: string }>(REPLACEMENT_SQL, [
      credit.client_id,
      credit.service_type_id,
      credit.source_type,
      credit.package_purchase_id,
      credit.invoice_id,
      credit.allocated_net_fils,
      credit.vat_rate_basis_points,
      credit.vat_setting_version,
      credit.expires_on,
      credit.id,
    ]);
    const replacementId = replacement.rows[0]?.id;
    if (!replacementId) {
      throw new Error('Insert of a replacement credit did not return an id.');
    }

    return c.json(
      WaiveEntitlementResponse.parse({
        waivedEntitlementId: credit.id,
        replacementEntitlementId: replacementId,
      }),
      201,
    );
  });
}
