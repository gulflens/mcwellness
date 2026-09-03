import { describe, expect, it } from 'vitest';
import { directionsUrl, navigationTarget } from './navigation';

// Synthetic coordinates in Dubai, to two decimal places: a street, not a home
// (.claude/rules/testing.md — never a real address, even a plausible one).
const ENTRANCE = { lat: 25.2, lng: 55.27 };
const PARKING = { lat: 25.21, lng: 55.28 };

describe('navigationTarget', () => {
  it('sends the car to the parking point when there is one', () => {
    expect(navigationTarget({ entrancePoint: ENTRANCE, parkingPoint: PARKING })).toEqual(PARKING);
  });

  it('falls back to the entrance when nobody has recorded where to park', () => {
    expect(navigationTarget({ entrancePoint: ENTRANCE, parkingPoint: null })).toEqual(ENTRANCE);
  });
});

describe('directionsUrl', () => {
  it('builds a Google Maps directions link for the coordinate', () => {
    expect(directionsUrl(PARKING)).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=25.21,55.28',
    );
  });

  it('keeps a southern or western coordinate signed', () => {
    expect(directionsUrl({ lat: -33.87, lng: -70.66 })).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=-33.87,-70.66',
    );
  });
});
