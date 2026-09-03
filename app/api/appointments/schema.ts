import { z } from 'zod';
import { APPOINTMENT_STATUSES } from '@domain/scheduling';

/** The shapes the appointment routes return. Imported by the routes and by
 * the two screens that read them: the admin console's day schedule and the
 * practitioner's Today. */

// The lifecycle itself lives in domain/scheduling/status.ts, where the rules
// that judge it live; this file validates the wire against that list rather
// than keeping a second copy of it.
export { APPOINTMENT_STATUSES };
export type { AppointmentStatus } from '@domain/scheduling';

export const DELIVERY_MODES = ['home', 'studio', 'remote'] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];

export const CONFLICT_CODES = [
  'practitioner_overlap',
  'client_overlap',
  'credential_invalid',
  'client_inactive',
  'consent_missing',
] as const;

/** Why a booking attempt was refused before it ever reached a conflict check:
 * a row that does not exist, is not active, or does not fit. */
export const BAD_REQUEST_CODES = [
  'invalid_request',
  'client_not_found',
  'practitioner_not_found',
  'practitioner_inactive',
  'service_type_not_found',
  'service_type_inactive',
  'delivery_mode_unavailable',
  'location_not_found',
  'location_mismatch',
] as const;
export type BadRequestCode = (typeof BAD_REQUEST_CODES)[number];

export const ConflictIssue = z.object({
  code: z.enum(CONFLICT_CODES),
  message: z.string(),
  conflictsWithAppointmentId: z.uuid().nullable(),
});
export type ConflictIssue = z.infer<typeof ConflictIssue>;

/** A verified coordinate, as the browser reads it. */
export const GeoPoint = z.object({ lat: z.number(), lng: z.number() });
export type GeoPoint = z.infer<typeof GeoPoint>;

/**
 * One appointment as the coordinator's day schedule reads it
 * (`scope: 'practice'`). scheduling-manual.md section 11 holds that screen to
 * "window, names, practitioner, service, place, status" and nothing further.
 */
export const AppointmentRow = z.object({
  id: z.uuid(),
  windowStart: z.iso.datetime(),
  windowEnd: z.iso.datetime(),
  status: z.enum(APPOINTMENT_STATUSES),
  deliveryMode: z.enum(DELIVERY_MODES),
  client: z.object({
    id: z.uuid(),
    givenName: z.string(),
    familyName: z.string(),
    givenNameAr: z.string().nullable(),
    familyNameAr: z.string().nullable(),
  }),
  practitioner: z.object({ id: z.uuid(), displayName: z.string() }),
  serviceType: z.object({ id: z.uuid(), name: z.string() }),
  location: z.object({ id: z.uuid(), label: z.string(), emirate: z.string() }),
});
export type AppointmentRow = z.infer<typeof AppointmentRow>;

/**
 * One stop as the practitioner's own day reads it (`scope: 'own'`,
 * scheduling-manual.md section 5.1). A different shape from `AppointmentRow`,
 * not a superset of it, because the two screens need genuinely different
 * facts and each should carry only its own.
 *
 * What this shape has that the practice one does not: the record number, the
 * client's age, and the location's coordinates. A practitioner has to drive
 * to a door, say who is behind it and hand the record number to check-in;
 * a coordinator placing a visit needs none of the three.
 *
 * What it deliberately lacks:
 *
 * - **The family name.** The screen shows a first name and a family initial
 *   (section 5.1), so the initial is what crosses the wire — computed in
 *   SQL, in both scripts. The full family name never leaves the database for
 *   this screen, which is a property of the shape rather than of what the
 *   component happens to render.
 * - **The client's id.** Nothing on the day sheet opens a client record by
 *   id; check-in is reached by record number. The route still resolves the
 *   id internally to write the audit trail — it just does not hand it out.
 * - **The practitioner.** Every row is the caller's own.
 *
 * `serviceType.id` and `location.id` stay: they are opaque ids of practice
 * rows, not personal data, and `location.id` is the handle for the one write
 * a practitioner has on a client's record (access notes,
 * db/policies/client/writers.sql).
 *
 * `age` and `parkingPoint` are null when the practice holds neither;
 * `entrancePoint` is never null, because db/migrations/030_location.sql
 * requires a verified entrance coordinate on every location.
 */
export const DayStop = z.object({
  id: z.uuid(),
  windowStart: z.iso.datetime(),
  windowEnd: z.iso.datetime(),
  status: z.enum(APPOINTMENT_STATUSES),
  deliveryMode: z.enum(DELIVERY_MODES),
  client: z.object({
    // The practice's own record number (MW-000123), never an identity number:
    // it is what the check-in screen already asks a practitioner to type.
    mrn: z.string(),
    givenName: z.string(),
    givenNameAr: z.string().nullable(),
    familyInitial: z.string(),
    familyInitialAr: z.string().nullable(),
    age: z.number().int().min(0).nullable(),
  }),
  serviceType: z.object({ id: z.uuid(), name: z.string() }),
  location: z.object({
    id: z.uuid(),
    label: z.string(),
    emirate: z.string(),
    entrancePoint: GeoPoint,
    parkingPoint: GeoPoint.nullable(),
  }),
});
export type DayStop = z.infer<typeof DayStop>;

/** Whose day is being asked for: the whole practice's, or the caller's own. */
export const APPOINTMENT_SCOPES = ['practice', 'own'] as const;
export type AppointmentScope = (typeof APPOINTMENT_SCOPES)[number];

/**
 * `GET /api/appointments` answers under one key, `appointments`, in whichever
 * shape the scope asked for: parse with the schema matching the scope you
 * requested. A body of the wrong shape fails the parse rather than quietly
 * losing fields.
 */
export const AppointmentListResponse = z.object({ appointments: z.array(AppointmentRow) });
export type AppointmentListResponse = z.infer<typeof AppointmentListResponse>;

/**
 * The own scope's answer. Effective range: a stop appears here only while its
 * client is on the caller's schedule, which
 * db/migrations/201_client_visible_to_practitioner.sql defines as 90 Dubai
 * days back to 30 Dubai days ahead. Ask for a date beyond that and the list
 * comes back empty even though appointments exist on it — the client rows
 * the list joins are not readable, so the rows never form. That is the same
 * rule the day sheet lives by, not a bug in the query, but it is silent, so
 * it is written down here and in list.ts.
 */
export const DayStopListResponse = z.object({ appointments: z.array(DayStop) });
export type DayStopListResponse = z.infer<typeof DayStopListResponse>;

export const AppointmentOptionsResponse = z.object({
  serviceTypes: z.array(
    z.object({ id: z.uuid(), name: z.string(), deliveryModes: z.array(z.enum(DELIVERY_MODES)) }),
  ),
  practitioners: z.array(z.object({ id: z.uuid(), displayName: z.string() })),
  locations: z.array(z.object({ id: z.uuid(), label: z.string(), emirate: z.string() })),
});
export type AppointmentOptionsResponse = z.infer<typeof AppointmentOptionsResponse>;

export const CreateAppointmentRequest = z.object({
  clientId: z.uuid(),
  practitionerId: z.uuid(),
  serviceTypeId: z.uuid(),
  locationId: z.uuid(),
  deliveryMode: z.enum(DELIVERY_MODES),
  windowStart: z.iso.datetime(),
  travelBufferMinutes: z.number().int().min(15).max(90).optional(),
});
export type CreateAppointmentRequest = z.infer<typeof CreateAppointmentRequest>;

export const ConflictResponse = z.object({
  error: z.literal('conflict'),
  issues: z.array(ConflictIssue),
  requestId: z.string().nullable(),
});
export type ConflictResponse = z.infer<typeof ConflictResponse>;
