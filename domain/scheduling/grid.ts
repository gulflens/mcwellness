/**
 * The next quarter hour at or after `at` (docs/SPEC/route-planning.md 5.4).
 * Asia/Dubai has a whole-hour offset and no daylight saving, so a quarter
 * hour in the practice's zone is a quarter hour in UTC: plain arithmetic,
 * no calendar. Pure.
 */
const QUARTER_MS = 15 * 60_000;

export function ceilToQuarterHour(at: Date): Date {
  return new Date(Math.ceil(at.getTime() / QUARTER_MS) * QUARTER_MS);
}
