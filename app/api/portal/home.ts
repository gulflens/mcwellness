import type { Hono } from 'hono';
import {
  REVIEW_PROMPT_DAYS,
  reviewMilestones,
  type AppointmentStatus,
  type ReviewMilestoneKind,
} from '../../../domain/portal';
import { logReads } from '../_middleware/audit';
import type { ApiEnv, Db } from '../_middleware/request-context';
import {
  clientsFor,
  mayReadHousehold,
  moneyClientIds,
  readHousehold,
  type Household,
} from './household';
import { logHouseholdRefusal } from './refused';
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

/**
 * The review line (section 3.1 as amended 2026-09-17; the owner's decision of
 * 16 September 2026; docs/superpowers/specs/2026-09-17-review-prompt-design.md).
 *
 * Three small reads and the domain's rule. The visits are the completed ones
 * with their service's code, from a window one day wider than the rule's so
 * the practice's own day, not UTC's, decides the edge; the credits carry the
 * day each was used, in the practice's zone; the answers are the milestones
 * this household has already been asked about. `reviewMilestones` does the
 * rest and answers at most one per client.
 *
 * Only for the clients this person is shown money for: a review is asked of
 * an adult, and the purchase and credit rows are refused to a young person's
 * own login by `db/policies/portal/money.sql` in any case. Nothing at all is
 * read where the practice has recorded no review page.
 */
const REVIEW_VISITS_SQL =
  "select a.id, a.client_id, to_char(a.window_start at time zone $2, 'YYYY-MM-DD') as date, " +
  'a.status::text as status, st.code as service_code ' +
  'from appointment a join service_type st on st.id = a.service_type_id ' +
  'where a.tenant_id = app.current_tenant_id() and a.client_id = any($1::uuid[]) ' +
  "and a.status = 'completed' and a.window_start >= now() - ($3::int * interval '1 day')";

const REVIEW_PURCHASES_SQL =
  'select pp.id, pp.client_id from package_purchase pp ' +
  "where pp.tenant_id = app.current_tenant_id() and pp.status = 'active' " +
  'and pp.client_id = any($1::uuid[])';

const REVIEW_CREDITS_SQL =
  'select package_purchase_id, client_id, status::text as status, ' +
  "to_char(consumed_at at time zone $2, 'YYYY-MM-DD') as consumed_on from entitlement " +
  'where tenant_id = app.current_tenant_id() and client_id = any($1::uuid[]) ' +
  'and package_purchase_id is not null';

const REVIEW_ANSWERS_SQL =
  'select milestone_kind, milestone_id from portal_review_prompt ' +
  'where tenant_id = app.current_tenant_id() and client_id = any($1::uuid[])';

async function reviewNoticesFor(db: Db, household: Household): Promise<Notice[]> {
  if (household.practice.reviewUrl === null) return [];
  const clientIds = moneyClientIds(household);
  if (clientIds.length === 0) return [];
  const zone = household.practice.timezone;

  const [visits, purchases, credits, answers] = await Promise.all([
    db.query<{
      id: string;
      client_id: string;
      date: string;
      status: AppointmentStatus;
      service_code: string;
    }>(REVIEW_VISITS_SQL, [clientIds, zone, REVIEW_PROMPT_DAYS + 1]),
    db.query<{ id: string; client_id: string }>(REVIEW_PURCHASES_SQL, [clientIds]),
    db.query<{
      package_purchase_id: string;
      client_id: string;
      status: 'available' | 'consumed' | 'expired' | 'refunded' | 'waived';
      consumed_on: string | null;
    }>(REVIEW_CREDITS_SQL, [clientIds, zone]),
    db.query<{ milestone_kind: ReviewMilestoneKind; milestone_id: string }>(REVIEW_ANSWERS_SQL, [
      clientIds,
    ]),
  ]);

  return reviewMilestones(
    {
      visits: visits.rows.map((row) => ({
        id: row.id,
        clientId: row.client_id,
        serviceCode: row.service_code,
        status: row.status,
        date: row.date,
      })),
      purchases: purchases.rows.map((row) => ({ id: row.id, clientId: row.client_id })),
      entitlements: credits.rows.map((row) => ({
        packagePurchaseId: row.package_purchase_id,
        clientId: row.client_id,
        status: row.status,
        consumedOn: row.consumed_on,
      })),
      answered: answers.rows.map((row) => ({ kind: row.milestone_kind, id: row.milestone_id })),
    },
    household.today,
  ).map((milestone) => ({
    kind: 'review_prompt',
    clientId: milestone.clientId,
    entityId: milestone.id,
    detail: milestone.kind,
  }));
}

/**
 * Everything waiting on the household, in the order the screen reads it, and
 * then the review line, which waits on nobody and comes last.
 */
async function noticesFor(db: Db, household: Household): Promise<Notice[]> {
  const clientIds = household.clients.map((client) => client.id);
  if (clientIds.length === 0) return [];

  const [wordings, requests, reviews] = await Promise.all([
    db.query<{ id: string; client_id: string; purpose: string }>(NEWER_WORDING_SQL, [clientIds]),
    db.query<{ id: string; client_id: string; kind: string; status: string }>(REQUESTS_SQL, [
      clientIds,
    ]),
    reviewNoticesFor(db, household),
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
    ...reviews,
  ];
}

export function mountPortalHome(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/portal/home', async (c) => {
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
