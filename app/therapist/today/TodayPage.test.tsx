// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../../shell/auth/AuthContext';
import type { AuthProvider } from '../../shell/auth/types';
import type { DayLegRow } from '../../api/routing/schema';
import { TodayPage, describeLeg, wantsInstallNote } from './TodayPage';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

/**
 * The day sheet's own drives and picture (docs/SPEC/practitioner-phone.md
 * sections 5.4 and 3.3), and **the forced-fallback proof section 13 asks for**:
 * with `ROUTING_PROVIDER=straight-line` the route answers no picture and
 * `straight-line` legs, and this screen renders every stop, every leg says
 * "straight-line estimate", and the picture's place says the map needs the
 * practice's key.
 *
 * Every id, name and coordinate is synthetic and inside the reserved ranges
 * (.claude/rules/testing.md); the coordinates are emirate centres, as the seed
 * itself uses.
 */

const ME = {
  userId: '00000002-0000-4000-8000-000000000009',
  displayName: 'Rowan Meadow',
  tenantId: '00000001-0000-4000-8000-000000000001',
  roles: ['practitioner'],
  capabilities: [],
};

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => 'token',
  onChange: () => () => undefined,
};

const STOP_A = '00000007-0000-4000-8000-000000000001';
const STOP_B = '00000007-0000-4000-8000-000000000002';

function stop(id: string, hour: string, clientId: string, given: string) {
  return {
    id,
    clientId,
    // In UTC: the schema's own z.iso.datetime() takes Z and not an offset.
    windowStart: `2026-09-07T${hour}:00:00.000Z`,
    windowEnd: `2026-09-07T${hour}:45:00.000Z`,
    status: 'confirmed',
    deliveryMode: 'home',
    client: {
      mrn: 'MW-000123',
      givenName: given,
      givenNameAr: null,
      familyInitial: 'M',
      familyInitialAr: null,
      age: 9,
    },
    serviceType: {
      id: '00000004-0000-4000-8000-000000000001',
      code: 'nf-session',
      name: 'Neurofeedback session',
    },
    location: {
      id: '00000003-0000-4000-8000-000000000001',
      label: 'home',
      emirate: 'DXB',
      entrancePoint: { lat: 25.2, lng: 55.27 },
      parkingPoint: null,
    },
  };
}

const STOPS = [
  stop(STOP_A, '08', '00000008-0000-4000-8000-000000000001', 'Rowan'),
  stop(STOP_B, '11', '00000008-0000-4000-8000-000000000002', 'Dahlia'),
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Mounts the day sheet with the routing route answering `routing`. */
function mount(routing: unknown, stops: unknown = STOPS) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/me') return json(ME);
    if (url.startsWith('/api/appointments')) return json({ appointments: stops });
    if (url.startsWith('/api/routing/day')) {
      return routing === null ? json({ error: 'internal' }, 500) : json(routing);
    }
    // Billing declines for this practitioner, which the card already treats as
    // an answer rather than an error.
    return json({ error: 'not_found' }, 404);
  }) as unknown as typeof fetch;

  return render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <MemoryRouter initialEntries={['/today']}>
        <TodayPage />
      </MemoryRouter>
    </AuthProviderBoundary>,
  );
}

const TRAFFIC: { legs: DayLegRow[]; pictureUrl: string | null; mapAvailable: boolean } = {
  legs: [
    {
      toStopId: STOP_B,
      fromLocationId: '00000003-0000-4000-8000-000000000001',
      toLocationId: '00000003-0000-4000-8000-000000000002',
      departAt: '2026-09-07T05:45:00.000Z',
      seconds: 1500,
      metres: 18000,
      source: 'traffic',
    },
  ],
  pictureUrl: '/api/routing/day-picture?date=2026-09-07&v=2-abc',
  mapAvailable: true,
};

const TRAFFIC_LEG = TRAFFIC.legs[0]!;

const FALLBACK = {
  legs: [{ ...TRAFFIC_LEG, seconds: 1800, metres: 20000, source: 'straight-line' as const }],
  pictureUrl: null,
  mapAvailable: false,
};

describe('describeLeg', () => {
  it('always says the word estimate, and never a point time', () => {
    expect(describeLeg(TRAFFIC_LEG)).toBe('about 25 min · 18 km, estimate from traffic');
    expect(describeLeg(FALLBACK.legs[0])).toBe('about 30 min · 20 km, straight-line estimate');
  });

  it('renders a placeholder rather than nothing while the figure is missing', () => {
    expect(describeLeg(undefined)).toBe('– –');
  });

  it('never rounds a real drive down to nothing', () => {
    expect(describeLeg({ ...TRAFFIC_LEG, seconds: 20, metres: 300 })).toContain('about 1 min');
  });
});

describe('the day sheet with the real implementation', () => {
  it('shows the picture and the drive between two stops', async () => {
    mount(TRAFFIC);
    expect(await screen.findByText('Rowan M.')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByText('about 25 min · 18 km, estimate from traffic')).toBeTruthy(),
    );
    const map = await screen.findByRole('img', { name: /map of your 2 stops today/ });
    expect(map.getAttribute('src')).toBe(TRAFFIC.pictureUrl);
  });

  it('reserves the line above the second stop from the first paint', async () => {
    // The routing route never answers, so the placeholder is all there is —
    // and it is there, which is what "rows never reflow" means.
    mount(null);
    expect(await screen.findByText('Rowan M.')).toBeTruthy();
    expect(screen.getByText('– –')).toBeTruthy();
  });

  it('reserves no line above the first stop, which has no previous stop', async () => {
    mount(TRAFFIC);
    expect(await screen.findByText('Rowan M.')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText(/estimate/)).toHaveLength(1));
  });
});

describe('the forced fallback', () => {
  it('renders every stop, every leg as a straight line, and no map', async () => {
    mount(FALLBACK);
    expect(await screen.findByText('Rowan M.')).toBeTruthy();
    expect(screen.getByText('Dahlia M.')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByText('about 30 min · 20 km, straight-line estimate')).toBeTruthy(),
    );
    expect(screen.getByText("The map needs the practice's key.")).toBeTruthy();
    expect(screen.queryByRole('img', { name: /map of your/ })).toBeNull();
    // The day still works: the actions on every stop are there.
    expect(screen.getAllByRole('button', { name: /Check in/ })).toHaveLength(2);
  });
});

describe('the install note', () => {
  const IPHONE_SAFARI =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 ' +
    '(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const ANDROID_CHROME =
    'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/130.0.0.0 Mobile Safari/537.36';

  it('is for Safari on an iPhone, in a tab, and nowhere else', () => {
    expect(wantsInstallNote({ userAgent: IPHONE_SAFARI } as Navigator, false)).toBe(true);
    // Already on the home screen: nothing to say.
    expect(wantsInstallNote({ userAgent: IPHONE_SAFARI } as Navigator, true)).toBe(false);
    // Android Chrome has its own prompt and no Share sheet entry to name.
    expect(wantsInstallNote({ userAgent: ANDROID_CHROME } as Navigator, false)).toBe(false);
  });
});

describe('the offline band', () => {
  it('is a calm line, and only when the device is actually offline', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    mount(FALLBACK);
    expect(
      await screen.findByText(
        'You are offline. This is the day as it last loaded; checking in needs a signal.',
      ),
    ).toBeTruthy();
    // Calm, not critical: working offline is normal (docs/DESIGN-BRIEF.md 6.1).
    expect(screen.queryByRole('alert')).toBeNull();
    online.mockRestore();

    cleanup();
    mount(FALLBACK);
    expect(await screen.findByText('Rowan M.')).toBeTruthy();
    expect(screen.queryByText(/You are offline/)).toBeNull();
  });
});
