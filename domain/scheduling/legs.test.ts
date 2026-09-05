import { describe, expect, it } from 'vitest';
import { dayLegs, dayPoints, type HomeBase, type LegStop } from './legs';

/**
 * The day's drives (docs/SPEC/practitioner-phone.md sections 5.2 and 7 rule
 * 3): the empty day, a single stop, a stop with no parking point, and the
 * ordering the day sheet renders.
 *
 * Every coordinate here is an emirate centre or a round number near one, as
 * db/seed/generate.ts uses; none is anybody's home.
 */

const STUDIO: HomeBase = {
  id: '00000000-0000-4000-8000-0000000000d0',
  entrancePoint: { lat: 25.2, lng: 55.27 },
  parkingPoint: null,
};

function stop(overrides: Partial<LegStop> & { id: string }): LegStop {
  return {
    windowStart: new Date('2026-09-07T05:00:00Z'),
    windowEnd: new Date('2026-09-07T05:45:00Z'),
    durationMinutes: 60,
    location: {
      id: '00000000-0000-4000-8000-0000000000d1',
      entrancePoint: { lat: 25.3, lng: 55.3 },
      parkingPoint: null,
    },
    ...overrides,
  };
}

const FIRST = stop({ id: '00000000-0000-4000-8000-000000001001' });
const SECOND = stop({
  id: '00000000-0000-4000-8000-000000001002',
  windowStart: new Date('2026-09-07T08:00:00Z'),
  windowEnd: new Date('2026-09-07T08:45:00Z'),
  location: {
    id: '00000000-0000-4000-8000-0000000000d2',
    entrancePoint: { lat: 25.35, lng: 55.4 },
    parkingPoint: { lat: 25.351, lng: 55.401 },
  },
});

describe('dayLegs', () => {
  it('has no legs at all on an empty day', () => {
    expect(dayLegs([], STUDIO)).toEqual([]);
    expect(dayLegs([], null)).toEqual([]);
  });

  it('drives from the home base to a single stop', () => {
    const legs = dayLegs([FIRST], STUDIO);
    expect(legs).toHaveLength(1);
    expect(legs[0]?.fromLocationId).toBe(STUDIO.id);
    expect(legs[0]?.toStopId).toBe(FIRST.id);
    expect(legs[0]?.departAt).toEqual(FIRST.windowStart);
  });

  it('has no leg to a single stop when the practice records no home base', () => {
    expect(dayLegs([FIRST], null)).toEqual([]);
  });

  it('leaves the previous stop at the end of its window plus the session', () => {
    const legs = dayLegs([FIRST, SECOND], null);
    expect(legs).toHaveLength(1);
    // 05:45Z plus sixty minutes.
    expect(legs[0]?.departAt.toISOString()).toBe('2026-09-07T06:45:00.000Z');
    expect(legs[0]?.fromLocationId).toBe(FIRST.location.id);
    expect(legs[0]?.toLocationId).toBe(SECOND.location.id);
  });

  it('drives to the parking point when there is one and the entrance when there is not', () => {
    const legs = dayLegs([FIRST, SECOND], null);
    expect(legs[0]?.from).toEqual(FIRST.location.entrancePoint);
    expect(legs[0]?.to).toEqual(SECOND.location.parkingPoint);
  });

  it('gives one leg per stop when there is a home base, and one fewer when there is not', () => {
    expect(dayLegs([FIRST, SECOND], STUDIO)).toHaveLength(2);
    expect(dayLegs([FIRST, SECOND], null)).toHaveLength(1);
  });

  it('never drives home at the end of the day', () => {
    const legs = dayLegs([FIRST, SECOND], STUDIO);
    expect(legs.map((leg) => leg.toStopId)).toEqual([FIRST.id, SECOND.id]);
    expect(legs.some((leg) => leg.toLocationId === STUDIO.id)).toBe(false);
  });

  it('still gives a leg between two visits at one address', () => {
    const sameAddress = stop({
      id: '00000000-0000-4000-8000-000000001003',
      location: FIRST.location,
    });
    const legs = dayLegs([FIRST, sameAddress], null);
    expect(legs).toHaveLength(1);
    expect(legs[0]?.from).toEqual(legs[0]?.to);
  });

  it('keeps the day sheet order it was given and never re-sorts it', () => {
    const legs = dayLegs([SECOND, FIRST], STUDIO);
    expect(legs.map((leg) => leg.toStopId)).toEqual([SECOND.id, FIRST.id]);
  });
});

describe('dayPoints', () => {
  it('puts the home base at the front and then every stop in order', () => {
    expect(dayPoints([FIRST, SECOND], STUDIO)).toEqual([
      STUDIO.entrancePoint,
      FIRST.location.entrancePoint,
      SECOND.location.parkingPoint,
    ]);
  });

  it('is the stops alone when the practice records no home base', () => {
    expect(dayPoints([FIRST], null)).toEqual([FIRST.location.entrancePoint]);
  });

  it('is nothing at all on an empty day with no home base', () => {
    expect(dayPoints([], null)).toEqual([]);
  });
});
