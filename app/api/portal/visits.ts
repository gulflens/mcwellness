import type { Hono } from 'hono';
import { visitOutcome, visitsFor, type AppointmentStatus } from '../../../domain/portal';
import { logReads } from '../_middleware/audit';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { clientsFor, mayReadHousehold, readHousehold, type Household } from './household';
import { logHouseholdRefusal } from './refused';
import { VisitsResponse, type Visit } from './schema';

/**
 * `GET /api/portal/visits` — when the practitioner is coming, and when they
 * came (docs/SPEC/client-portal.md section 3.2).
 *
 * **What is not in the answer is the point of the query.** An appointment row
 * carries the practitioner who is driving, the location it is at with its
 * coordinate and its arrival notes, and a travel buffer. None of that is a
 * household's: the practitioner is not named, the address is Family's to show
 * and only as a line and an emirate, and a coordinate never leaves the
 * practice at all. So the select names its columns and the answer is parsed
 * through `VisitsResponse` besides.
 *
 * **The split is the domain's**, not this route's: `visitsFor` decides which
 * statuses appear in which list and in what order, and `visitOutcome` decides
 * what a finished one is called — `cancelled_late` reads as "Cancelled" and
 * nothing more. The route reads rows and hands them over.
 *
 * The date is the practice's own day, taken at the tenant's time zone rather
 * than UTC's: a 22:00 visit in Dubai is not tomorrow's.
 */

const VISITS_SQL =
  "select a.id, a.client_id, to_char(a.window_start at time zone $2, 'YYYY-MM-DD') as date, " +
  'a.window_start, a.window_end, a.delivery_mode, a.status, ' +
  'st.name as service_name, st.name_ar as service_name_ar ' +
  'from appointment a join service_type st on st.id = a.service_type_id ' +
  'where a.tenant_id = app.current_tenant_id() and a.client_id = any($1::uuid[]) ' +
  'order by a.window_start, a.id';

type VisitRow = {
  id: string;
  client_id: string;
  date: string;
  window_start: Date;
  window_end: Date;
  delivery_mode: 'home' | 'studio' | 'remote';
  status: AppointmentStatus;
  service_name: string;
  service_name_ar: string | null;
};

function view(row: VisitRow): Visit {
  return {
    id: row.id,
    clientId: row.client_id,
    date: row.date,
    windowStart: row.window_start.toISOString(),
    windowEnd: row.window_end.toISOString(),
    serviceName: row.service_name,
    serviceNameAr: row.service_name_ar,
    deliveryMode: row.delivery_mode,
    status: row.status,
    outcome: visitOutcome(row.status),
  };
}

/**
 * Every visit of the household, split the way section 3.2 draws it. Exported
 * because Home shows the next one and must not disagree with this screen about
 * which visit that is.
 */
export async function householdVisits(
  db: Db,
  household: Household,
): Promise<{ upcoming: Visit[]; past: Visit[] }> {
  const clientIds = household.clients.map((client) => client.id);
  if (clientIds.length === 0) return { upcoming: [], past: [] };
  const { rows } = await db.query<VisitRow>(VISITS_SQL, [clientIds, household.practice.timezone]);
  const visits = rows.map(view);
  return visitsFor(
    visits.map((visit) => ({ ...visit, startsAt: visit.windowStart })),
    household.today,
  );
}

export function mountPortalVisits(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/portal/visits', async (c) => {
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

    const { upcoming, past } = await householdVisits(db, household);
    // One row per visit the household was shown, as the contact: the practice's
    // timeline says when a family last looked at its own diary (section 9).
    await logReads(
      db,
      'appointment',
      [...upcoming, ...past].map((visit) => ({ id: visit.id, clientId: visit.clientId })),
      'list',
    );

    return c.json(VisitsResponse.parse({ clients: clientsFor(household), upcoming, past }));
  });
}
