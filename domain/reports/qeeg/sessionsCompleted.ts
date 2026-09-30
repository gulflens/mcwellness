/**
 * The number of sessions a follow-up says were completed since the report it
 * is compared with (docs/SPEC/reports-qeeg.md section 10, the last paragraph:
 * "Sessions completed are counted from the client's visits, and may be typed
 * when some were elsewhere. The figure says which.").
 *
 * **Counted, and between the two recordings.** A visit counts when it is this
 * client's, completed and closed, and fell on a day strictly after the earlier
 * report's recording and strictly before the new one's. Neither recording day
 * is counted, because a recording day's visit is the brain map itself, not a
 * session of the programme between the two; a session held on either day is
 * one she types, and the figure then says so. While the new recording has no
 * day yet, the count runs to today, today included, and it is worked out
 * again at every save, so it closes on the day once she gives it. A voided
 * visit was logged in error and never happened; one not completed (a no-show,
 * a late cancellation, one stopped part way) is not a session completed; one
 * still open is not finished. The day of a visit is the practice's day of its
 * check-in, which the caller works out.
 *
 * **What the server works out is never taken from a request** (section 4,
 * rule 11). A figure said to be counted is counted again on every save,
 * whatever number it carried (`sessionsCompletedOnSave`); only one marked
 * typed is kept from the caller. A count of none, or more than a figure may
 * hold, is no figure: the headline is left off the page, and she may type one.
 *
 * Pure: no clock (`today` is handed in), no I/O. It changes nothing it is
 * given.
 */

import { isSessionCount } from './shape';
import { isRealDay, isRecord } from './text';

/** One of the client's visits, as far as this rule is concerned. */
export type VisitForCount = {
  readonly clientId: string;
  /** The session's status as the database holds it (`voided` included). */
  readonly status: string;
  /** Whether the visit was closed. */
  readonly closed: boolean;
  /** The practice's day of its check-in, `YYYY-MM-DD`. */
  readonly day: string;
};

/**
 * The days a count runs between. `after` and `before` are left out; `through`
 * is taken in, and is set only when the new recording has no day.
 */
export type SessionWindow = {
  readonly after: string;
  readonly before: string | null;
  readonly through: string | null;
};

export function sessionWindow(
  earlierDay: string,
  laterDay: string | null,
  today: string,
): SessionWindow {
  return laterDay !== null && isRealDay(laterDay)
    ? { after: earlierDay, before: laterDay, through: null }
    : { after: earlierDay, before: null, through: today };
}

function inWindow(day: string, window: SessionWindow): boolean {
  if (!isRealDay(day) || day <= window.after) return false;
  if (window.before !== null) return day < window.before;
  return window.through !== null && day <= window.through;
}

export function countCompletedSessions(
  visits: readonly VisitForCount[],
  clientId: string,
  window: SessionWindow,
): number {
  return visits.filter(
    (visit) =>
      visit.clientId === clientId &&
      visit.status === 'completed' &&
      visit.closed &&
      inWindow(visit.day, window),
  ).length;
}

export type CountedFigure = { readonly count: number; readonly source: 'gathered' };

/** The count as the figure a follow-up holds, or none. */
export function countedFigure(count: number | null): CountedFigure | null {
  return isSessionCount(count) ? { count, source: 'gathered' } : null;
}

/**
 * What a save writes for the sessions completed, from what the request sent
 * and what the server counted. Counted is counted again; typed and none are
 * hers; anything else goes on as it came, for the shape to refuse by name.
 */
export function sessionsCompletedOnSave(sent: unknown, counted: number | null): unknown {
  if (isRecord(sent) && Object.hasOwn(sent, 'source') && sent['source'] === 'gathered') {
    return countedFigure(counted);
  }
  return isRecord(sent) ? { ...sent } : sent;
}
