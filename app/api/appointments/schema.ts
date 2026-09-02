import { z } from 'zod';

/** The shapes the appointment routes return. Imported by the routes and, once
 * the second pull request adds the screen, by the browser. */

export const APPOINTMENT_STATUSES = [
  'proposed',
  'confirmed',
  'checked_in',
  'completed',
  'cancelled',
  'cancelled_late',
  'no_show',
  'rescheduled',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

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

export const AppointmentRow = z.object({
  id: z.uuid(),
  windowStart: z.iso.datetime(),
  windowEnd: z.iso.datetime(),
  status: z.enum(APPOINTMENT_STATUSES),
  deliveryMode: z.enum(DELIVERY_MODES),
  client: z.object({ id: z.uuid(), givenName: z.string(), familyName: z.string() }),
  practitioner: z.object({ id: z.uuid(), displayName: z.string() }),
  serviceType: z.object({ id: z.uuid(), name: z.string() }),
  location: z.object({ id: z.uuid(), label: z.string(), emirate: z.string() }),
});
export type AppointmentRow = z.infer<typeof AppointmentRow>;

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
