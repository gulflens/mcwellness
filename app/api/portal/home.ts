import type { Hono } from 'hono';
import { logReads } from '../_middleware/audit';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { clientsFor, readHousehold, type Household } from './household';
import { householdMoney } from './money';
import { HomeResponse, type Notice } from './schema';
import { householdVisits } from './visits';

/**
 * `GET /api/portal/home` — the one screen somebody opens at eleven at night
 * (docs/SPEC/client-portal.md section 3.1).
 *
 * Four things and no more: when the next visit is, what each client's money
 * comes to, anything waiting on the household, and how to ask the practice for
 * a visit. It composes the other screens' own queries rather than writing its
 * own, so Home and Visits can never disagree about which visit is next, and
 * Home and Money can never disagree about what is owed.
 *
 * **The portal does not book, and does not pretend to.** Asking for a visit is
 * a sentence and a WhatsApp button on the practice's own number — a hand-off
 * in the sending seam's sense (docs/SEAMS.md), composed in the browser, with
 * nothing leaving this server. The number travels in the answer; a practice
 * that has recorded none sends null and the screen says "ask the practice"
 * without a button.
 */

/**
 * A consent whose wording has been retired while a newer approved version of
 * the same purpose and language stands (section 3.5).
 *
 * The comparison is `app.portal_wording_is_superseded` (migration 703) rather
 * than a join written here, because half of it is a row this household may not
 * read: the newer wording belongs to no client and no consent of theirs points
 * at it, so a plain query would be answered "no" every time by the read policy
 * rather than by the facts.
 */
const NEWER_WORDING_SQL =
  'select cs.id, cs.client_id, cs.purpose::text as purpose from consent cs ' +
  "where cs.tenant_id = app.current_tenant_id() and cs.status = 'active' " +
  'and cs.client_id = any($1::uuid[]) ' +
  'and app.portal_wording_is_superseded(cs.text_document_id)';

const REQUESTS_SQL =
  'select id, client_id, kind::text as kind, status::text as status from portal_request ' +
  'where tenant_id = app.current_tenant_id() and client_id = any($1::uuid[]) ' +
  'order by created_at desc, id limit 20';

/** Everything waiting on the household, in the order the screen reads it. */
async function noticesFor(db: Db, household: Household): Promise<Notice[]> {
  const clientIds = household.clients.map((client) => client.id);
  if (clientIds.length === 0) return [];

  const [wordings, requests] = await Promise.all([
    db.query<{ id: string; client_id: string; purpose: string }>(NEWER_WORDING_SQL, [clientIds]),
    db.query<{ id: string; client_id: string; kind: string; status: string }>(REQUESTS_SQL, [
      clientIds,
    ]),
  ]);

  return [
    ...wordings.rows.map((row): Notice => ({
      kind: 'consent_newer_wording',
      clientId: row.client_id,
      entityId: row.id,
      detail: row.purpose,
    })),
    ...requests.rows.map((row): Notice => ({
      kind: row.status === 'open' ? 'request_open' : 'request_handled',
      clientId: row.client_id,
      entityId: row.id,
      detail: row.kind,
    })),
  ];
}

export function mountPortalHome(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/portal/home', async (c) => {
    const requestId = c.get('requestId');
    const db = c.get('db');
    const household = await readHousehold(db, c.get('actor'), now());
    if (household === null) return c.json({ error: 'forbidden', requestId }, 403);

    const [{ upcoming }, money, notices] = await Promise.all([
      householdVisits(db, household),
      householdMoney(db, household),
      noticesFor(db, household),
    ]);

    const next = upcoming[0] ?? null;

    // Where a bundle is running, the household's own "Session n of N". The
    // most recent active purchase per client: a family part-way through Silver
    // has one, and a family paying visit by visit has none.
    const money_ = household.clients
      .filter((client) => client.moneyVisible)
      .map((client) => {
        const bundle = money.packages.find((row) => row.clientId === client.id) ?? null;
        return {
          clientId: client.id,
          outstandingFils:
            money.balances.find((row) => row.clientId === client.id)?.outstandingFils ?? 0,
          sessionsUsed: bundle ? bundle.used : null,
          sessionsTotal: bundle ? bundle.total : null,
        };
      });

    // One row per client the household opened its own record on (section 9).
    await logReads(
      db,
      'client',
      household.clients.map((client) => ({ id: client.id, clientId: client.id })),
      'read',
    );

    return c.json(
      HomeResponse.parse({
        practice: household.practice,
        locale: household.locale,
        clients: clientsFor(household),
        nextVisit: next
          ? {
              clientId: next.clientId,
              date: next.date,
              windowStart: next.windowStart,
              windowEnd: next.windowEnd,
              serviceName: next.serviceName,
              serviceNameAr: next.serviceNameAr,
              deliveryMode: next.deliveryMode,
            }
          : null,
        money: money_,
        notices,
      }),
    );
  });
}
