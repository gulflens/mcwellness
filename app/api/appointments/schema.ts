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
 * - **The practitioner.** Every row is the caller's own.
 *
 * `clientId`, `serviceType.id` and `location.id` are all opaque ids of rows,
 * not personal data, and each is here because something on the screen needs
 * a handle. `location.id` is the handle for the one write a practitioner has
 * on a client's record (access notes, db/policies/client/writers.sql).
 *
 * **`clientId` was deliberately absent until now**, on the reasoning that
 * nothing on the day sheet opened a client record by id and check-in is
 * reached by record number. Something does need it now: the stop card asks
 * billing what this household holds and what it owes
 * (`GET /api/billing/clients/:clientId/balance`,
 * docs/CHANGE-REQUESTS/billing-03.md item 5), and a uuid in a path is
 * exactly what `.claude/rules/ui.md` means by "route by opaque ids only".
 * The record number is still the thing that never travels in an address.
 *
 * `age` and `parkingPoint` are null when the practice holds neither;
 * `entrancePoint` is never null, because db/migrations/030_location.sql
 * requires a verified entrance coordinate on every location.
 */
export const DayStop = z.object({
  id: z.uuid(),
  clientId: z.uuid(),
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
  // The code as well as the name: billing's stop-card balance answers per
  // service by code and never by id (`StopBalanceResponse`), because an id on
  // a doorstep phone is one more thing that can leak. So the card matches on
  // the code, and needs it here to do that.
  serviceType: z.object({ id: z.uuid(), code: z.string(), name: z.string() }),
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

// ---------------------------------------------------------------------------
// Moving a visit, and calling one off
// ---------------------------------------------------------------------------

/**
 * Moving a visit to a new arrival window, on the same day or another one
 * (docs/SPEC/scheduling-manual.md sections 2 and 3). Only the window moves:
 * the client, the service, the place, the delivery mode and the practitioner
 * all carry over, and reassigning a visit to somebody else is its own action
 * the same section names separately.
 *
 * The window end is not sent. It is always the start plus forty-five minutes
 * (`windowFor`, domain/scheduling/window.ts), and a wire that could disagree
 * with the rule is a wire that eventually does.
 */
export const MoveAppointmentRequest = z.object({
  windowStart: z.iso.datetime(),
  travelBufferMinutes: z.number().int().min(15).max(90).optional(),
});
export type MoveAppointmentRequest = z.infer<typeof MoveAppointmentRequest>;

/**
 * What a move leaves behind: the appointment that now stands, and the one it
 * replaced. Both, because the household was promised the old window and the
 * screen that just moved it should be able to say what it moved from without
 * asking again.
 */
export const MoveAppointmentResponse = z.object({
  appointment: AppointmentRow,
  movedFrom: z.object({
    id: z.uuid(),
    windowStart: z.iso.datetime(),
    windowEnd: z.iso.datetime(),
  }),
});
export type MoveAppointmentResponse = z.infer<typeof MoveAppointmentResponse>;

/**
 * The reasons a person may give when calling a visit off. A subset of the
 * database's own `appointment_cancellation_reason`: `consent_withdrawn` is
 * absent because no one chooses it — it is written by
 * `app.cancel_future_appointments` when a consent goes, for a whole client at
 * once, and offering it here would let a coordinator cancel one visit as
 * though a consent had been withdrawn when none had.
 */
export const CANCELLATION_REASONS = [
  'client_request',
  'practice_request',
  'unfit_to_attend',
] as const;
export type CancellationReason = (typeof CANCELLATION_REASONS)[number];

export const CancelAppointmentRequest = z.object({
  reason: z.enum(CANCELLATION_REASONS),
});
export type CancelAppointmentRequest = z.infer<typeof CancelAppointmentRequest>;

/**
 * What calling a visit off cost.
 *
 * `status` is the answer the notice rule gave (domain/scheduling's
 * `cancellationStatusFor`), and `noticeHours` is the figure it was given, so
 * a screen can say "inside the practice's 24 hours" rather than "late".
 *
 * `creditConsumed` is observed, not inferred. Billing's own trigger
 * (404_billing_consumption.sql) fires on `cancelled_late` and takes a credit
 * if the client has one; this route reads back whether it found one, so a
 * late cancellation against a client with no credits left says so honestly
 * instead of claiming a charge that never happened.
 *
 * `waiverEntitlementId` is the credit that was taken, and the id billing's
 * own waiver route needs: `POST /api/billing/entitlements/:id/waiver`. Null
 * whenever nothing was taken, so a screen never offers to give back what was
 * never charged.
 */
export const CancelAppointmentResponse = z.object({
  id: z.uuid(),
  status: z.enum(['cancelled', 'cancelled_late']),
  reason: z.enum(CANCELLATION_REASONS),
  noticeHours: z.number().int().nonnegative(),
  creditConsumed: z.boolean(),
  waiverEntitlementId: z.uuid().nullable(),
});
export type CancelAppointmentResponse = z.infer<typeof CancelAppointmentResponse>;

/** Why a move or a cancellation was refused before any rule was consulted. */
export const APPOINTMENT_ACTION_CODES = [
  'invalid_request',
  'appointment_not_found',
  'appointment_settled',
  'reason_required',
  // "Could not go ahead at the door", given before the door could have been
  // reached. The one reason with a moment of its own.
  'reason_too_early',
  // A visit somebody has already started delivering. How it ends is the
  // session's to say, not the calendar's.
  'session_open',
] as const;
export type AppointmentActionCode = (typeof APPOINTMENT_ACTION_CODES)[number];

/**
 * The practice's cancellation policy, for the screens that have to name its
 * consequences before somebody acts (`GET /api/appointments/settings`).
 * `unfitFeeFils` is integer fils, like every amount in this codebase.
 */
export const SchedulingSettingsResponse = z.object({
  noticeHours: z.number().int().nonnegative(),
  unfitFeeFils: z.number().int().nonnegative(),
});
export type SchedulingSettingsResponse = z.infer<typeof SchedulingSettingsResponse>;
