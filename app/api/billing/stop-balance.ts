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
import { StopBalanceResponse } from './document-schema';
import { isUuid } from './ids';

/**
 * `GET /api/billing/clients/:clientId/stop-balance` — the two things a stop
 * card says, and nothing else.
 *
 * **Why this exists beside the full balance route.** The practitioner's stop
 * card shows "Session 3 of 15" and what is owed at the door, and until now it
 * read `GET /api/billing/clients/:id/balance` to get them. That route answers
 * the console's whole picture — every purchase with its net, its VAT and its
 * list price, the reason a coordinator extended one, invoice ids, the
 * recognised and deferred figures — which is the practice's commercial position
 * and has no business sitting in a phone at somebody's front door. The
 * permission was never the problem: a practitioner is entitled to both figures,
 * and `db/policies/billing/ledger.sql` scopes which client they may ask about.
 * What was wrong was the size of the answer.
 *
 * So: a second route, deliberately narrower, and the full one stays exactly as
 * it is for the console (`./balance.ts`). **The body is the whole boundary** —
 * per service a code and three counts, and one outstanding figure. No money per
 * credit, no purchase, no expiry, no reason anybody wrote down.
 *
 * **The same door and the same trail** as the balance route: `mayReadBalance`
 * says the role may ask, `app.client_visible_to_practitioner` (ninety days back,
 * thirty forward, confirmed visits only) says which client, and a practitioner
 * asking about somebody else's client reads an empty ledger and gets a 404
 * rather than a refusal that confirms the record exists. Reading it is a fact
 * about a person, so it writes one `read` row, exactly as the full route does.
 */

const PRACTICE_TIME_ZONE = 'Asia/Dubai';

// Row security is what scopes this; the explicit tenant predicate is the second
// lock, so a mistaken query fails in review rather than in production.
const CLIENT_SQL = 'select id from client where tenant_id = app.current_tenant_id() and id = $1';

// The allocated value is read because the balance engine needs it to count, and
// it is never answered: what a family paid per credit is not a doorstep fact.
const ENTITLEMENTS_SQL =
  'select e.service_type_id, st.code as service_type_code, e.status, e.allocated_net_fils, ' +
  // The credit's own date, null when it has none: the balance engine reads a
  // null as a credit that never lapses, so a termless credit still counts on
  // the stop card. No date reaches the card either way — it shows counts.
  'e.consumption_kind, e.expires_on ' +
  'from entitlement e join service_type st on st.id = e.service_type_id ' +
  'where e.tenant_id = app.current_tenant_id() and e.client_id = $1 ' +
  'order by e.created_at, e.id';

const LEDGER_SQL =
  'select entry_kind, amount_fils from app.billing_ledger ' +
  'where tenant_id = app.current_tenant_id() and client_id = $1';

type EntitlementDbRow = {
  service_type_id: string;
  service_type_code: string;
  status: EntitlementRecord['status'];
  allocated_net_fils: number;
  consumption_kind: EntitlementRecord['consumptionKind'];
  expires_on: string | null;
};

export function mountStopBalance(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/billing/clients/:clientId/stop-balance', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    const clientId = c.req.param('clientId');
    if (!isUuid(clientId)) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    // No `clientIds` is passed, for the reason the full route gives: resolving a
    // contact's own household is the portal stream's, and until it exists a
    // client contact is refused rather than quietly shown a household that may
    // not be theirs. The two routes answer a contact identically.
    if (!mayReadBalance(actor, clientId, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const db = c.get('db');

    const client = await db.query<{ id: string }>(CLIENT_SQL, [clientId]);
    if (!client.rows[0]) {
      return c.json({ error: 'not_found', requestId }, 404);
    }

    const [entitlements, ledger] = await Promise.all([
      db.query<EntitlementDbRow>(ENTITLEMENTS_SQL, [clientId]),
      db.query<{ entry_kind: string; amount_fils: number }>(LEDGER_SQL, [clientId]),
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

    const codeById = new Map(
      entitlements.rows.map((row) => [row.service_type_id, row.service_type_code]),
    );

    const charged = ledger.rows.filter((row) => row.entry_kind === 'charge');
    // A payment is stored with the opposite sign so the balance is a plain sum.
    const paid = ledger.rows.filter((row) => row.entry_kind === 'payment');

    await logRead(db, 'billing_ledger', clientId, clientId);

    return c.json(
      StopBalanceResponse.parse({
        clientId,
        services: balance.services.map((service) => ({
          // The code, not the id: a stop card shows a service by what it is,
          // and an id on a doorstep phone is one more thing that can leak.
          serviceTypeCode: codeById.get(service.serviceTypeId) ?? '',
          delivered: service.delivered,
          purchased: service.purchased,
          remaining: service.remaining,
        })),
        outstandingFils: outstandingBalanceFils(
          charged.map((row) => ({ grossFils: fils(row.amount_fils) })),
          paid.map((row) => ({ amountFils: fils(-row.amount_fils) })),
        ),
      }),
    );
  });
}
