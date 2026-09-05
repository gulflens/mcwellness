import type { Hono } from 'hono';
import { z } from 'zod';
import { packageProgress } from '../../../domain/portal';
import { DEFAULT_SIGNED_URL_TTL_SECONDS } from '../../../domain/shared';
import { logRead } from '../_middleware/audit';
import { auditDocumentRead } from '../_middleware/storage/audit';
import type { ApiEnv, Db } from '../_middleware/request-context';
import {
  clientsFor,
  mayReadHousehold,
  moneyClientIds,
  readHousehold,
  type Household,
} from './household';
import { logHouseholdRefusal } from './refused';
import {
  DocumentLinkResponse,
  MoneyResponse,
  type PortalInvoice,
  type PortalPackage,
  type PortalPayment,
} from './schema';

/**
 * `GET /api/portal/money` — what is owed, what is left, and the papers
 * (docs/SPEC/client-portal.md section 3.3), and
 * `GET /api/portal/documents/:documentId/link`, which opens one of them.
 *
 * **A young person's own login does not get this screen.** The route answers
 * 403 rather than an empty one, because an empty money screen is a screen that
 * says the household has no money rather than that this person is not shown it
 * — and the six restrictive policies of `db/policies/portal/money.sql` refuse
 * the rows underneath in any case, so the 403 is the honest translation of
 * what the database would do rather than a courtesy in front of it.
 *
 * **Every figure is derived, none stored** (docs/SPEC/billing.md section 1).
 * What is owed is the sum of `app.billing_ledger`, where a payment already
 * carries the opposite sign; "Session n of N" is `packageProgress` counting
 * credits, which is the portal's own rule and tested as one.
 *
 * **Money is integer fils all the way out**, and the one formatter that turns
 * it into a figure a person reads is `domain/shared/fils.ts`, on the screen.
 * No route in this platform formats money.
 */

const LEDGER_SQL =
  'select client_id, sum(amount_fils)::int as outstanding_fils from app.billing_ledger ' +
  'where tenant_id = app.current_tenant_id() and client_id = any($1::uuid[]) group by client_id';

const PURCHASES_SQL =
  'select pp.id, pp.client_id, pp.package_name, pp.package_name_ar, ' +
  "to_char(pp.purchased_on, 'YYYY-MM-DD') as purchased_on, " +
  "to_char(coalesce(pp.extended_to, pp.expires_on), 'YYYY-MM-DD') as expires_on " +
  'from package_purchase pp ' +
  "where pp.tenant_id = app.current_tenant_id() and pp.status = 'active' " +
  'and pp.client_id = any($1::uuid[]) order by pp.purchased_on desc, pp.id';

const ENTITLEMENTS_SQL =
  'select package_purchase_id, status from entitlement ' +
  'where tenant_id = app.current_tenant_id() and client_id = any($1::uuid[]) ' +
  'and package_purchase_id is not null';

/**
 * The invoices and the payments, each with the rendered document beside it
 * where one has been filed. `billing_document` is the join, not a guess: a
 * document exists only once somebody has rendered it, and a row without one
 * shows a figure and no link.
 */
const INVOICES_SQL =
  'select i.id, i.client_id, i.reference, ' +
  "to_char(i.issued_on, 'YYYY-MM-DD') as issued_on, i.gross_fils, bd.document_id " +
  'from invoice i ' +
  "left join billing_document bd on bd.invoice_id = i.id and bd.kind = 'invoice' " +
  'where i.tenant_id = app.current_tenant_id() and i.client_id = any($1::uuid[]) ' +
  'order by i.issued_on desc, i.number desc';

const PAYMENTS_SQL =
  "select p.id, p.client_id, to_char(p.received_at at time zone $2, 'YYYY-MM-DD') as received_on, " +
  'p.method::text as method, p.amount_fils, p.receipt_reference, bd.document_id ' +
  'from payment p ' +
  "left join billing_document bd on bd.payment_id = p.id and bd.kind = 'receipt' " +
  'where p.tenant_id = app.current_tenant_id() and p.client_id = any($1::uuid[]) ' +
  'order by p.received_at desc, p.id';

export type HouseholdMoney = {
  balances: { clientId: string; outstandingFils: number }[];
  packages: PortalPackage[];
  invoices: PortalInvoice[];
  payments: PortalPayment[];
};

/**
 * Everything the money screen shows, for the clients this person may be shown
 * money for. Exported because Home puts one line of it per client and the two
 * must not disagree about what is owed.
 */
export async function householdMoney(db: Db, household: Household): Promise<HouseholdMoney> {
  const clientIds = moneyClientIds(household);
  if (clientIds.length === 0) {
    return { balances: [], packages: [], invoices: [], payments: [] };
  }

  const [ledger, purchases, entitlements, invoices, payments] = await Promise.all([
    db.query<{ client_id: string; outstanding_fils: number }>(LEDGER_SQL, [clientIds]),
    db.query<{
      id: string;
      client_id: string;
      package_name: string;
      package_name_ar: string | null;
      purchased_on: string;
      expires_on: string;
    }>(PURCHASES_SQL, [clientIds]),
    db.query<{
      package_purchase_id: string | null;
      status: 'available' | 'consumed' | 'expired' | 'refunded' | 'waived';
    }>(ENTITLEMENTS_SQL, [clientIds]),
    db.query<{
      id: string;
      client_id: string;
      reference: string;
      issued_on: string;
      gross_fils: number;
      document_id: string | null;
    }>(INVOICES_SQL, [clientIds]),
    db.query<{
      id: string;
      client_id: string;
      received_on: string;
      method: string;
      amount_fils: number;
      receipt_reference: string | null;
      document_id: string | null;
    }>(PAYMENTS_SQL, [clientIds, household.practice.timezone]),
  ]);

  const credits = entitlements.rows.map((row) => ({
    packagePurchaseId: row.package_purchase_id,
    status: row.status,
  }));

  return {
    balances: clientIds.map((clientId) => ({
      clientId,
      outstandingFils: ledger.rows.find((row) => row.client_id === clientId)?.outstanding_fils ?? 0,
    })),
    packages: purchases.rows.map((row) => {
      const progress = packageProgress({ id: row.id }, credits);
      return {
        id: row.id,
        clientId: row.client_id,
        name: row.package_name,
        nameAr: row.package_name_ar,
        purchasedOn: row.purchased_on,
        expiresOn: row.expires_on,
        used: progress.used,
        total: progress.total,
      };
    }),
    invoices: invoices.rows.map((row) => ({
      id: row.id,
      clientId: row.client_id,
      reference: row.reference,
      issuedOn: row.issued_on,
      grossFils: row.gross_fils,
      documentId: row.document_id,
    })),
    payments: payments.rows.map((row) => ({
      id: row.id,
      clientId: row.client_id,
      receivedOn: row.received_on,
      method: row.method,
      amountFils: row.amount_fils,
      receiptReference: row.receipt_reference,
      documentId: row.document_id,
    })),
  };
}

/** The one parameter this route takes, as its siblings guard theirs. */
const DocumentParams = z.object({ documentId: z.uuid() });

/** The document, if it is this household's and has bytes filed against it. */
const DOCUMENT_SQL =
  'select bd.document_id, bd.client_id, d.storage_key from billing_document bd ' +
  'join document d on d.id = bd.document_id ' +
  'where bd.tenant_id = app.current_tenant_id() and bd.document_id = $1 ' +
  'and bd.client_id = any($2::uuid[])';

export function mountPortalMoney(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/portal/money', async (c) => {
    const requestId = c.get('requestId');
    const db = c.get('db');
    const actor = c.get('actor');
    const household = await readHousehold(db, actor, now());
    if (household === null) return c.json({ error: 'forbidden', requestId }, 403);
    // Section 5, rule 1: `client.read` for every client this answer is about,
    // with the ids the database resolved and never one a request claimed. The
    // policies refuse the rows beneath and `readHousehold` has already turned
    // away anybody who is not a contact; this is the rule stated where the
    // route exercises it, and a refusal on the trail if the three disagree.
    if (!mayReadHousehold(actor, household, now())) {
      await logHouseholdRefusal(db, household);
      return c.json({ error: 'forbidden', requestId }, 403);
    }

    const visible = moneyClientIds(household);
    if (visible.length === 0) {
      // A young person's own login, and nothing else: the router sends them
      // home (section 3.3) and this says the same if they arrive anyway.
      return c.json({ error: 'forbidden', code: 'money_not_shown', requestId }, 403);
    }

    const money = await householdMoney(db, household);
    for (const clientId of visible) {
      // The same entity the practice's own balance route records, so the two
      // reads of one figure read alike on the timeline.
      await logRead(db, 'billing_ledger', clientId, clientId);
    }

    return c.json(
      MoneyResponse.parse({
        clients: clientsFor(household),
        balances: money.balances.map((balance) => ({
          clientId: balance.clientId,
          outstandingFils: balance.outstandingFils,
          sessionsUsed: null,
          sessionsTotal: null,
        })),
        packages: money.packages,
        invoices: money.invoices,
        payments: money.payments,
      }),
    );
  });

  api.get('/api/portal/documents/:documentId/link', async (c) => {
    const requestId = c.get('requestId');
    const db = c.get('db');
    // Parsed before it reaches a query, as every other portal route parses its
    // own: a malformed id is a 400 here rather than a raise in Postgres and a
    // 500 that says the platform broke when the caller simply mistyped.
    const params = DocumentParams.safeParse(c.req.param());
    if (!params.success) return c.json({ error: 'bad_request', requestId }, 400);

    const household = await readHousehold(db, c.get('actor'), now());
    if (household === null) return c.json({ error: 'forbidden', requestId }, 403);

    const storage = c.get('storage');
    if (!storage) return c.json({ error: 'storage_unavailable', requestId }, 503);

    const visible = moneyClientIds(household);
    if (visible.length === 0) {
      return c.json({ error: 'forbidden', code: 'money_not_shown', requestId }, 403);
    }

    const found = await db.query<{
      document_id: string;
      client_id: string;
      storage_key: string;
    }>(DOCUMENT_SQL, [params.data.documentId, visible]);
    const row = found.rows[0];
    if (!row) {
      // Another household's, or a document nobody has rendered. A 404 either
      // way: a 403 would confirm the document exists.
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (!(await storage.exists(row.storage_key))) {
      // The row says a document was filed and the store has no bytes under
      // that key. Re-rendering is the practice's route to do, never the
      // household's (app/api/billing/documents.ts): here it is simply absent.
      return c.json({ error: 'not_found', requestId }, 404);
    }

    // Handing somebody the means to open a client's file is the read worth
    // recording, and signing is the only moment it can be (docs/SEAMS.md).
    // Before the link, every time.
    await auditDocumentRead(db, { id: row.document_id, clientId: row.client_id });
    const url = await storage.getSignedUrl(row.storage_key, DEFAULT_SIGNED_URL_TTL_SECONDS);
    return c.json(
      DocumentLinkResponse.parse({ url, expiresInSeconds: DEFAULT_SIGNED_URL_TTL_SECONDS }),
    );
  });
}
