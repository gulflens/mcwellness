/**
 * The travel buffer after a visit (docs/SPEC/scheduling-manual.md rule 6.2):
 * the estimated drive to whatever comes next, in whole minutes rounded up,
 * plus ten, never under fifteen and never over ninety — the same bounds
 * `appointment_travel_buffer_range` keeps in the database. Pure.
 */
export const MIN_TRAVEL_BUFFER_MINUTES = 15;
export const MAX_TRAVEL_BUFFER_MINUTES = 90;
export const BUFFER_ALLOWANCE_MINUTES = 10;

export function travelBufferFor(driveSeconds: number): number {
  const minutes = Math.ceil(Math.max(0, driveSeconds) / 60) + BUFFER_ALLOWANCE_MINUTES;
  return Math.min(MAX_TRAVEL_BUFFER_MINUTES, Math.max(MIN_TRAVEL_BUFFER_MINUTES, minutes));
}
