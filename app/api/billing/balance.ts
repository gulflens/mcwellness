import type { Hono } from 'hono';
import {
  balanceFor,
  outstandingBalanceFils,
  type EntitlementRecord,
} from '../../../domain/billing';
import { fils, isoDateIn } from '../../../domain/shared';
import type { ApiEnv } from '../_middleware/request-context';
import { logRead } from '../_middleware/audit';
import { mayReadBalance } from './access';
import { BalanceResponse } from './ledger-schema';

/**
 * `GET /api/billing/clients/:clientId/balance` — what a family has left and
 * what it owes.
 *
 * The one billing route a practitioner may call. Their reach is not decided
 * here: row security scopes every row they can read to a client on their own
 * schedule (201_client_visible_to_practitioner.sql), so a practitioner asking
 * about somebody else's client gets an empty ledger and a 404, not a refusal
 * that confirms the client exists. That distinction matters — a 403 on a
 * record you may not see still tells you it is there.
 *
 * Every figure is derived, none stored (docs/SPEC/billing.md section 1).
 * The credits come out of `entitlement` and go through
 * domain/billing/balance.ts; the money comes out of the `app.billing_ledger`
 * view and goes through `outstandingBalanceFils`. Reading it writes one
 * `read` row to the audit trail, because a balance is a fact about a person.
 */

const PRACTICE_TIME_ZONE = 'Asia/Dubai';

// Row security is what scopes this; the explicit tenant predicate is the
// second lock, so a mistaken query fails in review rather than in production.
const CLIENT_SQL = 'select id from client where tenant_id = app.current_tenant_id() and id = $1';

const ENTITLEMENTS_SQL =
  'select e.service_type_id, st.code as service_type_code, st.name as service_type_name, ' +
  'st.name_ar as service_type_name_ar, e.status, e.allocated_net_fils, e.consumption_kind, ' +
  // A purchase the coordinator extended runs to the new date; the original
  // stays on the row, so what was granted and what was agreed are both legible.
  'coalesce(pp.extended_to, e.expires_on) as expires_on ' +
  'from entitlement e join service_type st on st.id = e.service_type_id ' +
  'left join package_purchase pp on pp.id = e.package_purchase_id ' +
  'where e.tenant_id = app.current_tenant_id() and e.client_id = $1 ' +
  'order by e.created_at, e.id';

const LEDGER_SQL =
  'select entry_kind, amount_fils from app.billing_ledger ' +
  'where tenant_id = app.current_tenant_id() and client_id = $1';

const PURCHASES_SQL =
  'select id, client_id, package_id, package_name, package_name_ar, purchased_on, net_fils, ' +
  'vat_fils, list_price_fils, expires_on, extended_to, extension_reason, status, invoice_id ' +
  'from package_purchase where tenant_id = app.current_tenant_id() and client_id = $1 ' +
  'order by purchased_on desc, id';

type EntitlementDbRow = {
  service_type_id: string;
  service_type_code: string;
  service_type_name: string;
  service_type_name_ar: string | null;
  status: EntitlementRecord['status'];
  allocated_net_fils: number;
  consumption_kind: EntitlementRecord['consumptionKind'];
  expires_on: string | null;
};

export function mountBalance(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/billing/clients/:clientId/balance', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    const clientId = c.req.param('clientId');
    // No `clientIds` is passed: resolving a contact's own household is the
    // portal stream's, and until it exists a client contact is refused rather
    // than quietly shown a household that may not be theirs.
    if (!mayReadBalance(actor, clientId, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const db = c.get('db');

    const client = await db.query<{ id: string }>(CLIENT_SQL, [clientId]);
    if (!client.rows[0]) {
      return c.json({ error: 'not_found', requestId }, 404);
    }

    const [entitlements, ledger, purchases] = await Promise.all([
      db.query<EntitlementDbRow>(ENTITLEMENTS_SQL, [clientId]),
      db.query<{ entry_kind: string; amount_fils: number }>(LEDGER_SQL, [clientId]),
      db.query<{
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
      }>(PURCHASES_SQL, [clientId]),
    ]);

    const today = isoDateIn(now(), PRACTICE_TIME_ZONE);
    const balance = balanceFor(
      entitlements.rows.map((row) => ({
        serviceTypeId: row.service_type_id,
        status: row.status,
        allocatedNetFils: fils(row.allocated_net_fils),
        expiresOn: row.expires_on,
        consumptionKind: row.consumption_kind,
      })),
      today,
    );

    // The service names, so a screen never has to fetch the catalogue to say
    // which credits it is counting.
    const namesById = new Map(
      entitlements.rows.map((row) => [
        row.service_type_id,
        {
          code: row.service_type_code,
          name: row.service_type_name,
          nameAr: row.service_type_name_ar,
        },
      ]),
    );

    const charged = ledger.rows.filter((row) => row.entry_kind === 'charge');
    const paid = ledger.rows.filter((row) => row.entry_kind === 'payment');
    const chargedFils = charged.reduce((total, row) => total + row.amount_fils, 0);
    // A payment is stored with the opposite sign so the balance is a plain sum.
    const paidFils = paid.reduce((total, row) => total - row.amount_fils, 0);

    await logRead(db, 'billing_ledger', clientId, clientId);

    return c.json(
      BalanceResponse.parse({
        clientId,
        services: balance.services.map((service) => {
          const named = namesById.get(service.serviceTypeId);
          return {
            serviceTypeId: service.serviceTypeId,
            serviceTypeCode: named?.code ?? '',
            serviceTypeName: named?.name ?? '',
            serviceTypeNameAr: named?.nameAr ?? null,
            purchased: service.purchased,
            delivered: service.delivered,
            forfeited: service.forfeited,
            remaining: service.remaining,
            lapsed: service.lapsed,
            remainingValueNetFils: service.remainingValueNetFils,
            nextExpiryOn: service.nextExpiryOn,
            expiryWarning: service.expiryWarning,
          };
        }),
        delivered: balance.delivered,
        remaining: balance.remaining,
        remainingValueNetFils: balance.remainingValueNetFils,
        nextExpiryOn: balance.nextExpiryOn,
        expiryWarning: balance.expiryWarning,
        outstandingFils: outstandingBalanceFils(
          charged.map((row) => ({ grossFils: fils(row.amount_fils) })),
          paid.map((row) => ({ amountFils: fils(-row.amount_fils) })),
        ),
        chargedFils,
        paidFils,
        purchases: purchases.rows.map((row) => ({
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
        })),
      }),
    );
  });
}
