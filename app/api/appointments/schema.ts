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
 * One appointment on the wire.
 *
 * The four optional fields — `client.mrn`, `client.age`, `location.entrancePoint`
 * and `location.parkingPoint` — are served for `scope: 'own'` only, never for
 * the practice-wide scope, and `app/api/appointments/list.ts` is where that is
 * enforced. The practitioner's Today screen needs them to drive to a door, say
 * who is behind it, and hand the record number to check-in; the coordinator's
 * day schedule needs none of them, and scheduling-manual.md section 11 holds
 * that screen to "window, names, practitioner, service, place, status" and
 * nothing further. Absent means the caller did not ask for that scope; null
 * (`age`, `parkingPoint`) means the practice has nothing on file.
 *
 * `mrn` is the practice's own record number (MW-000123), not an identity
 * number: it is what the check-in screen already asks a practitioner to type,
 * and what this screen saves them typing.
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
    mrn: z.string().optional(),
    age: z.number().int().min(0).nullable().optional(),
  }),
  practitioner: z.object({ id: z.uuid(), displayName: z.string() }),
  serviceType: z.object({ id: z.uuid(), name: z.string() }),
  location: z.object({
    id: z.uuid(),
    label: z.string(),
    emirate: z.string(),
    // Never null when present: db/migrations/030_location.sql requires a
    // verified entrance coordinate on every location.
    entrancePoint: GeoPoint.optional(),
    parkingPoint: GeoPoint.nullable().optional(),
  }),
});
export type AppointmentRow = z.infer<typeof AppointmentRow>;

/** Whose day is being asked for: the whole practice's, or the caller's own. */
export const APPOINTMENT_SCOPES = ['practice', 'own'] as const;
export type AppointmentScope = (typeof APPOINTMENT_SCOPES)[number];

export const AppointmentListResponse = z.object({ appointments: z.array(AppointmentRow) });
export type AppointmentListResponse = z.infer<typeof AppointmentListResponse>;

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
