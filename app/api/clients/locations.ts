import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { z } from 'zod';
import { cleanText } from '../_middleware/text';
import type { ApiEnv } from '../_middleware/request-context';
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

    if (!canWriteClientRecord(actor, clientId, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const client = await db.query<{ id: string; status: string }>(
      'select id, status from client where id = $1',
      [clientId],
    );
    if (client.rowCount === 0) {
      await logRefused(db, 'client', clientId, clientId);
      return c.json({ error: 'not_found', requestId }, 404);
    }
    // Erased is read-only (client-record.md section 3): writers.sql would refuse the
    // insert outright; this gives the caller a clean reason rather than a raw RLS error.
    if (client.rows[0]?.status === 'erased') {
      return c.json({ error: 'erased', requestId }, 400);
    }

    const locationId = randomUUID();
    await db.query(
      'insert into location (id, tenant_id, owner_type, owner_id, label, emirate, ' +
        'makani_number, entrance_point, display_address, access_notes, is_primary) ' +
        "values ($1, $2, 'client', $3, $4, $5, $6, extensions.st_geogfromtext($7), $8, $9, $10)",
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
        body.data.isPrimary,
      ],
    );
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

    if (!canWriteClientRecord(actor, clientId, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const existing = await db.query<{ id: string; status: string }>(
      'select l.id, c.status from location l join client c on c.id = l.owner_id ' +
        "where l.id = $1 and l.owner_type = 'client' and l.owner_id = $2",
      [locationId, clientId],
    );
    if (existing.rowCount === 0) {
      await logRefused(db, 'location', locationId, clientId);
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (existing.rows[0]?.status === 'erased') {
      return c.json({ error: 'erased', requestId }, 400);
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
    if (d.isPrimary !== undefined) push('is_primary', d.isPrimary);
    if (sets.length === 0) return c.json({ error: 'bad_request', requestId }, 400);

    values.push(locationId);
    await db.query(`update location set ${sets.join(', ')} where id = $${values.length}`, values);
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

    if (!canWriteClientRecord(actor, clientId, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const existing = await db.query<{ id: string; status: string }>(
      'select l.id, c.status from location l join client c on c.id = l.owner_id ' +
        "where l.id = $1 and l.owner_type = 'client' and l.owner_id = $2",
      [locationId, clientId],
    );
    if (existing.rowCount === 0) {
      await logRefused(db, 'location', locationId, clientId);
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (existing.rows[0]?.status === 'erased') {
      return c.json({ error: 'erased', requestId }, 400);
    }
    await db.query(
      'update location set entrance_point = extensions.st_geogfromtext($1) where id = $2',
      [point(body.data.lng, body.data.lat), locationId],
    );
    return c.json(IdResponse.parse({ id: locationId }));
  });
}
