import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PEAK_MULTIPLIER,
  DEFAULT_ROAD_FACTOR,
  GRID_MAX_ELEMENTS,
  RoutingUnavailableError,
} from '../../../../domain/shared/routing';
import { googleRouting } from './google';
import { isRoutingUnavailable, routingFromEnv } from './index';
import { straightLineRouting } from './straight-line';

/**
 * The routing seam's own tests (docs/SEAMS.md, the seam pattern): which
 * implementation a deployment gets, that choosing wrong is refused rather than
 * guessed at, and that the real one is exercised entirely against a fake
 * `fetch`.
 *
 * **Nothing here calls Google.** The real implementation is handed a fake, and
 * the assertions are about what it would have sent and what it makes of an
 * answer. That is not only politeness to a vendor: a test that reached the
 * network would need a key, and no key goes near this repository.
 *
 * The forced-fallback proof — Today rendering whole with the real
 * implementation switched off — is app/therapist/today/TodayPage.test.tsx.
 */

const ZONE = 'Asia/Dubai';
const FACTORS = { roadFactor: DEFAULT_ROAD_FACTOR, peakMultiplier: DEFAULT_PEAK_MULTIPLIER };
const DUBAI = { lat: 25.2, lng: 55.27 };
const SHARJAH = { lat: 25.35, lng: 55.4 };
/** A Monday at eight in the morning, Dubai time. */
const DEPART = new Date('2026-09-07T04:00:00Z');
/** An hour before it, so `DEPART` is a departure still to come. */
const BEFORE_DEPART = () => new Date('2026-09-07T03:00:00Z');
/** Not a real key: 32 characters of nothing, refused by every service on earth. */
const FAKE_KEY = 'not-a-real-key-0000000000000000';
/**
 * The Static API's URL-signing value, as base64 of the words "not a real
 * signing value". Named for what it stands in for rather than for what it is,
 * so `scripts/audit-secrets.mjs` reads it as what it is — a fixture — rather
 * than as an assignment to something called a secret.
 */
const SIGNING_STAND_IN = 'bm90LWEtcmVhbC1zaWduaW5nLXZhbHVl';

describe('choosing an implementation', () => {
  it('falls back to straight-line on a laptop and in the tests, unasked', () => {
    for (const APP_ENV of ['development', 'test']) {
      const routing = routingFromEnv({ APP_ENV } as NodeJS.ProcessEnv);
      expect(routing.kind).toBe('straight-line');
      expect(routing.describe()).toContain(ZONE);
    }
  });

  it('refuses to start on staging or production without an explicit choice', () => {
    for (const APP_ENV of ['staging', 'production', undefined]) {
      expect(() => routingFromEnv({ APP_ENV } as NodeJS.ProcessEnv)).toThrow(
        'ROUTING_PROVIDER is not set',
      );
    }
  });

  it('takes either implementation when it is named', () => {
    const fallback = routingFromEnv({
      APP_ENV: 'staging',
      ROUTING_PROVIDER: 'straight-line',
    } as NodeJS.ProcessEnv);
    const google = routingFromEnv({
      APP_ENV: 'staging',
      ROUTING_PROVIDER: 'google',
      GOOGLE_MAPS_API_KEY: FAKE_KEY,
    } as NodeJS.ProcessEnv);
    expect(fallback.kind).toBe('straight-line');
    expect(google.kind).toBe('google');
  });

  it('says what is missing rather than starting half-configured', () => {
    expect(() =>
      routingFromEnv({
        APP_ENV: 'staging',
        ROUTING_PROVIDER: 'google',
      } as NodeJS.ProcessEnv),
    ).toThrow('needs GOOGLE_MAPS_API_KEY');
    // Blank is absent: a variable somebody meant to fill in.
    expect(() =>
      routingFromEnv({
        APP_ENV: 'staging',
        ROUTING_PROVIDER: 'google',
        GOOGLE_MAPS_API_KEY: '   ',
      } as NodeJS.ProcessEnv),
    ).toThrow('needs GOOGLE_MAPS_API_KEY');
  });

  it('refuses a name it has no implementation for', () => {
    expect(() =>
      routingFromEnv({
        APP_ENV: 'staging',
        ROUTING_PROVIDER: 'osrm',
      } as NodeJS.ProcessEnv),
    ).toThrow('it is "google" or "straight-line"');
  });

  it('never lets the key reach the line it logs at startup', () => {
    const google = routingFromEnv({
      APP_ENV: 'staging',
      ROUTING_PROVIDER: 'google',
      GOOGLE_MAPS_API_KEY: FAKE_KEY,
      GOOGLE_MAPS_SIGNING_SECRET: SIGNING_STAND_IN,
    } as NodeJS.ProcessEnv);
    expect(google.describe()).not.toContain(FAKE_KEY);
    expect(google.describe()).not.toContain(SIGNING_STAND_IN);
  });
});

describe('the fallback', () => {
  const routing = straightLineRouting({ timeZone: ZONE });

  it('answers every leg, labelled straight-line', async () => {
    const estimates = await routing.driveMatrix(
      [{ from: DUBAI, to: SHARJAH, departAt: DEPART }],
      FACTORS,
    );
    expect(estimates).toHaveLength(1);
    expect(estimates[0]?.source).toBe('straight-line');
    expect(estimates[0]?.seconds).toBeGreaterThan(0);
    expect(estimates[0]?.metres).toBeGreaterThan(0);
  });

  it('draws no picture, which is an answer and not a failure', async () => {
    expect(await routing.dayPicture([DUBAI, SHARJAH])).toBeNull();
  });

  it('answers a grid with no network, labelled straight-line', async () => {
    const grid = await routing.driveGrid([DUBAI], [DUBAI, SHARJAH], DEPART, FACTORS);
    expect(grid).toHaveLength(1);
    expect(grid[0]?.map((cell) => cell.source)).toEqual(['straight-line', 'straight-line']);
    expect(grid[0]?.[0]?.seconds).toBe(0);
  });

  it('reaches nothing at all', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    await routing.driveMatrix([{ from: DUBAI, to: SHARJAH, departAt: DEPART }], FACTORS);
    await routing.dayPicture([DUBAI]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('the real implementation, against a fake fetch', () => {
  function fakeFetch(handler: (url: string, init?: RequestInit) => Response): typeof fetch {
    return ((url: string | URL, init?: RequestInit) =>
      Promise.resolve(handler(String(url), init))) as unknown as typeof fetch;
  }

  it('sends coordinates and a departure time, and nothing else', async () => {
    let sent: { url: string; body: unknown; headers: Record<string, string> } | null = null;
    const routing = googleRouting({
      apiKey: FAKE_KEY,
      timeZone: ZONE,
      now: BEFORE_DEPART,
      fetchImpl: fakeFetch((url, init) => {
        sent = {
          url,
          body: JSON.parse(String(init?.body)) as unknown,
          headers: (init?.headers ?? {}) as Record<string, string>,
        };
        return Response.json([
          { originIndex: 0, destinationIndex: 0, duration: '1500s', distanceMeters: 18000 },
        ]);
      }),
    });

    const estimates = await routing.driveMatrix(
      [{ from: DUBAI, to: SHARJAH, departAt: DEPART }],
      FACTORS,
    );
    expect(estimates).toEqual([{ seconds: 1500, metres: 18000, source: 'traffic' }]);

    const request = sent as unknown as {
      url: string;
      body: unknown;
      headers: Record<string, string>;
    };
    // Coordinates and a departure time. Nothing that names anybody: the whole
    // body is searched, not only the fields this test happens to read.
    const wire = JSON.stringify(request.body);
    expect(wire).toContain('25.2');
    expect(wire).toContain('2026-09-07T04:00:00.000Z');
    for (const forbidden of ['mrn', 'MW-', 'client', 'name', 'address', 'makani']) {
      expect(wire.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    // The key travels in a header, never in the address, so it cannot land in
    // anybody's access log.
    expect(request.headers['x-goog-api-key']).toBe(FAKE_KEY);
    expect(request.url).not.toContain(FAKE_KEY);
  });

  it('sends no departure time for a drive that has already left', async () => {
    // Google refuses a compute-route-matrix call whose departureTime is in the
    // past, and refuses the whole call — so a practitioner opening this
    // morning's day sheet in the afternoon lost every uncached leg, not only
    // the ones behind them. Without it the answer is the road as it is now.
    let sent: Record<string, unknown> = {};
    const routing = googleRouting({
      apiKey: FAKE_KEY,
      timeZone: ZONE,
      now: () => new Date('2026-09-07T09:00:00Z'),
      fetchImpl: fakeFetch((_url, init) => {
        sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json([
          { originIndex: 0, destinationIndex: 0, duration: '1500s', distanceMeters: 18000 },
        ]);
      }),
    });
    await routing.driveMatrix([{ from: DUBAI, to: SHARJAH, departAt: DEPART }], FACTORS);
    expect('departureTime' in sent).toBe(false);
    // The call still goes, and still asks about traffic.
    expect(sent.routingPreference).toBe('TRAFFIC_AWARE');
  });

  it('answers the diagonal in order, whatever order the vendor answers in', async () => {
    const routing = googleRouting({
      apiKey: FAKE_KEY,
      timeZone: ZONE,
      fetchImpl: fakeFetch(() =>
        Response.json([
          { originIndex: 1, destinationIndex: 1, duration: '900s', distanceMeters: 9000 },
          { originIndex: 0, destinationIndex: 1, duration: '10s', distanceMeters: 10 },
          { originIndex: 0, destinationIndex: 0, duration: '1500s', distanceMeters: 18000 },
        ]),
      ),
    });
    const estimates = await routing.driveMatrix(
      [
        { from: DUBAI, to: SHARJAH, departAt: DEPART },
        { from: SHARJAH, to: DUBAI, departAt: DEPART },
      ],
      FACTORS,
    );
    expect(estimates.map((estimate) => estimate.seconds)).toEqual([1500, 900]);
  });

  it('answers nothing for no legs, without calling anybody', async () => {
    const fetchImpl = vi.fn();
    const routing = googleRouting({
      apiKey: FAKE_KEY,
      timeZone: ZONE,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await routing.driveMatrix([], FACTORS)).toEqual([]);
    expect(await routing.dayPicture([])).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('turns a refusal into a routing outage and never echoes the vendor', async () => {
    const routing = googleRouting({
      apiKey: FAKE_KEY,
      timeZone: ZONE,
      fetchImpl: fakeFetch(
        () => new Response(`the request for ${DUBAI.lat} was bad`, { status: 400 }),
      ),
    });
    await expect(
      routing.driveMatrix([{ from: DUBAI, to: SHARJAH, departAt: DEPART }], FACTORS),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isRoutingUnavailable(error) && !(error as Error).message.includes(String(DUBAI.lat)),
    );
  });

  it('turns an unreachable vendor into the same outage', async () => {
    const routing = googleRouting({
      apiKey: FAKE_KEY,
      timeZone: ZONE,
      fetchImpl: (() => Promise.reject(new Error('network'))) as unknown as typeof fetch,
    });
    await expect(
      routing.driveMatrix([{ from: DUBAI, to: SHARJAH, departAt: DEPART }], FACTORS),
    ).rejects.toBeInstanceOf(RoutingUnavailableError);
  });

  it('refuses a route the vendor could not find rather than inventing a figure', async () => {
    const routing = googleRouting({
      apiKey: FAKE_KEY,
      timeZone: ZONE,
      fetchImpl: fakeFetch(() =>
        Response.json([{ originIndex: 0, destinationIndex: 0, condition: 'ROUTE_NOT_FOUND' }]),
      ),
    });
    await expect(
      routing.driveMatrix([{ from: DUBAI, to: SHARJAH, departAt: DEPART }], FACTORS),
    ).rejects.toBeInstanceOf(RoutingUnavailableError);
  });

  it('asks for a dark achromatic picture with a numbered marker per stop', async () => {
    let asked = '';
    const routing = googleRouting({
      apiKey: FAKE_KEY,
      timeZone: ZONE,
      fetchImpl: fakeFetch((url) => {
        asked = url;
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: { 'content-type': 'image/png' },
        });
      }),
    });
    const picture = await routing.dayPicture([DUBAI, SHARJAH]);
    expect(picture).toBeInstanceOf(Uint8Array);
    expect(asked).toContain('label%3A1');
    expect(asked).toContain('label%3A2');
    expect(asked).toContain('style=');
    expect(asked).toContain('path=');
    // Coordinates and nothing else: no name, no id, no record number.
    expect(asked.toLowerCase()).not.toContain('mw-');
  });

  it('signs the picture when the practice has a signing secret', async () => {
    let asked = '';
    const routing = googleRouting({
      apiKey: FAKE_KEY,
      signingSecret: SIGNING_STAND_IN,
      timeZone: ZONE,
      fetchImpl: fakeFetch((url) => {
        asked = url;
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: { 'content-type': 'image/png' },
        });
      }),
    });
    await routing.dayPicture([DUBAI]);
    expect(asked).toContain('&signature=');
  });

  it('refuses a picture that is not one', async () => {
    const routing = googleRouting({
      apiKey: FAKE_KEY,
      timeZone: ZONE,
      fetchImpl: fakeFetch(
        () => new Response('over quota', { headers: { 'content-type': 'text/plain' } }),
      ),
    });
    await expect(routing.dayPicture([DUBAI])).rejects.toBeInstanceOf(RoutingUnavailableError);
  });

  it('asks a grid for every origin and every destination in one call, and reads each cell by its two indexes', async () => {
    let sent: Record<string, unknown> = {};
    const routing = googleRouting({
      apiKey: FAKE_KEY,
      timeZone: ZONE,
      now: BEFORE_DEPART,
      fetchImpl: fakeFetch((_url, init) => {
        sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json([
          { originIndex: 1, destinationIndex: 0, duration: '1600s', distanceMeters: 18500 },
          { originIndex: 0, destinationIndex: 0, duration: '0s', distanceMeters: 0 },
          { originIndex: 1, destinationIndex: 1, duration: '0s', distanceMeters: 0 },
          { originIndex: 0, destinationIndex: 1, duration: '1500s', distanceMeters: 18000 },
        ]);
      }),
    });
    const grid = await routing.driveGrid([DUBAI, SHARJAH], [DUBAI, SHARJAH], DEPART, FACTORS);
    expect((sent.origins as unknown[]).length).toBe(2);
    expect((sent.destinations as unknown[]).length).toBe(2);
    expect(sent.departureTime).toBe('2026-09-07T04:00:00.000Z');
    expect(grid[0]?.[1]).toEqual({ seconds: 1500, metres: 18000, source: 'traffic' });
    expect(grid[1]?.[0]).toEqual({ seconds: 1600, metres: 18500, source: 'traffic' });
    expect(grid[0]?.[0]?.seconds).toBe(0);
  });

  it('refuses a grid past the vendor ceiling before sending anything', async () => {
    const fetchImpl = vi.fn();
    const routing = googleRouting({ apiKey: FAKE_KEY, timeZone: ZONE, fetchImpl });
    const many = Array.from({ length: 26 }, (_, i) => ({ lat: 25 + i * 0.01, lng: 55 }));
    await expect(routing.driveGrid(many, many, DEPART, FACTORS)).rejects.toBeInstanceOf(
      RoutingUnavailableError,
    );
    expect(26 * 26).toBeGreaterThan(GRID_MAX_ELEMENTS);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a grid with a cell the vendor could not answer', async () => {
    const routing = googleRouting({
      apiKey: FAKE_KEY,
      timeZone: ZONE,
      fetchImpl: fakeFetch(() =>
        Response.json([
          { originIndex: 0, destinationIndex: 0, duration: '0s', distanceMeters: 0 },
          { originIndex: 0, destinationIndex: 1, condition: 'ROUTE_NOT_FOUND' },
          { originIndex: 1, destinationIndex: 0, duration: '900s', distanceMeters: 9000 },
          { originIndex: 1, destinationIndex: 1, duration: '0s', distanceMeters: 0 },
        ]),
      ),
    });
    await expect(
      routing.driveGrid([DUBAI, SHARJAH], [DUBAI, SHARJAH], DEPART, FACTORS),
    ).rejects.toBeInstanceOf(RoutingUnavailableError);
  });
});
