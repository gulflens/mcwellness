/**
 * The household's own view of its visits (docs/SPEC/client-portal.md sections
 * 3.2 and 5, rule 7): which appointments it is shown, in which order, and what
 * a finished one is called.
 *
 * Two statuses are deliberately absent from both lists. A `proposed`
 * appointment is a plan the practice has not put to the household yet, so
 * showing it would announce a visit nobody has agreed to; a `rescheduled` row
 * is the record of a visit that moved, and the visit that replaced it is
 * already in the list, so showing both would say a household has twice as many
 * appointments as it has.
 *
 * Pure: "today" is always an argument (.claude/rules/testing.md).
 */

import type { IsoDate } from '../shared';

/**
 * The appointment lifecycle as `appointment_status` holds it (migration 200).
 * Restated here rather than imported: `domain/scheduling` belongs to another
 * stream and no module reaches into another's domain (docs/SPEC/OWNERSHIP.md
 * rule 3).
 */
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

/** The words a household reads about a visit that has already happened, or not. */
export const VISIT_OUTCOMES = ['completed', 'missed', 'cancelled'] as const;
export type VisitOutcome = (typeof VISIT_OUTCOMES)[number];

/**
 * What a finished visit is called.
 *
 * `cancelled_late` reads as "Cancelled" and nothing more. The household called
 * it off inside the notice period and the fee, if the practice charged one, is
 * on the money screen where a charge belongs; a second word here would be the
 * portal telling somebody off (docs/SPEC/client-portal.md section 3.2).
 * Anything still to come has no outcome yet, and answers null.
 */
export function visitOutcome(status: AppointmentStatus): VisitOutcome | null {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'no_show':
      return 'missed';
    case 'cancelled':
    case 'cancelled_late':
      return 'cancelled';
    default:
      return null;
  }
}

/**
 * The outcome in the person's own language. Three words, and the one place
 * they are written (rule 7 asks the domain for them, so the dictionary in
 * `app/client/i18n` reads them from here rather than keeping a second copy
 * that could drift).
 */
const OUTCOME_WORDS: Record<VisitOutcome, { en: string; ar: string }> = {
  completed: { en: 'Completed', ar: 'تمت' },
  missed: { en: 'Missed', ar: 'فائتة' },
  cancelled: { en: 'Cancelled', ar: 'ملغاة' },
};

export function visitOutcomeWord(outcome: VisitOutcome, locale: 'en' | 'ar'): string {
  return OUTCOME_WORDS[outcome][locale];
}

/** What the split needs of a visit. A route hands whole rows; only these two are read. */
export type SplittableVisit = {
  /** The calendar day in the practice's time zone. */
  date: IsoDate;
  /** The instant the arrival window opens, for a stable order inside a day. */
  startsAt: string;
  status: AppointmentStatus;
};

export type VisitSplit<V> = { upcoming: V[]; past: V[] };

/**
 * Upcoming and past, as section 3.2 draws them.
 *
 * Upcoming is a status *and* a day: `confirmed` or `checked_in`, from the start
 * of today, soonest first. Past is a status alone: `completed`, `no_show`,
 * `cancelled` or `cancelled_late`, most recent first. A confirmed visit whose
 * day has gone by is in neither, on purpose — the practice has not yet said
 * whether it happened, and the portal does not guess on its behalf.
 */
export function visitsFor<V extends SplittableVisit>(
  appointments: readonly V[],
  today: IsoDate,
): VisitSplit<V> {
  const upcoming = appointments
    .filter((a) => (a.status === 'confirmed' || a.status === 'checked_in') && a.date >= today)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const past = appointments
    .filter((a) => visitOutcome(a.status) !== null)
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  return { upcoming, past };
}
