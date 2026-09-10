import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { z } from 'zod';
import { cleanText } from '../_middleware/text';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { canWriteClientRecord } from './access';
import { CreateLocationBody, IdResponse, UpdateLocationBody, VerifyPinBody } from './record-schema';
import { logRefused } from './refused';

/**
 * A client's locations (docs/SPEC/client-record.md section 4.2). Creating one
 * and general edits are staff-only; app.guard_location_notes()
 * (db/migrations/100_client_record.sql) is the column boundary for the one
 * write a practitioner may make once app.client_visible_to_practitioner opens
 * a door onto it — this route does not need to know that boundary exists,
 * only the RLS-role check every write already makes.
 */

const ClientParams = z.object({ id: z.uuid() });
const LocationParams = z.object({ id: z.uuid(), locationId: z.uuid() });

const point = (lng: number, lat: number): string => `SRID=4326;POINT(${lng} ${lat})`;

/**
 * One client, one primary location, and the client row knows which.
 *
 * The list's Emirate column reads `client.primary_location_id`
 * (app/api/clients/list.ts), and until the walk of 10 September nothing but the
 * seed ever wrote it: every client enrolled through the app showed no emirate.
 * The flag on the location and the link on the client are set together so the
 * two can never disagree, and the other locations are demoted before this one
 * is promoted — never the reverse, and never as one statement spanning both
 * rows. `location_one_primary_per_owner` (db/migrations/963_backfill_primary_location.sql)
 * is a plain, non-deferrable unique index, and Postgres checks it as each row
 * is written, not once at the end of the statement: a single UPDATE that sets
 * this row true and another false in the same pass can still hold both true
 * for an instant mid-statement, and the index refuses that even though the
 * statement's own final state is fine. Demoting everyone else first (to
 * false, which the index never restricts) and only then promoting this one
 * means no instant ever has two.
 */
async function makePrimary(db: Db, clientId: string, locationId: string): Promise<void> {
  await db.query(
    "update location set is_primary = false where owner_type = 'client' and owner_id = $1 " +
      'and id <> $2 and is_primary',
    [clientId, locationId],
  );
  await db.query('update location set is_primary = true where id = $1', [locationId]);
  await db.query('update client set primary_location_id = $2 where id = $1', [
    clientId,
    locationId,
  ]);
}

export function mountLocations(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.post('/api/clients/:id/locations', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    const params = ClientParams.safeParse(c.req.param());
    if (!params.success) return c.json({ error: 'bad_request', requestId }, 400);
    const clientId = params.data.id;
    const bodyJson = await c.req.json().catch(() => null);
    const body = CreateLocationBody.safeParse(bodyJson);
    if (!body.success) return c.json({ error: 'bad_request', requestId }, 400);
    if (body.data.makaniNumber && body.data.emirate !== 'DXB') {
      return c.json({ error: 'bad_request', requestId }, 400);
    }

    // app.client_status_for bypasses row level security: see contacts.ts for why this must
    // come before the role check (issue 13, third review round).
    const statusRow = await db.query<{ status: string | null }>(
      'select app.client_status_for($1) as status',
      [clientId],
    );
    const clientStatus = statusRow.rows[0]?.status ?? null;
    if (clientStatus === null) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (!canWriteClientRecord(actor, clientId, now())) {
      await logRefused(db, 'client', clientId, clientId);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    // Erased is read-only (client-record.md section 3): writers.sql would refuse the
    // insert outright; this gives the caller a clean reason rather than a raw RLS error.
    if (clientStatus === 'erased') {
      return c.json({ error: 'erased', requestId }, 400);
    }

    const locationId = randomUUID();
    // Always inserted false, whatever the request asked. location_one_primary_per_owner
    // (db/migrations/963_backfill_primary_location.sql) is a plain unique index, checked
    // immediately: inserting this row already flagged true, while the client's existing
    // primary is still flagged true too, would violate it before makePrimary ever ran.
    // makePrimary below is what actually earns the flag, in the one statement that also
    // demotes whichever location held it before.
    await db.query(
      'insert into location (id, tenant_id, owner_type, owner_id, label, emirate, ' +
        'makani_number, entrance_point, display_address, access_notes, is_primary) ' +
        "values ($1, $2, 'client', $3, $4, $5, $6, extensions.st_geogfromtext($7), $8, $9, false)",
      [
        locationId,
        actor.tenantId,
        clientId,
        body.data.label,
        body.data.emirate,
        body.data.makaniNumber ?? null,
        point(body.data.entranceLng, body.data.entranceLat),
        body.data.displayAddress ? cleanText(body.data.displayAddress, 400) : null,
        body.data.accessNotes ? cleanText(body.data.accessNotes, 1000) : null,
      ],
    );
    if (body.data.isPrimary) {
      await makePrimary(db, clientId, locationId);
    }
    return c.json(IdResponse.parse({ id: locationId }), 201);
  });

  api.patch('/api/clients/:id/locations/:locationId', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    const params = LocationParams.safeParse(c.req.param());
    if (!params.success) return c.json({ error: 'bad_request', requestId }, 400);
    const { id: clientId, locationId } = params.data;
    const bodyJson = await c.req.json().catch(() => null);
    const body = UpdateLocationBody.safeParse(bodyJson);
    if (!body.success) return c.json({ error: 'bad_request', requestId }, 400);

    // Client existence (bypassing row level security) before role, then the location
    // itself: the same ordering as contacts.ts, for the same reason (issue 13, third
    // review round).
    const statusRow = await db.query<{ status: string | null }>(
      'select app.client_status_for($1) as status',
      [clientId],
    );
    const clientStatus = statusRow.rows[0]?.status ?? null;
    if (clientStatus === null) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (!canWriteClientRecord(actor, clientId, now())) {
      await logRefused(db, 'client', clientId, clientId);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    if (clientStatus === 'erased') {
      return c.json({ error: 'erased', requestId }, 400);
    }
    const existing = await db.query<{ id: string; emirate: string }>(
      "select id, emirate from location where id = $1 and owner_type = 'client' and owner_id = $2",
      [locationId, clientId],
    );
    const existingRow = existing.rows[0];
    if (!existingRow) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    // The Dubai-only Makani rule (client-record.md; db/migrations/030_location.sql), applied
    // here as POST already applies it: a location's emirate is not itself editable through
    // this route, so the check reads the row's own emirate rather than the request body.
    if (
      body.data.makaniNumber !== undefined &&
      body.data.makaniNumber !== null &&
      existingRow.emirate !== 'DXB'
    ) {
      return c.json({ error: 'bad_request', requestId }, 400);
    }

    const sets: string[] = [];
    const values: unknown[] = [];
    const push = (column: string, value: unknown): void => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    const d = body.data;
    if (d.label !== undefined) push('label', d.label);
    if (d.makaniNumber !== undefined) push('makani_number', d.makaniNumber);
    if (d.displayAddress !== undefined)
      push('display_address', d.displayAddress ? cleanText(d.displayAddress, 400) : null);
    if (d.accessNotes !== undefined)
      push('access_notes', d.accessNotes ? cleanText(d.accessNotes, 1000) : null);
    // isPrimary true is deliberately never in this generic column list: writing it here
    // would flag this row true before the client's other locations are demoted, and
    // location_one_primary_per_owner (db/migrations/963_backfill_primary_location.sql)
    // refuses two flagged rows for the same owner even for an instant. makePrimary below
    // is the one statement that flips this row true and every other false together.
    // Flagging false carries no such risk, so it stays in the generic update.
    if (d.isPrimary === false) push('is_primary', false);
    if (sets.length === 0 && d.isPrimary === undefined) {
      return c.json({ error: 'bad_request', requestId }, 400);
    }

    if (sets.length > 0) {
      values.push(locationId);
      await db.query(`update location set ${sets.join(', ')} where id = $${values.length}`, values);
    }
    if (d.isPrimary === true) {
      await makePrimary(db, clientId, locationId);
    } else if (d.isPrimary === false) {
      // Unflagging the client's current primary clears the link too, so it never points
      // at a location whose own flag says it isn't one. Unflagging any other location — it
      // was never the link's target — leaves client.primary_location_id exactly as it was.
      await db.query(
        'update client set primary_location_id = null where id = $1 and primary_location_id = $2',
        [clientId, locationId],
      );
    }
    return c.json(IdResponse.parse({ id: locationId }));
  });

  // A distinct action from a general edit: dragging the marker to confirm
  // exactly where the entrance is (client-record.md section 4.2, "verify pin").
  api.post('/api/clients/:id/locations/:locationId/verify-pin', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    const params = LocationParams.safeParse(c.req.param());
    if (!params.success) return c.json({ error: 'bad_request', requestId }, 400);
    const { id: clientId, locationId } = params.data;
    const bodyJson = await c.req.json().catch(() => null);
    const body = VerifyPinBody.safeParse(bodyJson);
    if (!body.success) return c.json({ error: 'bad_request', requestId }, 400);

    const statusRow = await db.query<{ status: string | null }>(
      'select app.client_status_for($1) as status',
      [clientId],
    );
    const clientStatus = statusRow.rows[0]?.status ?? null;
    if (clientStatus === null) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (!canWriteClientRecord(actor, clientId, now())) {
      await logRefused(db, 'client', clientId, clientId);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    if (clientStatus === 'erased') {
      return c.json({ error: 'erased', requestId }, 400);
    }
    const existing = await db.query<{ id: string }>(
      "select id from location where id = $1 and owner_type = 'client' and owner_id = $2",
      [locationId, clientId],
    );
    if (existing.rowCount === 0) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    await db.query(
      'update location set entrance_point = extensions.st_geogfromtext($1) where id = $2',
      [point(body.data.lng, body.data.lat), locationId],
    );
    return c.json(IdResponse.parse({ id: locationId }));
  });
}
