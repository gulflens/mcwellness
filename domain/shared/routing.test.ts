import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PEAK_MULTIPLIER,
  DEFAULT_ROAD_FACTOR,
  dayFingerprint,
  haversineMetres,
  hourBucket,
  isPeakHour,
  straightLineMatrix,
  straightLineSeconds,
} from './routing';

/**
 * The routing seam's own arithmetic (docs/SPEC/practitioner-phone.md sections
 * 5.1 and 5.6, rule 4). Pure: every clock is an argument and every figure is
 * passed in, so a fixed date and a fixed factor give a fixed answer.
 *
 * Coordinates only, and none of them is anybody's home: the two emirate
 * centres the seed itself uses (db/seed/generate.ts) and a pair one degree of
 * latitude apart, which is the textbook distance the haversine is checked
 * against.
 */

const ZONE = 'Asia/Dubai';
const DUBAI = { lat: 25.2, lng: 55.27 };
const ABU_DHABI = { lat: 24.45, lng: 54.38 };
const FACTORS = { roadFactor: DEFAULT_ROAD_FACTOR, peakMultiplier: DEFAULT_PEAK_MULTIPLIER };

/** 2026-09-07 is a Monday; the times below are Dubai's, which is UTC+4 all year. */
const MONDAY_0800 = new Date('2026-09-07T04:00:00Z');
const MONDAY_1300 = new Date('2026-09-07T09:00:00Z');
const MONDAY_1700 = new Date('2026-09-07T13:00:00Z');
const SATURDAY_0800 = new Date('2026-09-05T04:00:00Z');
const MONDAY_MIDNIGHT = new Date('2026-09-06T20:00:00Z');

describe('haversineMetres', () => {
  it('measures one degree of latitude as about 111 km', () => {
    const metres = haversineMetres({ lat: 25, lng: 55.27 }, { lat: 26, lng: 55.27 });
    expect(metres).toBeGreaterThan(111_100);
    expect(metres).toBeLessThan(111_300);
  });

  it('measures Dubai to Abu Dhabi as about 123 km', () => {
    const metres = haversineMetres(DUBAI, ABU_DHABI);
    expect(metres).toBeGreaterThan(122_000);
    expect(metres).toBeLessThan(123_500);
  });

  it('measures no distance at all between a point and itself', () => {
    expect(haversineMetres(DUBAI, DUBAI)).toBe(0);
  });

  it('measures the same distance in either direction', () => {
    expect(haversineMetres(DUBAI, ABU_DHABI)).toBeCloseTo(haversineMetres(ABU_DHABI, DUBAI), 6);
  });
});

describe('hourBucket', () => {
  it('reads the hour in the practice zone and never the process zone', () => {
    expect(hourBucket(MONDAY_0800, ZONE)).toBe(8);
    expect(hourBucket(MONDAY_0800, 'UTC')).toBe(4);
  });

  it('calls local midnight hour zero', () => {
    expect(hourBucket(MONDAY_MIDNIGHT, ZONE)).toBe(0);
  });
});

describe('isPeakHour', () => {
  it('is peak in the morning and the evening of a working day', () => {
    expect(isPeakHour(MONDAY_0800, ZONE)).toBe(true);
    expect(isPeakHour(MONDAY_1700, ZONE)).toBe(true);
  });

  it('is not peak in the middle of a working day', () => {
    expect(isPeakHour(MONDAY_1300, ZONE)).toBe(false);
  });

  it('is not peak at all at the weekend', () => {
    expect(isPeakHour(SATURDAY_0800, ZONE)).toBe(false);
  });

  it('closes the morning peak at ten and opens the evening one at four', () => {
    expect(isPeakHour(new Date('2026-09-07T05:59:00Z'), ZONE)).toBe(true); // 09:59
    expect(isPeakHour(new Date('2026-09-07T06:00:00Z'), ZONE)).toBe(false); // 10:00
    expect(isPeakHour(new Date('2026-09-07T11:59:00Z'), ZONE)).toBe(false); // 15:59
    expect(isPeakHour(new Date('2026-09-07T12:00:00Z'), ZONE)).toBe(true); // 16:00
  });
});

describe('straightLineSeconds', () => {
  it('turns the straight line into road metres with the road factor', () => {
    const { metres } = straightLineSeconds(DUBAI, ABU_DHABI, MONDAY_1300, FACTORS, ZONE);
    expect(metres).toBe(Math.round(haversineMetres(DUBAI, ABU_DHABI) * DEFAULT_ROAD_FACTOR));
  });

  it('costs the peak multiplier more in the peak than out of it', () => {
    const quiet = straightLineSeconds(DUBAI, ABU_DHABI, MONDAY_1300, FACTORS, ZONE);
    const busy = straightLineSeconds(DUBAI, ABU_DHABI, MONDAY_0800, FACTORS, ZONE);
    expect(busy.metres).toBe(quiet.metres);
    expect(busy.seconds).toBe(Math.round(quiet.seconds * DEFAULT_PEAK_MULTIPLIER));
  });

  it('reads the peak in the practice zone, not the process zone', () => {
    const dubai = straightLineSeconds(DUBAI, ABU_DHABI, MONDAY_0800, FACTORS, ZONE);
    const utc = straightLineSeconds(DUBAI, ABU_DHABI, MONDAY_0800, FACTORS, 'UTC');
    // 08:00 in Dubai is 04:00 in UTC: peak in one zone, quiet in the other.
    expect(dubai.seconds).toBeGreaterThan(utc.seconds);
  });

  it('answers nothing at all for a leg that goes nowhere', () => {
    expect(straightLineSeconds(DUBAI, DUBAI, MONDAY_1300, FACTORS, ZONE)).toEqual({
      seconds: 0,
      metres: 0,
    });
  });

  it('takes the factors it is given rather than holding figures of its own', () => {
    const gentle = straightLineSeconds(
      DUBAI,
      ABU_DHABI,
      MONDAY_1300,
      { roadFactor: 1, peakMultiplier: 1 },
      ZONE,
    );
    expect(gentle.metres).toBe(Math.round(haversineMetres(DUBAI, ABU_DHABI)));
  });
});

describe('straightLineMatrix', () => {
  it('answers one estimate per leg, in order, every one labelled an estimate', () => {
    const estimates = straightLineMatrix(
      [
        { from: DUBAI, to: ABU_DHABI, departAt: MONDAY_1300 },
        { from: ABU_DHABI, to: DUBAI, departAt: MONDAY_0800 },
      ],
      FACTORS,
      ZONE,
    );
    expect(estimates).toHaveLength(2);
    expect(estimates.every((estimate) => estimate.source === 'straight-line')).toBe(true);
    expect(estimates[1]?.seconds).toBeGreaterThan(estimates[0]?.seconds ?? 0);
  });

  it('answers nothing for no legs', () => {
    expect(straightLineMatrix([], FACTORS, ZONE)).toEqual([]);
  });
});

describe('dayFingerprint', () => {
  it('is the same for the same day asked for twice', () => {
    expect(dayFingerprint([DUBAI, ABU_DHABI])).toBe(dayFingerprint([DUBAI, ABU_DHABI]));
  });

  it('changes when the stops are reordered', () => {
    expect(dayFingerprint([DUBAI, ABU_DHABI])).not.toBe(dayFingerprint([ABU_DHABI, DUBAI]));
  });

  it('changes when a stop moves', () => {
    expect(dayFingerprint([DUBAI])).not.toBe(dayFingerprint([{ lat: 25.21, lng: 55.27 }]));
  });

  it('names an empty day rather than answering an empty string', () => {
    expect(dayFingerprint([])).toBe('empty');
  });
});
