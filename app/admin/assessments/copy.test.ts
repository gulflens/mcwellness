import { BAND_NAMES, BANDS, UNIT_NAMES } from '@domain/shared';
import { describe, expect, it } from 'vitest';
import { BAND_LABELS, UNIT_SHORT } from './copy';

/**
 * The console's own words for a band and a unit are `domain/shared`'s, taken
 * rather than typed.
 *
 * The five band names used to exist twice in English, here and in
 * `app/api/reports/gather.ts`, and neither copy had an Arabic half
 * (`docs/CHANGE-REQUESTS/qa-01.md`). The trunk's round 34 gave them one home.
 * What this proves is that the home is genuinely the only one: a band renamed
 * in `domain/shared/bands.ts` is renamed on this screen, and a band renamed
 * here fails.
 */

describe('the words the Assessments tab says', () => {
  it('names every band, and only the five', () => {
    expect(Object.keys(BAND_LABELS)).toEqual([...BANDS]);
  });

  it('takes each band’s word from the shared vocabulary rather than holding its own', () => {
    for (const band of BANDS) {
      expect(BAND_LABELS[band]).toBe(BAND_NAMES[band].en);
    }
  });

  it('is the English half, because the console is English', () => {
    // The Arabic half exists and is not what this screen renders: a report a
    // household reads is where it is printed (`labelAr`,
    // app/api/reports/gather.ts).
    for (const band of BANDS) {
      expect(BAND_LABELS[band]).not.toBe(BAND_NAMES[band].ar);
    }
  });

  it('takes the short unit names from the same place', () => {
    expect(UNIT_SHORT).toBe(UNIT_NAMES);
  });
});
