import type { Hono } from 'hono';
import { canActor, isoDateIn } from '@domain/shared';
import {
  APPOINTMENT_STATUSES,
  DEFAULT_GRACE_MINUTES,
  PRACTICE_TIME_ZONE,
  boardState,
  lateness,
  navigationTarget,
  type AppointmentStatus,
  type Lateness,
  type Progress,
} from '@domain/scheduling';
import { logReads } from '../_middleware/audit';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { dayRange, fillMatrix, readFactors } from '../routing/estimates';
import {
  bucketsFor,
  placesFor,
  readBases,
  readDay,
  toHomeBase,
  toPlanStop,
} from '../routing/practice-day';
import { BoardResponse, type BoardPractitioner, type BoardVisit } from './schema';

/**
 * `GET /api/appointments/board?date=` — every practitioner's day, each visit
 * with its facts and its state, and whether each can be reached in time
 * (docs/SPEC/dispatch.md sections 4, 5 and 9).
 *
 * **Names are read, so the trail says so**: one `list` row per visit shown,
 * exactly as `GET /api/appointments` writes (`app/api/appointments/list.ts`),
 * because it is the same disclosure on a different screen. The row names the
 * household, in the shape `docs/SPEC/audit.md` rule 11 sets for a record that
 * appears in a list somebody fetched.
 *
 * **The drives are the map's own.** The stops and their coordinates come
 * from `practice-day.ts`'s reads and the matrix from `fillMatrix`, so the
 * board and the optimiser price a drive the same way. With no routing seam
 * configured the board still answers — with `latenessAvailable: false` and
 * no lateness on any visit — rather than refusing the whole screen, which is
 * the one place it parts company with the day map (a map with no drives on it
 * is nothing, a board with no lateness on it is still the day).
 */

/**
 * The rows down the side of the board (spec 4.2): the practice's current
 * practitioners, plus anyone who has left with a visit still against their
 * name that day. The second half is not politeness — the render loop is
 * driven by this list, so a leaver dropped from it takes their unreassigned
 * visits off the board with them, and a visit nobody can see is a visit
 * nobody drives to. `$1` is the day's own practitioners, read first.
 */
const PRACTITIONERS_SQL =
  'select p.id, u.display_name from practitioner p join app_user u on u.id = p.user_id ' +
  'where p.tenant_id = app.current_tenant_id() and u.tenant_id = app.current_tenant_id() ' +
  "and (p.status = 'active' or p.id = any($1::uuid[])) " +
  'order by u.display_name, p.id';

/**
 * The facts 4.3 names for every visit of the day, and the session's two
 * instants. The lateral join takes the latest visit record once, so the
 * check-in and the close are always the same session's and never two.
 *
 * Every joined table repeats the tenant predicate, as the neighbouring routes
 * do and for the same reason. The join to `client` is also what decides
 * whether a stop can be shown at all: a household this caller may not read
 * forms no row here, and the block is left off the board rather than drawn
 * with a blank where a name goes.
 */
const FACTS_SQL =
  'select a.id, a.client_id, c.given_name, c.family_name, ' +
  'st.id as service_type_id, st.name as service_type_name, ' +
  'l.emirate::text as emirate, s.checked_in_at, s.closed_at ' +
  'from appointment a ' +
  'join client c on c.id = a.client_id ' +
  'join service_type st on st.id = a.service_type_id ' +
  'join location l on l.id = a.location_id ' +
  'left join lateral (' +
  'select s.checked_in_at, s.closed_at from session s ' +
  'where s.appointment_id = a.id and s.tenant_id = app.current_tenant_id() ' +
  'order by s.checked_in_at desc limit 1' +
  ') s on true ' +
  'where a.tenant_id = app.current_tenant_id() and c.tenant_id = app.current_tenant_id() ' +
  'and st.tenant_id = app.current_tenant_id() and l.tenant_id = app.current_tenant_id() ' +
  'and a.window_start >= $1 and a.window_start < $2';

type FactsRow = {
  id: string;
  client_id: string;
  given_name: string;
  family_name: string;
  service_type_id: string;
  service_type_name: string;
  emirate: string;
  checked_in_at: Date | null;
  closed_at: Date | null;
};

async function readFacts(db: Db, date: string): Promise<Map<string, FactsRow>> {
  const [dayStart, dayEnd] = dayRange(date);
  const { rows } = await db.query<FactsRow>(FACTS_SQL, [dayStart, dayEnd]);
  return new Map(rows.map((row) => [row.id, row]));
}

export function mountAppointmentBoard(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/appointments/board', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    const date = c.req.query('date');
    if (date === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return c.json({ error: 'bad_request', requestId }, 400);
    }
    if (!canActor(actor, { type: 'appointment.board.read' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const db = c.get('db');
    const routing = c.get('routing');
    const at = now();

    // The map's own reads: every stop of the day with its coordinates, and
    // where each practitioner starts. Every status, not the map's five,
    // because the board shows the whole day's history — what was called off
    // and what was moved are part of how the day went (spec 4.4).
    const stops = await readDay(db, date, APPOINTMENT_STATUSES);
    const bases = await readBases(db);
    const facts = await readFacts(db, date);

    const byPractitioner = new Map<string, typeof stops>();
    for (const row of stops) {
      const day = byPractitioner.get(row.practitioner_id);
      if (day) day.push(row);
      else byPractitioner.set(row.practitioner_id, [row]);
    }
    // The stops are read before the rows, because who has a stop that day is
    // half of who gets a row.
    const practitioners = await db.query<{ id: string; display_name: string }>(PRACTITIONERS_SQL, [
      [...byPractitioner.keys()],
    ]);

    const factors = routing ? await readFactors(db) : null;
    const answer: BoardPractitioner[] = [];
    /** Every household named on the board, one entry per block, for the trail. */
    const shown: { id: string; clientId: string }[] = [];
    for (const practitioner of practitioners.rows) {
      const day = byPractitioner.get(practitioner.id) ?? [];
      const progress: Progress[] = day.map((row) => {
        const fact = facts.get(row.id);
        return {
          stopId: row.id,
          windowStart: row.window_start,
          windowEnd: row.window_end,
          durationMinutes: row.duration_minutes,
          status: row.status as AppointmentStatus,
          checkedInAt: fact?.checked_in_at ?? null,
          closedAt: fact?.closed_at ?? null,
          locationId: row.location_id,
        };
      });

      let late = new Map<string, Lateness>();
      if (routing && factors && day.length > 0) {
        const planStops = day.map(toPlanStop);
        const baseRow = bases.get(practitioner.id);
        const base = baseRow === undefined ? null : toHomeBase(baseRow);
        const matrix = await fillMatrix(
          db,
          placesFor(
            planStops,
            base === null ? null : { locationId: base.id, point: navigationTarget(base) },
          ),
          bucketsFor(planStops),
          date,
          factors,
          routing,
          actor.userId,
        );
        late = lateness(progress, matrix, at, DEFAULT_GRACE_MINUTES);
      }

      const visits: BoardVisit[] = [];
      for (const [index, stop] of progress.entries()) {
        const fact = facts.get(stop.stopId);
        if (!fact) continue;
        shown.push({ id: fact.client_id, clientId: fact.client_id });
        const own = late.get(stop.stopId) ?? null;
        visits.push({
          appointmentId: stop.stopId,
          windowStart: stop.windowStart.toISOString(),
          windowEnd: stop.windowEnd.toISOString(),
          status: stop.status,
          // The stop before it in the day, whether or not that household can
          // be named here: "on the way" is a fact about the practitioner.
          state: boardState(stop, progress[index - 1] ?? null, own?.late ?? false, at),
          client: { id: fact.client_id, givenName: fact.given_name, familyName: fact.family_name },
          serviceType: {
            id: fact.service_type_id,
            name: fact.service_type_name,
            durationMinutes: stop.durationMinutes,
          },
          emirate: fact.emirate,
          checkedInAt: stop.checkedInAt?.toISOString() ?? null,
          closedAt: stop.closedAt?.toISOString() ?? null,
          lateness: routing ? own : null,
        });
      }
      answer.push({
        practitionerId: practitioner.id,
        displayName: practitioner.display_name,
        visits,
      });
    }

    // Before the answer leaves, never after: a name disclosed with no row in
    // the trail is the one thing this must not do.
    await logReads(db, 'client', shown, 'list');

    return c.json(
      BoardResponse.parse({
        date: isoDateIn(dayRange(date)[0], PRACTICE_TIME_ZONE),
        latenessAvailable: routing !== undefined,
        practitioners: answer,
      }),
    );
  });
}
