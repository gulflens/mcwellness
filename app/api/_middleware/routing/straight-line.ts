import {
  straightLineGrid,
  straightLineMatrix,
  type DriveEstimate,
  type DriveFactors,
  type DriveLeg,
  type RoutingProvider,
} from '../../../../domain/shared/routing';

/**
 * The routing seam's deterministic fallback (docs/SEAMS.md): straight-line
 * distance times the practice's road factor, at an average speed, times the
 * peak multiplier when the departure falls in one of the two rush hours of a
 * working day.
 *
 * It reaches nothing. No key, no network, no vendor — which is what lets the
 * whole suite run on a laptop with no accounts and what the day sheet falls
 * back to when the practice has not supplied a key.
 *
 * **It draws no picture, and that is an answer.** `dayPicture` returns null,
 * and the screen says the map needs the practice's key rather than showing an
 * empty frame (docs/SPEC/practitioner-phone.md section 5.3).
 *
 * The two figures are not constants here: they arrive per call from
 * `scheduling_setting` (migration 204), which is what "the fallback's figures
 * are data, not code" means. The defaults live beside the arithmetic in
 * `domain/shared/routing.ts` and are what a practice starts with.
 */

export type StraightLineOptions = {
  /** The practice's own zone, which decides what counts as a peak hour. */
  timeZone: string;
};

export function straightLineRouting(options: StraightLineOptions): RoutingProvider {
  return {
    kind: 'straight-line',
    describe: () => `Straight-line drive estimates in ${options.timeZone}, with no map`,
    driveMatrix: (legs: readonly DriveLeg[], factors: DriveFactors): Promise<DriveEstimate[]> =>
      Promise.resolve(straightLineMatrix(legs, factors, options.timeZone)),
    driveGrid: (origins, destinations, departAt, factors) =>
      Promise.resolve(straightLineGrid(origins, destinations, departAt, factors, options.timeZone)),
    dayPicture: () => Promise.resolve(null),
  };
}
