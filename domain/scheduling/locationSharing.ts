import type { AppointmentStatus } from './status';

/**
 * Live location for the dispatcher, built consent-first (docs/SPEC/dispatch.md
 * section 15, piece twenty-five; docs/PLAN/dispatch.md, "The one that needs
 * your signature"). Pure: every clock is an argument.
 *
 * Three things must all be true before a position is written, and this file
 * is the one place that says so:
 *
 * 1. **Consent.** The person has accepted the current notice
 *    (`docs/CONSENT/staff/location.en.md`) in their own app and has not
 *    withdrawn it. A consent to an earlier version of the notice is not a
 *    consent to this one.
 * 2. **Their own switch is on.** Consent is given once; sharing is turned on
 *    and off as often as the person likes, and off stops it at once.
 * 3. **Their shift is open.** Never overnight, never on a day off.
 *
 * **What "a shift" is.** The practice has no clock-in. Rather than invent one
 * the practitioner must remember, the shift is read from the day the practice
 * already records: it opens {@link SHIFT_LEAD_MINUTES} before the first
 * window of the day's first visit — the drive to the first door — and closes
 * {@link SHIFT_TAIL_MINUTES} after the last visit closed, or after it could at
 * the latest have ended if nobody closed it — a forgotten check-in included.
 * It never runs past {@link SHIFT_LATEST_HOUR}:00 in the practice's zone, and
 * a day with no visit on it has no shift at all. The
 * visits that make a shift are the ones that are stops on the practitioner's
 * own day sheet (`app/api/appointments/list.ts`'s own scope): confirmed,
 * checked in, completed, and nobody home — a visit nobody answered was still
 * driven to.
 */

/**
 * The version of the notice a consent must name (docs/CONSENT/staff/location.en.md).
 * 1.2 since round 76 (approved 6 October 2026): the notice speaks to helpers
 * too. The database's copy is `app.staff_location_notice_version()`, replaced
 * by migration 214.
 */
export const STAFF_LOCATION_NOTICE_VERSION = '1.2';

/** How long a position is kept before the hourly job deletes it: two days. */
export const POSITION_RETENTION_HOURS = 48;

/** The shift opens this long before the first visit's window: the drive to the first door. */
export const SHIFT_LEAD_MINUTES = 90;

/** And closes this long after the last visit is over: the drive away from the last door. */
export const SHIFT_TAIL_MINUTES = 30;

/**
 * The latest the shift ever runs, as an hour of the practice day in Dubai: a
 * visit left open, or a late booking, never carries sharing into the evening
 * at home (fix round 1 of piece twenty-five, review finding 3).
 */
export const SHIFT_LATEST_HOUR = 21;

/** The visits that make a working day: the stops on the practitioner's own day sheet. */
export const SHIFT_STATUSES: readonly AppointmentStatus[] = [
  'confirmed',
  'checked_in',
  'completed',
  'no_show',
];

/** As much of a visit as working out the shift needs. */
export type ShiftStop = {
  windowStart: Date;
  windowEnd: Date;
  durationMinutes: number;
  status: AppointmentStatus;
  /** When the visit's session closed, or null when it has not (or never opened). */
  closedAt: Date | null;
};

/** The practice day being asked about, midnight to midnight in the practice's zone. */
export type DayBounds = { start: Date; end: Date };

export type ShiftWindow = { opensAt: Date; closesAt: Date };

const MINUTE = 60_000;

/** When the shift opens and closes on this day, or null when there is no shift. */
export function shiftWindow(day: readonly ShiftStop[], bounds: DayBounds): ShiftWindow | null {
  // `bounds.start` is the practice day's midnight, so the latest hour is
  // arithmetic on it and needs no time zone here.
  const latest = Math.min(
    bounds.end.getTime(),
    bounds.start.getTime() + SHIFT_LATEST_HOUR * 60 * MINUTE,
  );
  const stops = day.filter(
    (stop) =>
      SHIFT_STATUSES.includes(stop.status) &&
      stop.windowStart.getTime() >= bounds.start.getTime() &&
      stop.windowStart.getTime() < latest,
  );
  if (stops.length === 0) return null;

  const first = Math.min(...stops.map((stop) => stop.windowStart.getTime()));
  const opensAt = Math.max(bounds.start.getTime(), first - SHIFT_LEAD_MINUTES * MINUTE);

  // A visit nobody closed — confirmed and never checked in, or checked in and
  // never finished — counts to the latest it could have ended. A forgotten
  // check-in is the same case, and never holds the shift open past it.
  const lastEnd = Math.max(
    ...stops.map(
      (stop) =>
        stop.closedAt?.getTime() ?? stop.windowEnd.getTime() + stop.durationMinutes * MINUTE,
    ),
  );
  const closesAt = Math.min(latest, lastEnd + SHIFT_TAIL_MINUTES * MINUTE);

  return { opensAt: new Date(opensAt), closesAt: new Date(closesAt) };
}

/** Whether the shift is open at `now`: from its opening, up to but not including its close. */
export function shiftOpen(day: readonly ShiftStop[], bounds: DayBounds, now: Date): boolean {
  const window = shiftWindow(day, bounds);
  if (window === null) return false;
  return now.getTime() >= window.opensAt.getTime() && now.getTime() < window.closesAt.getTime();
}

/** What is known, at the moment a position arrives, about the person sending it. */
export type SharingFacts = {
  /** The notice version their standing consent names, or null when they have none. */
  consentVersion: string | null;
  /** Their own switch. */
  sharingOn: boolean;
  shiftOpen: boolean;
};

export type PositionRefusal = 'no_consent' | 'notice_changed' | 'sharing_off' | 'off_shift';

/**
 * May this position be written now. The refusals are checked in the order the
 * person would have to put them right: consent, then the switch, then the
 * shift — which is the one thing they cannot change themselves.
 */
export function mayWritePosition(
  facts: SharingFacts,
): { ok: true } | { ok: false; reason: PositionRefusal } {
  if (facts.consentVersion === null) return { ok: false, reason: 'no_consent' };
  if (facts.consentVersion !== STAFF_LOCATION_NOTICE_VERSION) {
    return { ok: false, reason: 'notice_changed' };
  }
  if (!facts.sharingOn) return { ok: false, reason: 'sharing_off' };
  if (!facts.shiftOpen) return { ok: false, reason: 'off_shift' };
  return { ok: true };
}

/** Positions recorded before this instant are deleted by the hourly job. */
export function positionsCutoff(now: Date): Date {
  return new Date(now.getTime() - POSITION_RETENTION_HOURS * 60 * MINUTE);
}

/** Whole minutes since a position was recorded; never negative. */
export function positionAgeMinutes(recordedAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - recordedAt.getTime()) / MINUTE));
}

/**
 * Whom a helper accompanies now: a member of the practitioner's family who
 * drives and carries kit on the day (round 76, docs/SPEC/dispatch.md section
 * 15.12). Null when nobody — never named, or the accompaniment was revoked.
 */
export type Accompaniment = { practitionerId: string } | null;

/**
 * A helper's shift. A helper has no visits of their own, and none is invented
 * for them: their working day is the day of the practitioner they accompany,
 * read by the same rule as that practitioner's own (`shiftWindow`), fed that
 * practitioner's visits. No accompaniment, no shift — whatever anybody's day
 * holds.
 */
export function helperShiftWindow(
  accompaniment: Accompaniment,
  accompaniedDay: readonly ShiftStop[],
  bounds: DayBounds,
): ShiftWindow | null {
  if (accompaniment === null) return null;
  return shiftWindow(accompaniedDay, bounds);
}

/** Whether a helper's shift is open at `now`, on the same terms as `shiftOpen`. */
export function helperShiftOpen(
  accompaniment: Accompaniment,
  accompaniedDay: readonly ShiftStop[],
  bounds: DayBounds,
  now: Date,
): boolean {
  if (accompaniment === null) return false;
  return shiftOpen(accompaniedDay, bounds, now);
}

/**
 * The first word of a display name. A helper's page names the practitioner
 * they accompany by first name only, and so does the board beside a helper's
 * position: enough to recognise somebody they know, and no more.
 */
export function firstNameOf(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] ?? '';
}
