import type { SharedHelperPosition, SharedPosition } from '../../../api/location/schema';

/**
 * How the board says where a practitioner is sharing from (docs/SPEC/
 * dispatch.md section 15). The position itself is drawn on the day map; the
 * board says how old it is, and says "Not sharing now" rather than pretending to
 * know where somebody is who is not sharing (docs/PLAN/dispatch.md).
 */

/** "just now", "4 min ago", "2 h 5 min ago". */
export function describeAge(minutes: number): string {
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h ago` : `${hours} h ${rest} min ago`;
}

/** The line under a practitioner's name on the board. */
export function describePosition(
  position: Pick<SharedPosition, 'ageMinutes' | 'accuracyMetres'> | undefined,
): string {
  // Switched off, or switched on outside their working day: either way
  // nothing is being shared now, and the board cannot tell which (it reads
  // no one's switch), so it says only what is true of both.
  if (position === undefined) return 'Not sharing now';
  return `Location shared ${describeAge(position.ageMinutes)}, within ${Math.round(position.accuracyMetres)} m`;
}

/**
 * A helper's line, under the practitioner they accompany (section 15.12):
 * marked as a helper's and named by first name, so nobody reads it as the
 * practitioner's own position.
 */
export function describeHelperPosition(
  helper: Pick<SharedHelperPosition, 'firstName' | 'ageMinutes' | 'accuracyMetres'>,
): string {
  return `Helper ${helper.firstName}: location shared ${describeAge(helper.ageMinutes)}, within ${Math.round(helper.accuracyMetres)} m`;
}

/** The same helper's pin on the day map. */
export function helperMapLabel(
  helper: Pick<SharedHelperPosition, 'firstName' | 'ageMinutes'>,
): string {
  return `Helper ${helper.firstName}, last shared ${describeAge(helper.ageMinutes)}`;
}
