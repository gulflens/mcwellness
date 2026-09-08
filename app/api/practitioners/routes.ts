import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { z } from 'zod';
import { canActor } from '../../../domain/shared';
import { logReads } from '../_middleware/audit';
import type { ApiEnv, Db } from '../_middleware/request-context';
import {
  PractitionerBaseResponse,
  PractitionerListResponse,
  SetBaseInput,
  type Emirate,
  type PractitionerRow,
} from './schema';

/**
 * The practice's practitioners and where each one's driving day starts:
 * `GET /api/practitioners` and `PUT /api/practitioners/:id/base`
 * (docs/SPEC/route-planning.md section 5.4, migration 913).
 *
 * Until 8 September 2026 `practitioner.home_base_location_id` could only be
 * filled by a data step, and route-planning decision 14 said a settings field
 * was "a small later addition". The operator asked for the addition: *"This is
 * Shauna's home, every practioner can add their own address."*
 *
 * **What the practice keeps, and what it refuses to keep.** A base is a real
 * person's home. The row carries the coordinate, the emirate it sits in and
 * nothing more — no display address, no access notes, no Makani number. That
 * is held in three places, so no one of them has to be remembered: the
 * request and response contracts have no field for any of it (./schema.ts),
 * the database writes null into those columns itself
 * (`app.set_practitioner_base`), and `app.guard_location_notes` refuses an
 * update that touches anything but the point and the emirate.
 *
 * **And a fourth place, which is the one nothing can be taken out of again.**
 * `audit_log` records `to_jsonb(row)` for every write, so recording a base put
 * the coordinate into an append-only table kept for five years, and every later
 * move put the previous home in `old_values` beside the new one in
 * `new_values`. There is no erasure path for a member of staff: erasure is
 * `app.erase_client()`'s, and a practitioner is not a client. Migration 914
 * adds `entrance_point`, `parking_point` and `community_gate` to the keys
 * `app.audit_redact` drops outright, so the trail records that a location
 * changed, who changed it, when, why and which column moved, and never where
 * (the review of pull request 126, finding 5; docs/SPEC/audit.md section 8).
 *
 * **Who.** `practitioner.base.write` (domain/shared/actor.ts): the owner, an
 * admin and the lead practitioner for anybody; a practitioner for their own
 * row; finance and a client contact never. The list is admitted on the same
 * question — a person may open it when there is a base they may set — which is
 * why the read takes the write's action rather than an action of its own: the
 * screen exists to choose whose base to set, and an audience for reading it
 * that differed from the audience for using it would be a distinction without
 * a reason. `db/policies/core/practitioner_base.sql` and the function itself
 * refuse the rows underneath, which is the answer that binds.
 *
 * **Why the list is audited.** `app/api/kit/routes.ts` lists the equipment
 * register without an audit read, because "nothing here is personal data: a
 * serial, a model and two dates". This list is the opposite case. It names
 * members of staff and hands back the coordinates of their homes, which is
 * personal data of the most locating kind, so every row disclosed is one
 * `list` row on the trail, exactly as `app/api/clients/list.ts` records every
 * client it shows. `client_id` is null on each: an audit row's `client_id`
 * names a household (`.claude/rules/data-model.md`), and no household is
 * involved in where a practitioner lives.
 *
 * **Why a reason is required to write.** Moving where somebody's day starts
 * is the same class of act as moving a visit, and the practice's own address
 * already carries one (`app/api/practice/routes.ts`). `X-Reason` is stamped on
 * to the transaction by the fence and the row triggers record it with the
 * change; this route only insists there is something in it.
 */

const Params = z.object({ id: z.uuid() });

type Row = {
  id: string;
  display_name: string;
  is_you: boolean;
  location_id: string | null;
  lat: number | null;
  lng: number | null;
  emirate: Emirate | null;
};

/**
 * Active practitioners, with whatever `home_base_location_id` points at.
 *
 * The join is on the pointer alone and not on the owner type, deliberately.
 * A base may be a location this practitioner does not own — the synthetic seed
 * points every practitioner at the studio, and a practice may genuinely start
 * that way — and a screen that said "Not set" while the day map drew a first
 * pin from that very row would be a screen lying about the day.
 *
 * The location is read under row security like everything else, so a base this
 * caller may not see comes back as no base at all rather than as a refusal
 * (`practitioner_base_is_private`). The route's own scope below means that
 * never arises today; it is the safe way for it to fail if it ever does.
 */
const LIST_SQL =
  'select p.id, u.display_name, (u.id = $1) as is_you, l.id as location_id, ' +
  'extensions.st_y(l.entrance_point::extensions.geometry) as lat, ' +
  'extensions.st_x(l.entrance_point::extensions.geometry) as lng, ' +
  'l.emirate ' +
  'from practitioner p ' +
  'join app_user u on u.id = p.user_id and u.tenant_id = app.current_tenant_id() ' +
  'left join location l on l.id = p.home_base_location_id ' +
  'and l.tenant_id = app.current_tenant_id() ' +
  'where p.tenant_id = app.current_tenant_id() ' +
  "and p.status = 'active' " +
  // Null shows the practice; an id shows that one row and nothing else.
  'and ($2::uuid is null or p.id = $2) ' +
  'order by u.display_name, p.id';

/** The caller's own practitioner row, or null when they are not one. */
const OWN_SQL =
  'select id from practitioner where user_id = $1 and tenant_id = app.current_tenant_id()';

/** Whether this practice has that practitioner, reading nothing about them. */
const EXISTS_SQL =
  'select 1 from practitioner ' +
  "where id = $1 and tenant_id = app.current_tenant_id() and status = 'active'";

async function ownPractitionerId(db: Db, userId: string): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(OWN_SQL, [userId]);
  return rows[0]?.id ?? null;
}

function toRow(row: Row): PractitionerRow {
  return {
    id: row.id,
    displayName: row.display_name,
    isYou: row.is_you,
    base:
      row.location_id === null || row.lat === null || row.lng === null || row.emirate === null
        ? null
        : {
            locationId: row.location_id,
            point: { lat: row.lat, lng: row.lng },
            emirate: row.emirate,
          },
  };
}

/** One `list` row per practitioner disclosed; never a household, so never a client id. */
async function logListed(db: Db, rows: readonly PractitionerRow[]): Promise<void> {
  await logReads(
    db,
    'practitioner',
    rows.map((row) => ({ id: row.id, clientId: null })),
    'list',
  );
}

async function read(db: Db, userId: string, only: string | null): Promise<PractitionerRow[]> {
  const { rows } = await db.query<Row>(LIST_SQL, [userId, only]);
  return rows.map(toRow);
}

export function mountPractitioners(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/practitioners', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    const own = await ownPractitionerId(db, actor.userId);
    // "May this person set a base at all?" For the office the answer is yes
    // whatever id is named; for a practitioner it is yes for their own alone,
    // which is exactly the row they are then shown. Somebody with no
    // practitioner row and no office role is named by nothing and refused.
    if (
      !canActor(
        actor,
        { type: 'practitioner.base.write', practitionerId: own ?? '', ownPractitionerId: own },
        {},
        now(),
      )
    ) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    // "And may they set somebody else's?" — which is what makes the office the
    // office. A fresh id can be nobody's own, so the answer turns on the role
    // alone without this file restating the role list and drifting from
    // domain/shared/actor.ts (app/shell/adminAccess.ts' own reasoning).
    const office = canActor(
      actor,
      { type: 'practitioner.base.write', practitionerId: randomUUID(), ownPractitionerId: own },
      {},
      now(),
    );
    const practitioners = await read(db, actor.userId, office ? null : own);
    await logListed(db, practitioners);
    return c.json(PractitionerListResponse.parse({ practitioners, scope: office ? null : 'own' }));
  });

  api.put('/api/practitioners/:id/base', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    const params = Params.safeParse(c.req.param());
    if (!params.success) {
      return c.json({ error: 'bad_request', requestId }, 400);
    }
    const own = await ownPractitionerId(db, actor.userId);
    if (
      !canActor(
        actor,
        {
          type: 'practitioner.base.write',
          practitionerId: params.data.id,
          ownPractitionerId: own,
        },
        {},
        now(),
      )
    ) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    // A move, so it says why (docs/SPEC/audit.md section 6). Asked before the
    // body is read, so a request with no reason changes nothing at all.
    if (!(c.req.header('x-reason') ?? '').trim()) {
      return c.json({ error: 'reason_required', requestId }, 400);
    }
    const body = SetBaseInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      // A code, never zod's own message: the drawer holds the sentences.
      const field = body.error.issues[0]?.path[0];
      const code = field === 'emirate' ? 'emirate_required' : 'coordinates_required';
      return c.json({ error: 'bad_request', code, requestId }, 400);
    }
    // Asked here rather than left to the function, which raises for a
    // practitioner this practice does not have: an id that names nobody is a
    // 404, not the 500 an unhandled raise would become. It reads whether the
    // row exists and nothing about the person.
    const { rowCount } = await db.query(EXISTS_SQL, [params.data.id]);
    if (rowCount === 0) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    // The whole act, in one statement: create or move the location row, point
    // the practitioner at it, and never touch a row that is somebody else's
    // (migration 913). The rule above is asked again inside it.
    await db.query('select app.set_practitioner_base($1, $2, $3, $4::emirate)', [
      params.data.id,
      body.data.lng,
      body.data.lat,
      body.data.emirate,
    ]);
    const saved = (await read(db, actor.userId, params.data.id))[0];
    if (saved === undefined) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    await logListed(db, [saved]);
    return c.json(PractitionerBaseResponse.parse({ practitioner: saved }));
  });
}
