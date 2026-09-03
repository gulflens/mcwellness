/**
 * "Use my current position" (docs/SPEC/client-record.md section 4.2, item 4
 * of the task brief: no map library and no key exist on the web yet, so
 * verifying a pin is a plain form plus this one browser API). Never blocks:
 * a refusal or an unsupported browser resolves to `null` rather than
 * throwing, so the caller always has a plain fallback message to show.
 */
export type Position = { lat: number; lng: number };

export function requestCurrentPosition(): Promise<Position | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => resolve(null),
      { timeout: 10_000 },
    );
  });
}

/** A new tab to eyeball the point, never a map library or an API key. */
export function googleMapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}
