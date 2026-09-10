import { z } from 'zod';
import { APPOINTMENT_STATUSES, BOARD_STATES } from '@domain/scheduling';

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
 * **The three fee figures are what the household is charged, and never a
 * session.** The founder's decision of 2026-09-04: a package's sessions are
 * never taken for a cancellation, and a visit called off inside the notice
 * period — or one that could not go ahead at the door — carries the practice's
 * call-out fee instead (`domain/billing`'s `callOutFeeFor`, posted by the
 * trigger in migration 408). All three are null when nothing is charged, so a
 * screen never warns about a fee that is not coming.
 *
 * **Net, VAT and gross, separately, because the net figure is the one a screen
 * has already named.** Every price this practice publishes is net and VAT is
 * added on top at write time when it is registered (migration 406), so a
 * drawer that says "AED 150.00" before the act and reads the gross back
 * afterwards would say "AED 157.50" about the same visit and look like a
 * practice that had moved its own price mid-sentence (design review of this
 * pull request). With the figures apart, a screen can show the same one and
 * say "including VAT" when there is VAT to include.
 *
 * They are **observed, not inferred**: the route reads back the charge
 * billing's trigger made in this same transaction, so a screen offers to waive
 * exactly the row that exists rather than one it assumed would be written.
 *
 * `feeInvoiceId` is that charge, and the id billing's waiver route needs:
 * `POST /api/billing/invoices/:id/waiver`.
 *
 * All four are null for a practitioner, and that is a limit rather than an
 * answer.
 * Their reach into a client's ledger goes through
 * `app.client_visible_to_practitioner` — confirmed visits only — and the visit
 * they have this moment called off is no longer one, so the read comes back
 * empty on that path. Nothing outside the office's own cancel drawer asks for
 * these two fields, and waiving a fee is not a practitioner's in any case
 * (`mayWaive`).
 */
export const CancelAppointmentResponse = z.object({
  id: z.uuid(),
  status: z.enum(['cancelled', 'cancelled_late']),
  reason: z.enum(CANCELLATION_REASONS),
  noticeHours: z.number().int().nonnegative(),
  /** The practice's own figure, before any VAT: what the drawer named before the act. */
  callOutFeeNetFils: z.number().int().positive().nullable(),
  /** The VAT added on top, which is zero unless the practice is registered. */
  callOutFeeVatFils: z.number().int().nonnegative().nullable(),
  /** The two together: what the household owes for this visit. */
  callOutFeeGrossFils: z.number().int().positive().nullable(),
  feeInvoiceId: z.uuid().nullable(),
});
export type CancelAppointmentResponse = z.infer<typeof CancelAppointmentResponse>;

/**
 * Telling the household, recorded (docs/SPEC/scheduling-manual.md section 3).
 *
 * There is no request schema: the act carries no choices, only the visit it
 * is about, and the route reads no body. (A caller still declares the request
 * JSON, because the shared `jsonOnly` middleware declines every POST that
 * does not.) The answer is the visit's new standing and nothing else — the screen
 * that asked reloads the day rather than patching one row from a reply, so
 * every other thing that may have changed since is on the screen too.
 */
export const ConfirmAppointmentResponse = z.object({
  id: z.uuid(),
  status: z.literal('confirmed'),
});
export type ConfirmAppointmentResponse = z.infer<typeof ConfirmAppointmentResponse>;

/** Why a move was refused before any rule was consulted. */
export const MOVE_ACTION_CODES = [
  'invalid_request',
  'appointment_not_found',
  'appointment_settled',
  'reason_required',
  // A visit somebody has already started delivering. How it ends is the
  // session's to say, not the calendar's.
  'session_open',
] as const;
export type MoveActionCode = (typeof MOVE_ACTION_CODES)[number];

/**
 * Why a cancellation was refused. The move's five and two of its own, for the
 * reason `CONFIRM_ACTION_CODES` below is its own list: both refusals here are
 * about *which reason was given* for calling a visit off, a move asks for a
 * reason but judges none of them, and a `Record` over one shared union made
 * the move drawer carry two sentences ending "Choose another reason" for
 * refusals its own route cannot produce.
 */
export const CANCEL_ACTION_CODES = [
  ...MOVE_ACTION_CODES,
  // "Could not go ahead at the door", given before the door could have been
  // reached. The one reason with a moment of its own.
  'reason_too_early',
  // A reason that says the household did something, given about a visit the
  // household has never been told about.
  'household_not_told',
] as const;
export type CancelActionCode = (typeof CANCEL_ACTION_CODES)[number];

/**
 * Why confirming a visit was refused. Its own short list rather than three
 * more members of the ones above: a cancellation can be refused for seven
 * reasons and this can be refused for three, and a `Record` over one union
 * would make every screen carry sentences for refusals its own route cannot
 * produce.
 */
export const CONFIRM_ACTION_CODES = [
  'invalid_request',
  'appointment_not_found',
  // Not waiting to be confirmed: confirmed already, or moved on past the
  // point of being announced at all.
  'appointment_not_proposed',
] as const;
export type ConfirmActionCode = (typeof CONFIRM_ACTION_CODES)[number];

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

/**
 * Changing either figure. Both optional and at least one required, so a screen
 * amending the notice period does not have to resend a fee it did not touch.
 *
 * The bounds are the column's own (db/migrations/202_scheduling_setting.sql):
 * a fortnight of notice is past anything a home visit could honestly ask for
 * and well inside a typo, and AED 10,000 is more than a single visit has ever
 * cost. Checked here as well as there so a mistake comes back as a sentence
 * rather than as a constraint violation.
 */
export const NOTICE_HOURS_MAX = 336;
export const UNFIT_FEE_FILS_MAX = 1_000_000;

export const UpdateSchedulingSettingsRequest = z
  .object({
    noticeHours: z.number().int().min(0).max(NOTICE_HOURS_MAX).optional(),
    unfitFeeFils: z.number().int().min(0).max(UNFIT_FEE_FILS_MAX).optional(),
  })
  .refine(
    (value) => value.noticeHours !== undefined || value.unfitFeeFils !== undefined,
    'Change at least one of the two figures.',
  );
export type UpdateSchedulingSettingsRequest = z.infer<typeof UpdateSchedulingSettingsRequest>;

/**
 * Applying an optimised day (docs/SPEC/route-planning.md section 5.7). One
 * request, several moves, one transaction: every old row is retired before
 * any new slot is taken, so an order that swaps two visits is not refused by
 * the exclusion constraints for clashing with itself.
 *
 * `wasWindowStart` is the window the plan was computed against. A row whose
 * window has moved since — or which is no longer `proposed` — refuses the
 * whole request as `stale_plan`, rather than applying half a plan to a day
 * that has changed underneath it.
 */
export const ReorderRequest = z.object({
  date: z.iso.date(),
  practitionerId: z.uuid(),
  moves: z
    .array(
      z.object({
        appointmentId: z.uuid(),
        windowStart: z.iso.datetime(),
        wasWindowStart: z.iso.datetime(),
        travelBufferMinutes: z.number().int().min(15).max(90),
      }),
    )
    .min(1)
    .max(10),
});
export type ReorderRequest = z.infer<typeof ReorderRequest>;

export const ReorderResponse = z.object({
  /** The visits that now stand, in the order they were asked for. */
  appointments: z.array(AppointmentRow),
  /** What each replaced, so the screen can say what moved from where. */
  movedFrom: z.array(z.object({ id: z.uuid(), windowStart: z.iso.datetime() })),
});
export type ReorderResponse = z.infer<typeof ReorderResponse>;

/** One visit on the board (docs/SPEC/dispatch.md 4.3 and 4.4): its facts, and the state read from them. */
export const BoardVisit = z.object({
  appointmentId: z.uuid(),
  windowStart: z.iso.datetime(),
  windowEnd: z.iso.datetime(),
  status: z.enum(APPOINTMENT_STATUSES),
  state: z.enum(BOARD_STATES),
  /**
   * The two names 4.3 asks a block to say, and nothing else of the household:
   * no record number, no age, no address. The id is the opaque handle the
   * screen asks the rest of the console with.
   */
  client: z.object({ id: z.uuid(), givenName: z.string(), familyName: z.string() }),
  serviceType: z.object({ id: z.uuid(), name: z.string(), durationMinutes: z.number().int() }),
  emirate: z.string(),
  checkedInAt: z.iso.datetime().nullable(),
  closedAt: z.iso.datetime().nullable(),
  /** Null when the deployment has no routing seam to price the drives with. */
  lateness: z.object({ late: z.boolean(), byMinutes: z.number().int().min(0) }).nullable(),
});
export type BoardVisit = z.infer<typeof BoardVisit>;

export const BoardPractitioner = z.object({
  practitionerId: z.uuid(),
  displayName: z.string(),
  /**
   * Whether they still work here. A practitioner who has left keeps a row for
   * as long as a visit is still against their name (spec 4.2) — a visit nobody
   * can see is a visit nobody drives to — but a visit may not be handed to
   * them, which the route refuses as `practitioner_not_found` (spec 6.2). The
   * board reads this to keep the two apart: the row is drawn, the drawer's
   * target list is not offered it, and a drop on it does nothing at all.
   */
  active: z.boolean(),
  /** In window order. Empty for an idle practitioner, who is still a row. */
  visits: z.array(BoardVisit),
});
export type BoardPractitioner = z.infer<typeof BoardPractitioner>;

/**
 * The whole board for one day (docs/SPEC/dispatch.md section 9).
 * `latenessAvailable` is false on a deployment with no routing seam: the
 * screen says the lateness is unknown rather than showing every visit as
 * comfortably on time.
 */
export const BoardResponse = z.object({
  date: z.iso.date(),
  latenessAvailable: z.boolean(),
  practitioners: z.array(BoardPractitioner),
});
export type BoardResponse = z.infer<typeof BoardResponse>;

/** Why a reorder was refused before anything was written. */
export const REORDER_ACTION_CODES = [
  'invalid_request',
  'reason_required',
  'appointment_not_found',
  'appointment_settled',
  'session_open',
  // The day moved while the plan was on screen: a window, a status or a
  // session is no longer what the plan was computed against.
  'stale_plan',
] as const;
export type ReorderActionCode = (typeof REORDER_ACTION_CODES)[number];

// ---------------------------------------------------------------------------
// Handing a visit to another practitioner
// ---------------------------------------------------------------------------

/**
 * A visit put in somebody else's hands (docs/SPEC/dispatch.md section 6.1).
 * The answer is `MoveAppointmentResponse`, because a reassignment leaves
 * exactly what a move leaves: the appointment that now stands and the one it
 * replaced.
 */
export const ReassignAppointmentRequest = z.object({
  /**
   * Lower-cased on the way in. `z.uuid()` accepts either case and Postgres
   * normalises what it stores, so the route's own "is this already their
   * visit?" test would compare a normalised id to raw text and let an
   * upper-case one past — a visit reassigned to the practitioner who already
   * holds it, as two rows, the new one naming itself as the one it was taken
   * from. Normalised once here, so every reader of this body sees one form.
   */
  practitionerId: z.uuid().transform((id) => id.toLowerCase()),
  /** Omitted: the household keeps the window it was promised. */
  windowStart: z.iso.datetime().optional(),
});
export type ReassignAppointmentRequest = z.infer<typeof ReassignAppointmentRequest>;

/**
 * Why a reassignment was refused before any rule was consulted. Its own list
 * rather than the move's plus two, for the reason `CONFIRM_ACTION_CODES` is
 * its own: the drawer that shows these sentences should carry only the ones
 * its own route can produce.
 */
export const REASSIGN_ACTION_CODES = [
  'invalid_request',
  'reason_required',
  'appointment_not_found',
  'appointment_settled',
  'session_open',
  // The visit is already that practitioner's, so there is nothing to hand over.
  'same_practitioner',
  // Nobody of that id in this practice.
  'practitioner_not_found',
] as const;
export type ReassignActionCode = (typeof REASSIGN_ACTION_CODES)[number];
