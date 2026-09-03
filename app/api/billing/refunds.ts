import type { Hono } from 'hono';
import { refundOnTermination } from '../../../domain/billing';
import { fils, isoDateIn } from '../../../domain/shared';
import { logRead } from '../_middleware/audit';
import type { ApiEnv } from '../_middleware/request-context';
import { isUuid } from './ids';
import { mayQuoteRefund } from './access';
import { RefundQuoteResponse } from './ledger-schema';

/**
 * `GET /api/billing/package-purchases/:id/refund-quote` — what a family would
 * be owed if they left the programme today.
 *
 * **Read-only, and that is the whole point.** No route in this pull request
 * issues a refund. The policy wording is with the practice's lawyer and the
 * tax point on prepaid packages is with its tax adviser
 * (docs/SPEC/billing.md section 10, decisions 2 and 4), and until both come
 * back in writing the honest thing to ship is the arithmetic and nothing
 * else. The response says so in a field: `quoteOnly`.
 *
 * The rule is section 4.3's: unused credits refund at the rate they were
 * allocated at, and what was delivered is repriced at today's single-visit
 * rate. A credit taken by a late cancellation that was never waived counts as
 * delivered — the client used it under the practice's own stated policy — and
 * a waived one counts as nothing, because its replacement is still on the
 * ledger.
 */

const PRACTICE_TIME_ZONE = 'Asia/Dubai';
const JURISDICTION = 'AE';
const RECIPIENT_TYPE = 'individual';

const PURCHASE_SQL =
  'select id, client_id, net_fils from package_purchase ' +
  'where tenant_id = app.current_tenant_id() and id = $1';

// What the purchase has used up, per service, with today's single-visit rate
// beside it (domain/billing/price.ts's currentPriceFor, in SQL).
const CONSUMED_SQL =
  'select e.service_type_id, st.name as service_type_name, count(*)::int as used, ' +
  '(select p.unit_price_fils from price p ' +
  '  where p.tenant_id = e.tenant_id and p.service_type_id = e.service_type_id ' +
  '    and p.jurisdiction = $2 and p.recipient_type = $3 and p.valid_from <= $4 ' +
  '  order by p.valid_from desc limit 1) as single_rate_net_fils ' +
  'from entitlement e join service_type st on st.id = e.service_type_id ' +
  'where e.tenant_id = app.current_tenant_id() and e.package_purchase_id = $1 ' +
  "and e.status = 'consumed' " +
  'group by e.tenant_id, e.service_type_id, st.name order by st.name';

export function mountRefundQuotes(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/billing/package-purchases/:id/refund-quote', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (!mayQuoteRefund(actor, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const purchaseId = c.req.param('id');
    if (!isUuid(purchaseId)) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const db = c.get('db');

    const purchase = await db.query<{ id: string; client_id: string; net_fils: number }>(
      PURCHASE_SQL,
      [purchaseId],
    );
    const row = purchase.rows[0];
    if (!row) {
      return c.json({ error: 'not_found', requestId }, 404);
    }

    const today = isoDateIn(now(), PRACTICE_TIME_ZONE);
    const consumed = await db.query<{
      service_type_id: string;
      service_type_name: string;
      used: number;
      single_rate_net_fils: number | null;
    }>(CONSUMED_SQL, [purchaseId, JURISDICTION, RECIPIENT_TYPE, today]);

    const unpriced = consumed.rows.filter((line) => line.single_rate_net_fils === null);
    if (unpriced.length > 0) {
      // No single-visit rate to reprice against. There is no defensible
      // figure, and guessing one would be the practice quietly deciding a
      // refund in its own favour.
      return c.json({ error: 'unprocessable', code: 'no_single_rate', requestId }, 422);
    }

    const quote = refundOnTermination({
      paidNetFils: fils(row.net_fils),
      delivered: consumed.rows.map((line) => ({
        serviceTypeId: line.service_type_id,
        count: line.used,
      })),
      singleRates: consumed.rows.map((line) => ({
        serviceTypeId: line.service_type_id,
        netFils: fils(line.single_rate_net_fils ?? 0),
      })),
    });

    const nameById = new Map(
      consumed.rows.map((line) => [line.service_type_id, line.service_type_name]),
    );

    await logRead(db, 'package_purchase', row.id, row.client_id);

    return c.json(
      RefundQuoteResponse.parse({
        purchaseId: row.id,
        paidNetFils: quote.paidNetFils,
        deliveredChargeNetFils: quote.deliveredChargeNetFils,
        refundNetFils: quote.refundNetFils,
        lines: quote.lines.map((line) => ({
          serviceTypeId: line.serviceTypeId,
          serviceTypeName: nameById.get(line.serviceTypeId) ?? '',
          count: line.count,
          singleRateNetFils: line.singleRateNetFils,
          chargeNetFils: line.chargeNetFils,
        })),
        quoteOnly: true,
      }),
    );
  });
}
