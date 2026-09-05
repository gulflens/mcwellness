import { createHmac } from 'node:crypto';
import {
  RoutingUnavailableError,
  type DriveEstimate,
  type DriveLeg,
  type GeoPoint,
  type RoutingProvider,
} from '../../../../domain/shared/routing';

/**
 * The real implementation behind the routing seam (docs/SEAMS.md,
 * docs/SPEC/practitioner-phone.md section 5.1): Google Maps Platform's
 * **Routes API compute route matrix** for the estimates and the **Maps Static
 * API** for the day's picture, both under one server key restricted to those
 * two products (decision 3).
 *
 * **What leaves this process is coordinates and a departure time**, and
 * nothing else. Never a name, a record number, an address, a Makani number or
 * an id — `docs/COMPLIANCE/approved-vendors.md` approves exactly that, and
 * every request built below is built from two `GeoPoint`s and a `Date`.
 *
 * **The key never leaves this process either.** It is a server key
 * (`GOOGLE_MAPS_API_KEY`), it is never named in a log line or an error
 * message, and no picture reaches a phone from Google: the browser fetches
 * this API's own route, which is why the content security policy is untouched
 * (spec section 3.6 and decision 2).
 *
 * The REST endpoints are called directly rather than through a client library,
 * for the reason the storage seam gives: this is two calls, and the failure of
 * each is ours to translate. Anything but a clean answer becomes
 * `RoutingUnavailableError`, which the routes answer as a plain refusal rather
 * than an internal error in the day sheet.
 */

const ROUTE_MATRIX_URL = 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';
const STATIC_MAP_URL = 'https://maps.googleapis.com/maps/api/staticmap';
const DEFAULT_TIMEOUT_MS = 8_000;

/**
 * Google's own ceiling on one compute-route-matrix call is 625 elements, and a
 * practitioner's day is six stops. This is a guard against a caller with a
 * malformed day rather than a real limit, and going over it is refused here
 * rather than paid for.
 */
const MAX_LEGS = 25;

/**
 * The day's picture, as section 5.3 describes it: dark, achromatic, 640 by 400
 * at scale 2, numbered markers in stop order and a hairline path between them.
 *
 * The style parameters are Google's own vocabulary for a basemap and are the
 * one place in this repository where colours are written outside
 * `app/shell/tokens.css` — they are not CSS, they cannot read a custom
 * property, and they are a vendor's request format rather than the app's own
 * chrome. They are copied from the practitioner ground's ink and paper, and if
 * those tokens change these change with them.
 */
const PICTURE_WIDTH = 640;
const PICTURE_HEIGHT = 400;
const PICTURE_SCALE = 2;
const MAP_STYLE: readonly string[] = [
  // --paper on the dark ground.
  'feature:all|element:geometry|color:0x10191d',
  // --ink-2, so a road reads without shouting.
  'feature:road|element:geometry|color:0x2b3b41',
  'feature:all|element:labels.text.fill|color:0x8fa0a6',
  'feature:all|element:labels.text.stroke|color:0x10191d',
  'feature:poi|element:all|visibility:off',
  'feature:transit|element:all|visibility:off',
  'feature:administrative|element:geometry|visibility:off',
  'feature:water|element:geometry|color:0x16242a',
];

export type GoogleRoutingOptions = {
  /** GOOGLE_MAPS_API_KEY: a server key, restricted to the two products above. */
  apiKey: string;
  /**
   * GOOGLE_MAPS_SIGNING_SECRET, when the practice has one. The Static API
   * accepts an unsigned request under a key; a signed one is what a project
   * with a URL-signing secret configured requires.
   */
  signingSecret?: string;
  /** The practice's own zone. Carried for the startup line only; no time is sent. */
  timeZone: string;
  /** Tests inject a fetch; the server uses the runtime's own. Never a real call in a test. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** The clock, so a test can say what "already left" means. */
  now?: () => Date;
};

type MatrixElement = {
  originIndex?: number;
  destinationIndex?: number;
  duration?: string;
  distanceMeters?: number;
  condition?: string;
};

/** "1234s" is how the Routes API writes a duration. Anything else is no answer. */
function secondsFrom(duration: string | undefined): number | null {
  if (typeof duration !== 'string') return null;
  const match = /^(\d+(?:\.\d+)?)s$/.exec(duration);
  if (!match?.[1]) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? Math.round(seconds) : null;
}

/** The URL-signing scheme the Static API uses: an HMAC over the path and query. */
function signedPath(path: string, secret: string): string {
  const key = Buffer.from(secret.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const signature = createHmac('sha1', key)
    .update(path)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${path}&signature=${signature}`;
}

export function googleRouting(options: GoogleRoutingOptions): RoutingProvider {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());

  /** One call. A vendor's own message never reaches a caller; only its status is kept. */
  async function call(url: string, init?: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await doFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (cause) {
      throw new RoutingUnavailableError('The routing vendor could not be reached.', { cause });
    }
    if (!response.ok) {
      // The status and nothing else: a body from Google can echo the request,
      // and the request carries coordinates.
      throw new RoutingUnavailableError(`The routing vendor answered ${response.status}.`);
    }
    return response;
  }

  return {
    kind: 'google',
    describe: () =>
      `Google Maps Platform drive estimates and day picture in ${options.timeZone}` +
      `${options.signingSecret ? ', with a signed static map' : ''}`,

    async driveMatrix(legs: readonly DriveLeg[]): Promise<DriveEstimate[]> {
      if (legs.length === 0) return [];
      if (legs.length > MAX_LEGS) {
        throw new RoutingUnavailableError('That is more legs than one day can have.');
      }
      // One origin and one destination per leg, paired by index: the matrix is
      // asked for the diagonal and nothing else, so a day of six stops is six
      // elements rather than thirty-six. departureTime is per request, and
      // app/api/routing/day.ts sends one call per hour bucket, so every leg in
      // a call leaves in the same hour and the first leg's departure stands
      // for it honestly.
      //
      // **And it is omitted when it has already gone.** Google refuses a
      // compute-route-matrix call whose departureTime is in the past, and it
      // refuses the whole call — so a practitioner opening this morning's day
      // sheet in the afternoon lost every uncached leg, not just the ones
      // behind them. Without it the answer is the road as it is now, which is
      // the honest thing to say about a drive that has already happened.
      const departAt = legs[0]?.departAt;
      const inFuture = departAt !== undefined && departAt.getTime() > now().getTime();
      const body = {
        origins: legs.map((leg) => ({
          waypoint: { location: { latLng: { latitude: leg.from.lat, longitude: leg.from.lng } } },
          routeModifiers: { avoidFerries: true },
        })),
        destinations: legs.map((leg) => ({
          waypoint: { location: { latLng: { latitude: leg.to.lat, longitude: leg.to.lng } } },
        })),
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
        ...(inFuture && departAt ? { departureTime: departAt.toISOString() } : {}),
      };
      const response = await call(ROUTE_MATRIX_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': options.apiKey,
          // Ask for the three fields that are used and no others: a field mask
          // is what stops a vendor answering with more than was wanted.
          'x-goog-fieldmask': 'originIndex,destinationIndex,duration,distanceMeters,condition',
        },
        body: JSON.stringify(body),
      });
      let elements: MatrixElement[];
      try {
        elements = (await response.json()) as MatrixElement[];
      } catch (cause) {
        throw new RoutingUnavailableError('The routing vendor answered something else.', {
          cause,
        });
      }
      if (!Array.isArray(elements)) {
        throw new RoutingUnavailableError('The routing vendor answered something else.');
      }
      // The matrix answers out of order and answers every pair; only the
      // diagonal is this call's business.
      const answers = new Map<number, MatrixElement>();
      for (const element of elements) {
        if (element.originIndex === element.destinationIndex && element.originIndex !== undefined) {
          answers.set(element.originIndex, element);
        }
      }
      return legs.map((_, index) => {
        const element = answers.get(index);
        const seconds = secondsFrom(element?.duration);
        if (seconds === null || element?.condition === 'ROUTE_NOT_FOUND') {
          throw new RoutingUnavailableError('The routing vendor found no route for a stop.');
        }
        return {
          seconds,
          metres: Math.max(0, Math.round(element?.distanceMeters ?? 0)),
          source: 'traffic',
        };
      });
    },

    async dayPicture(points: readonly GeoPoint[]): Promise<Uint8Array | null> {
      if (points.length === 0) return null;
      const round = (value: number): string => value.toFixed(6);
      const parameters = new URLSearchParams();
      parameters.set('size', `${PICTURE_WIDTH}x${PICTURE_HEIGHT}`);
      parameters.set('scale', String(PICTURE_SCALE));
      parameters.set('maptype', 'roadmap');
      parameters.set('format', 'png');
      for (const [index, point] of points.entries()) {
        parameters.append(
          'markers',
          `size:small|label:${index + 1}|${round(point.lat)},${round(point.lng)}`,
        );
      }
      if (points.length > 1) {
        parameters.append(
          'path',
          `weight:1|color:0x8fa0a6ff|${points
            .map((point) => `${round(point.lat)},${round(point.lng)}`)
            .join('|')}`,
        );
      }
      for (const style of MAP_STYLE) parameters.append('style', style);
      parameters.set('key', options.apiKey);

      const path = `/maps/api/staticmap?${parameters.toString()}`;
      const url = options.signingSecret
        ? `https://maps.googleapis.com${signedPath(path, options.signingSecret)}`
        : `${STATIC_MAP_URL}?${parameters.toString()}`;
      const response = await call(url);
      const type = response.headers.get('content-type') ?? '';
      if (!type.startsWith('image/')) {
        // An error from the Static API arrives as a PNG of the words, or as
        // text. Neither is a map, and neither is put in front of anybody.
        throw new RoutingUnavailableError('The routing vendor answered no picture.');
      }
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}
