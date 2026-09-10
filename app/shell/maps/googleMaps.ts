/**
 * Loading the Maps JavaScript API into the coordinator's browser
 * (docs/SPEC/route-planning.md section 4.6). One script per document, pinned
 * to a version channel, asking for nothing it does not draw.
 *
 * **What actually lets this script run is `'strict-dynamic'`, not the nonce
 * copied below.** The map document is served with `'strict-dynamic'` and a
 * per-response nonce (section 8), and `'strict-dynamic'` trusts whatever a
 * trusted script injects — this module is loaded by a nonced tag, so the tag
 * it appends is trusted onwards whether or not it carries a nonce of its own.
 * The copy is kept because it is harmless and because it is what makes the
 * local development server work, where no policy is enforced at all.
 *
 * **And in production the copy does nothing at all.** When a document's
 * policy arrives in a **header**, the browser empties the
 * `nonce` content attribute on insertion and keeps the value only in the
 * element's internal slot, reachable as the `.nonce` property — so the
 * `getAttribute('nonce')` read below returns `""` and nothing is copied.
 * Production always has a header-delivered policy: Hostinger's
 * `upgrade-insecure-requests` today, and this app's own on the day the edge
 * stops replacing it (the review of pull request 129, finding F3). The
 * presence check in DayMapPage still works, because the attribute is emptied
 * and not removed.
 *
 * **The key is a browser key and is meant to be readable.** It is restricted
 * to this one product and to the practice's own address, which is what makes
 * it useless to anyone who lifts it off the page. The server key that prices
 * the drives is a different key and never leaves the API process.
 *
 * Nothing here is called by a test of the page: the page takes its loader as
 * a prop, so a test hands it a fake namespace and no test ever reaches the
 * network.
 *
 * Since trunk round 43 this lives in the shell: the day map and the pin
 * picker (`app/admin/clients/pin/PinPickerPage.tsx`) both load it, which is
 * the ownership map's rule for a thing two modules share.
 */

export type GoogleMaps = typeof google.maps;

/** The quarterly channel: a version that moves four times a year, not weekly. */
export const MAPS_VERSION = 'quarterly';
const CALLBACK = '__mcwellnessGoogleMapsReady';
const TIMEOUT_MS = 8_000;

/** The browser key this build was made with, or null when the practice has none. */
export function browserMapKey(): string | null {
  const key = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY;
  return typeof key === 'string' && key.trim() !== '' ? key.trim() : null;
}

let pending: Promise<GoogleMaps> | null = null;

/** For the tests only: forgets the one script this module remembers adding. */
export function resetGoogleMapsLoader(): void {
  pending = null;
}

export function loadGoogleMaps(
  key: string,
  options: { libraries?: readonly 'places'[]; doc?: Document } = {},
): Promise<GoogleMaps> {
  const doc = options.doc ?? document;
  if (pending !== null) return pending;
  const already = (window as unknown as { google?: { maps?: GoogleMaps } }).google?.maps;
  if (already) {
    pending = Promise.resolve(already);
    return pending;
  }
  pending = new Promise<GoogleMaps>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('The map did not load.'));
    }, TIMEOUT_MS);
    const finish = (): void => {
      clearTimeout(timer);
      const maps = (window as unknown as { google?: { maps?: GoogleMaps } }).google?.maps;
      if (maps) resolve(maps);
      else reject(new Error('The map did not load.'));
    };
    (window as unknown as Record<string, () => void>)[CALLBACK] = finish;

    const script = doc.createElement('script');
    const parameters = new URLSearchParams({
      key,
      v: MAPS_VERSION,
      loading: 'async',
      callback: CALLBACK,
      language: 'en',
      region: 'AE',
    });
    // Only the pin picker asks for a library, and only for one: the day map
    // draws its own pins and needs nothing beyond the map
    // (docs/SPEC/route-planning.md section 4.6).
    if (options.libraries && options.libraries.length > 0) {
      parameters.set('libraries', options.libraries.join(','));
    }
    script.src = `https://maps.googleapis.com/maps/api/js?${parameters.toString()}`;
    script.async = true;
    // Origin only, never the path: the key is restricted by referrer and a
    // request with none is refused (section 8.3).
    script.referrerPolicy = 'strict-origin-when-cross-origin';
    // Empty in production, where the policy arrives in a header; the load
    // rests on `'strict-dynamic'` either way. See the note at the top.
    const nonce = doc.querySelector('script[nonce]')?.getAttribute('nonce');
    if (nonce) script.setAttribute('nonce', nonce);
    script.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('The map could not be loaded.'));
    });
    doc.head.append(script);
  });
  return pending;
}
