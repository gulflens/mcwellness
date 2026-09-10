import { describe, expect, it } from 'vitest';
import { DEFAULT_PEAK_MULTIPLIER, DEFAULT_ROAD_FACTOR } from '../../domain/shared/routing';
import { straightLineRouting } from '../../app/api/_middleware/routing';
import type { Db } from '../../app/api/_middleware/request-context';
import { fillMatrix, type Place } from '../../app/api/routing/estimates';

/**
 * The drive matrix and the one question it refuses to answer
 * (docs/CHANGE-REQUESTS/dispatch-01.md item 9).
 *
 * The matrix is total over the places it was handed: an hour it was not
 * priced for is answered with the nearest hour it was, and a pair of known
 * places the vendor could not answer is answered with the practice's own
 * straight-line arithmetic. A place it was never given is none of those — it
 * is a caller that asked about a door it did not declare, and a drive of zero
 * seconds would make a visit nobody can reach look comfortably on time.
 *
 * No database and no vendor: the cache answers nothing and swallows every
 * write, and the seam is the deterministic fallback (docs/SEAMS.md). Ids in
 * this file's own 74xx block of the dispatch range.
 */

const HOME = '00000000-0000-4000-8000-000000007401';
const STUDIO = '00000000-0000-4000-8000-000000007402';
/** A well-shaped id the matrix is never told about. */
const UNDECLARED = '00000000-0000-4000-8000-000000007403';

const PLACES: Place[] = [
  { locationId: HOME, point: { lat: 25.2, lng: 55.27 } },
  { locationId: STUDIO, point: { lat: 25.3, lng: 55.4 } },
];

const DATE = '2026-09-04';
const DEPART_AT = new Date(`${DATE}T09:30:00+04:00`);

const FACTORS = { roadFactor: DEFAULT_ROAD_FACTOR, peakMultiplier: DEFAULT_PEAK_MULTIPLIER };

/** A cache holding nothing, which writes back into nothing. */
const noCache = {
  query: () => Promise.resolve({ rows: [] }),
} as unknown as Db;

function build(places: readonly Place[]) {
  return fillMatrix(
    noCache,
    places,
    [9],
    DATE,
    FACTORS,
    straightLineRouting({ timeZone: 'Asia/Dubai' }),
    HOME,
  );
}

describe('fillMatrix', () => {
  it('answers a pair of places it was given', async () => {
    const drive = await build(PLACES);
    expect(drive(HOME, STUDIO, DEPART_AT).seconds).toBeGreaterThan(0);
    expect(drive(HOME, HOME, DEPART_AT).seconds).toBe(0);
  });

  it('throws, naming the place, when it is asked about one it was never given', () => {
    // Not a zero: a caller that asks about a door it did not declare has a
    // bug, and the honest answer is to say so rather than to price the drive
    // at nothing and let a late visit read as on time.
    return build(PLACES).then((drive) => {
      expect(() => drive(HOME, UNDECLARED, DEPART_AT)).toThrow(UNDECLARED);
      expect(() => drive(UNDECLARED, STUDIO, DEPART_AT)).toThrow(UNDECLARED);
      // And it still answers the pair it does know.
      expect(drive(STUDIO, HOME, DEPART_AT).seconds).toBeGreaterThan(0);
    });
  });
});
