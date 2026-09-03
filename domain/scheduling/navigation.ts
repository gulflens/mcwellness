/**
 * The navigation hand-off (docs/SPEC/scheduling-manual.md section 8:
 * "Navigation handoff is a deep link, nothing more"). No key, no request, no
 * route drawn here — a URL built from a coordinate the practice has already
 * verified. Pure.
 */

export type GeoPoint = { lat: number; lng: number };

/** A place a practitioner drives to, as much of it as the hand-off needs. */
export type NavigableLocation = {
  /** Verified at enrolment; never null (db/migrations/030_location.sql). */
  entrancePoint: GeoPoint;
  /** Where the car goes, when somebody has recorded it. */
  parkingPoint: GeoPoint | null;
};

/**
 * Where to send the practitioner: the parking point when the practice has
 * one on file, the entrance otherwise (section 5.1, "Navigate (opens Google
 * Maps / Waze with parking point)"). Parking is where the journey by car
 * actually ends; the entrance is where it ends on foot, and is the honest
 * fallback for an address nobody has parked at yet.
 */
export function navigationTarget(location: NavigableLocation): GeoPoint {
  return location.parkingPoint ?? location.entrancePoint;
}

/**
 * A Google Maps directions link for a coordinate. Coordinates rather than a
 * written address on purpose: the coordinate is the thing the practice
 * verified, and a text address is what puts someone at the wrong villa in a
 * compound where every gate looks the same.
 */
export function directionsUrl(point: GeoPoint): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${point.lat},${point.lng}`;
}
