import type { Hono } from 'hono';
import { z } from 'zod';
import { canActor } from '@domain/shared';
import { logRead, logReads } from '../_middleware/audit';
import type { ApiEnv } from '../_middleware/request-context';
import { AppointmentOptionsResponse, type DeliveryMode } from './schema';

/**
 * GET /api/appointments/options: what the "new appointment" form (scheduling-manual.md
 * section 4.3) needs to fill itself in — active services, the practitioners
 * actually credentialed for a chosen service on a chosen date, and a chosen
 * client's own locations plus the studio. Kept inside app/api/appointments,
 * which this stream owns, rather than a separate app/api/practitioners route
 * nobody owns yet; scheduling already reads practitioner, credential, service_type
 * and location directly (scheduling-manual.md header). No screen calls this
 * yet — that is this stream's second pull request.
 *
 * Every query below carries an explicit tenant_id = app.current_tenant_id()
 * predicate (the same defence-in-depth billing/prices.ts uses): row
 * security already enforces this, but a mistaken query here should fail
 * loudly in review and in tests/scheduling/db, not rely on RLS being the
 * only thing standing between one practice's options and another's.
 */

const PRACTICE_TIME_ZONE = 'Asia/Dubai';

const Query = z.object({
  clientId: z.uuid().optional(),
  serviceTypeId: z.uuid().optional(),
  date: z.iso.date().optional(),
});

type ServiceTypeRow = { id: string; name: string; delivery_modes: DeliveryMode[] };
type PractitionerRow = { id: string; display_name: string };
type LocationRow = { id: string; label: string; emirate: string };

// delivery_modes is an array of the custom delivery_mode enum: pg has no
// built-in parser for a custom enum's array OID and would hand the route the
// raw "{home,studio}" text, so it is cast to the built-in text[] here, which
// pg does parse into a real JS array.
const SERVICE_TYPES_SQL =
  'select id, name, delivery_modes::text[] as delivery_modes from service_type ' +
  "where tenant_id = app.current_tenant_id() and status = 'active' order by name";

// Every joined table repeats the tenant_id predicate, not only the driving
// practitioner row (this route's own docstring): app_user and credential
// each carry their own tenant_id, and a join condition alone would trust
// that practitioner_id and user_id never point across a tenant boundary.
const PRACTITIONERS_SQL =
  'select distinct p.id, u.display_name ' +
  'from practitioner p ' +
  'join app_user u on u.id = p.user_id ' +
  'join credential cr on cr.practitioner_id = p.id ' +
  'where p.tenant_id = app.current_tenant_id() and u.tenant_id = app.current_tenant_id() ' +
  "and cr.tenant_id = app.current_tenant_id() and p.status = 'active' and cr.service_type_id = $1 " +
  'and cr.can_execute_session and cr.valid_from <= $2 and (cr.valid_to is null or cr.valid_to >= $2) ' +
  'order by u.display_name';

// tenant carries no tenant_id of its own (it is the tenant row itself,
// db/migrations/010_tenant.sql's recorded exemption), so the predicate that
// matches every other table's "tenant_id = app.current_tenant_id()" is
// "t.id = app.current_tenant_id()" here.
const CLIENT_LOCATIONS_SQL =
  'select id, label::text as label, emirate::text as emirate from location ' +
  "where tenant_id = app.current_tenant_id() and owner_type = 'client' and owner_id = $1 " +
  'union all ' +
  'select l.id, l.label::text as label, l.emirate::text as emirate from location l ' +
  'join tenant t on t.location_id = l.id ' +
  'where l.tenant_id = app.current_tenant_id() and t.id = app.current_tenant_id() ' +
  'order by label';

// Proof the client is actually this tenant's own before anything about them
// is read or logged (see the read-logging order below).
const CLIENT_EXISTS_SQL =
  'select 1 from client where id = $1 and tenant_id = app.current_tenant_id()';

export function mountAppointmentOptions(api: Hono<ApiEnv>): void {
  api.get('/api/appointments/options', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    if (
      !canActor(
        actor,
        { type: 'appointment.list', scope: 'practice' },
        { timeZone: PRACTICE_TIME_ZONE },
        new Date(),
      )
    ) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const query = Query.safeParse(c.req.query());
    if (!query.success) {
      return c.json({ error: 'bad_request', requestId }, 400);
    }
    const db = c.get('db');

    const { rows: serviceTypeRows } = await db.query<ServiceTypeRow>(SERVICE_TYPES_SQL);

    let practitionerRows: PractitionerRow[] = [];
    if (query.data.serviceTypeId && query.data.date) {
      const { rows } = await db.query<PractitionerRow>(PRACTITIONERS_SQL, [
        query.data.serviceTypeId,
        query.data.date,
      ]);
      practitionerRows = rows;
    }

    let locationRows: LocationRow[] = [];
    if (query.data.clientId) {
      const clientId = query.data.clientId;
      // Proven in the practice before it is logged as read: CLIENT_LOCATIONS_SQL's
      // second branch returns the tenant's own studio location unconditionally
      // (it is not filtered by owner_id), so "the locations query returned
      // rows" is never a reliable existence check on its own here — an id for
      // another tenant's client, or no client at all, would still come back
      // with that one row. A direct, tenant-scoped existence check first
      // means a caller can never make this route write an audit row claiming
      // a client was read when no such client was ever proven to exist.
      const exists = await db.query(CLIENT_EXISTS_SQL, [clientId]);
      if (exists.rows.length > 0) {
        // This client's own record is read to build the form (their locations,
        // below); logged exactly as app/api/clients/list.ts logs what it shows.
        await logRead(db, 'client', clientId, clientId);
        const { rows } = await db.query<LocationRow>(CLIENT_LOCATIONS_SQL, [clientId]);
        locationRows = rows;
        if (locationRows.length > 0) {
          await logReads(
            db,
            'location',
            locationRows.map((r) => ({ id: r.id, clientId })),
            'read',
          );
        }
      }
    }

    return c.json(
      AppointmentOptionsResponse.parse({
        serviceTypes: serviceTypeRows.map((r) => ({
          id: r.id,
          name: r.name,
          deliveryModes: r.delivery_modes,
        })),
        practitioners: practitionerRows.map((r) => ({ id: r.id, displayName: r.display_name })),
        locations: locationRows.map((r) => ({ id: r.id, label: r.label, emirate: r.emirate })),
      }),
    );
  });
}
