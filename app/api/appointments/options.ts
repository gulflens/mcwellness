import type { Hono } from 'hono';
import { z } from 'zod';
import { canActor } from '@domain/shared';
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
  "where status = 'active' order by name";

const PRACTITIONERS_SQL =
  'select distinct p.id, u.display_name ' +
  'from practitioner p ' +
  'join app_user u on u.id = p.user_id ' +
  'join credential cr on cr.practitioner_id = p.id ' +
  "where p.status = 'active' and cr.service_type_id = $1 and cr.can_execute_session " +
  'and cr.valid_from <= $2 and (cr.valid_to is null or cr.valid_to >= $2) ' +
  'order by u.display_name';

const CLIENT_LOCATIONS_SQL =
  'select id, label::text as label, emirate::text as emirate from location ' +
  "where owner_type = 'client' and owner_id = $1 " +
  'union all ' +
  'select l.id, l.label::text as label, l.emirate::text as emirate from location l ' +
  'join tenant t on t.location_id = l.id ' +
  'order by label';

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
      const { rows } = await db.query<LocationRow>(CLIENT_LOCATIONS_SQL, [query.data.clientId]);
      locationRows = rows;
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
