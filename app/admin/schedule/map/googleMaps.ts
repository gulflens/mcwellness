/**
 * Loading the Maps JavaScript API into the coordinator's browser
 * (docs/SPEC/route-planning.md section 4.6). One script per document, pinned
 * to a version channel, asking for nothing it does not draw.
 *
 * **The nonce is copied from the shell's own script tag.** The map document
 * is served with `'strict-dynamic'` and a per-response nonce (section 8), so
 * a tag without it is refused by the browser and nothing is said out loud.
 * Google's own loader does the same thing internally for what it injects.
 *
 * **The key is a browser key and is meant to be readable.** It is restricted
 * to this one product and to the practice's own address, which is what makes
 * it useless to anyone who lifts it off the page. The server key that prices
 * the drives is a different key and never leaves the API process.
 *
 * Nothing here is called by a test of the page: the page takes its loader as
 * a prop, so a test hands it a fake namespace and no test ever reaches the
 * network.
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

export function loadGoogleMaps(key: string, doc: Document = document): Promise<GoogleMaps> {
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
    script.src = `https://maps.googleapis.com/maps/api/js?${parameters.toString()}`;
    script.async = true;
    // Origin only, never the path: the key is restricted by referrer and a
    // request with none is refused (section 8.3).
    script.referrerPolicy = 'strict-origin-when-cross-origin';
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
