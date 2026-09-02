import type { Hono } from 'hono';
import { z } from 'zod';
import { canActor } from '@domain/shared';
import { logReads } from '../_middleware/audit';
import type { ApiEnv } from '../_middleware/request-context';
import { AppointmentListResponse, type AppointmentRow, type DeliveryMode } from './schema';

/**
 * GET /api/appointments: the admin day view (scheduling-manual.md section
 * 4.1, cut down to a table for this stream's first pull request — the
 * calendar and the map are the second). One tenant-local calendar day,
 * across every practitioner. The practitioner's own day (scope 'own') is a
 * later pull request's door; this route only ever asks for 'practice'.
 *
 * The query below carries an explicit tenant_id = app.current_tenant_id()
 * predicate (the same defence-in-depth billing/prices.ts uses): row
 * security already enforces this, but a mistaken query here should fail
 * loudly in review and in tests/scheduling/db, not rely on RLS being the
 * only thing standing between one practice's day sheet and another's.
 */

const PRACTICE_TIME_ZONE = 'Asia/Dubai';
const PRACTICE_UTC_OFFSET = '+04:00'; // Asia/Dubai carries no daylight-saving change.

const Query = z.object({ date: z.iso.date() });

type Row = {
  id: string;
  window_start: Date;
  window_end: Date;
  status: AppointmentRow['status'];
  delivery_mode: DeliveryMode;
  client_id: string;
  client_given_name: string;
  client_family_name: string;
  client_given_name_ar: string | null;
  client_family_name_ar: string | null;
  practitioner_id: string;
  practitioner_display_name: string;
  service_type_id: string;
  service_type_name: string;
  location_id: string;
  location_label: string;
  location_emirate: string;
};

// Every joined table repeats the tenant_id predicate, not only the driving
// appointment row: a join condition alone (c.id = a.client_id) trusts that
// a.client_id can never point outside the tenant, which is exactly the kind
// of assumption row security is the backstop for, not the only line of
// defence (this route's own docstring, and billing/prices.ts's precedent).
const SQL =
  'select a.id, a.window_start, a.window_end, a.status, a.delivery_mode, ' +
  'c.id as client_id, c.given_name as client_given_name, c.family_name as client_family_name, ' +
  'c.given_name_ar as client_given_name_ar, c.family_name_ar as client_family_name_ar, ' +
  'p.id as practitioner_id, u.display_name as practitioner_display_name, ' +
  'st.id as service_type_id, st.name as service_type_name, ' +
  'l.id as location_id, l.label::text as location_label, l.emirate::text as location_emirate ' +
  'from appointment a ' +
  'join client c on c.id = a.client_id ' +
  'join practitioner p on p.id = a.practitioner_id ' +
  'join app_user u on u.id = p.user_id ' +
  'join service_type st on st.id = a.service_type_id ' +
  'join location l on l.id = a.location_id ' +
  'where a.tenant_id = app.current_tenant_id() and c.tenant_id = app.current_tenant_id() ' +
  'and p.tenant_id = app.current_tenant_id() and u.tenant_id = app.current_tenant_id() ' +
  'and st.tenant_id = app.current_tenant_id() and l.tenant_id = app.current_tenant_id() ' +
  'and a.window_start >= $1 and a.window_start < $2 ' +
  'order by a.window_start';

function dayRange(date: string): [Date, Date] {
  const start = new Date(`${date}T00:00:00${PRACTICE_UTC_OFFSET}`);
  const end = new Date(start.getTime() + 24 * 60 * 60_000);
  return [start, end];
}

export function mountAppointmentList(api: Hono<ApiEnv>): void {
  api.get('/api/appointments', async (c) => {
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
    const [dayStart, dayEnd] = dayRange(query.data.date);
    const { rows } = await c.get('db').query<Row>(SQL, [dayStart, dayEnd]);
    const appointments: AppointmentRow[] = rows.map((r) => ({
      id: r.id,
      windowStart: r.window_start.toISOString(),
      windowEnd: r.window_end.toISOString(),
      status: r.status,
      deliveryMode: r.delivery_mode,
      client: {
        id: r.client_id,
        givenName: r.client_given_name,
        familyName: r.client_family_name,
        givenNameAr: r.client_given_name_ar,
        familyNameAr: r.client_family_name_ar,
      },
      practitioner: { id: r.practitioner_id, displayName: r.practitioner_display_name },
      serviceType: { id: r.service_type_id, name: r.service_type_name },
      location: { id: r.location_id, label: r.location_label, emirate: r.location_emirate },
    }));
    await logReads(
      c.get('db'),
      'appointment',
      appointments.map((a) => ({ id: a.id, clientId: a.client.id })),
      'list',
    );
    return c.json(AppointmentListResponse.parse({ appointments }));
  });
}
