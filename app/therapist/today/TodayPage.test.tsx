// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../../shell/auth/AuthContext';
import type { AuthProvider } from '../../shell/auth/types';
import type { DayLegRow } from '../../api/routing/schema';
import { TodayPage, describeLeg, wantsInstallNote } from './TodayPage';

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
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
    declared: [],
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

/** A PNG's first four bytes. What matters is that they are not JSON. */
const PICTURE = new Uint8Array([137, 80, 78, 71]);

/**
 * Mounts the day sheet with the routing route answering `routing`, and hands
 * back the fetch it was given so a test can ask what was actually requested
 * and with which headers.
 */
function mount(
  routing: unknown,
  stops: unknown = STOPS,
  pictureGate?: Promise<unknown>,
  me: unknown = ME,
) {
  const fetchImpl = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url === '/api/me') return json(me);
    if (url.startsWith('/api/appointments')) return json({ appointments: stops });
    // Before the day itself: the picture's path begins with the day's.
    if (url.startsWith('/api/routing/day-picture')) {
      // A gate, when a test wants to see the screen while the bytes are still
      // on their way; without one the picture arrives as fast as any other read.
      if (pictureGate !== undefined) await pictureGate;
      return new Response(PICTURE, { status: 200, headers: { 'content-type': 'image/png' } });
    }
    if (url.startsWith('/api/routing/day')) {
      return routing === null ? json({ error: 'internal' }, 500) : json(routing);
    }
    // Billing declines for this practitioner, which the card already treats as
    // an answer rather than an error.
    return json({ error: 'not_found' }, 404);
  });

  render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <MemoryRouter initialEntries={['/today']}>
        <TodayPage />
      </MemoryRouter>
    </AuthProviderBoundary>,
  );
  return fetchImpl;
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
    expect(describeLeg(TRAFFIC_LEG)).toBe('about 25 min, 18 km, estimate from traffic');
    // No distance at all on the fallback's line: a straight line times a road
    // factor is not a figure to print as kilometres (section 5.4).
    expect(describeLeg(FALLBACK.legs[0])).toBe('about 30 min, straight-line estimate');
  });

  it('renders a placeholder rather than nothing while the figure is missing', () => {
    expect(describeLeg(undefined)).toBe('– –');
  });

  it('never rounds a real drive down to nothing', () => {
    expect(describeLeg({ ...TRAFFIC_LEG, seconds: 20, metres: 300 })).toContain('about 1 min');
  });
});

describe('the day sheet with the real implementation', () => {
  it('says what a household told the practice about their health, in a word each', async () => {
    // A "yes" shows on the card and blocks nothing (client-record.md section
    // 4.6); a stop with nothing declared carries no line at all.
    mount(TRAFFIC, [{ ...STOPS[0], declared: ['headInjury', 'medication'] }, STOPS[1]]);
    expect(await screen.findByText('Told us about: a head injury, medication.')).toBeTruthy();
    expect(screen.getAllByText(/Told us about/)).toHaveLength(1);
  });

  it('shows the picture and the drive between two stops', async () => {
    mount(TRAFFIC);
    expect(await screen.findByText('Rowan M.')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByText('about 25 min, 18 km, estimate from traffic')).toBeTruthy(),
    );
    const map = await screen.findByRole('img', { name: /map of your 2 stops today/ });
    // Not the route's own address: the bytes were fetched and are shown from
    // an object URL, because the route answers a bearer header and nothing else.
    expect(map.getAttribute('src')).toMatch(/^blob:/);
  });

  it('asks for the picture with the session on it, as every other read is asked for', async () => {
    const fetchImpl = mount(TRAFFIC);
    await screen.findByRole('img', { name: /map of your 2 stops today/ });
    const call = fetchImpl.mock.calls.find(([input]) =>
      String(input).startsWith('/api/routing/day-picture'),
    );
    expect(call, 'the picture was never fetched').toBeTruthy();
    expect(String(call?.[0])).toBe(TRAFFIC.pictureUrl);
    const headers = new Headers(call?.[1]?.headers);
    expect(headers.get('authorization')).toBe('Bearer token');
  });

  it("reserves the picture's box from the first paint, and fills it in place", async () => {
    // The bytes are held back so both states can be seen in order. The box is
    // reserved at the picture's own 16:10 while it loads and the picture then
    // replaces the placeholder, so the stop list never drops by its height
    // when it lands: rows never reflow when data arrives (section 5.4).
    let deliverPicture: () => void = () => undefined;
    mount(
      TRAFFIC,
      STOPS,
      new Promise<void>((resolve) => {
        deliverPicture = resolve;
      }),
    );
    const pending = await screen.findByTestId('day-picture-pending');
    // The same class as the picture, which is what makes the box the same box.
    expect(pending.className).toContain('today__map');
    expect(screen.queryByRole('img', { name: /map of your/ })).toBeNull();

    deliverPicture();
    expect(await screen.findByRole('img', { name: /map of your 2 stops today/ })).toBeTruthy();
    expect(screen.queryByTestId('day-picture-pending')).toBeNull();
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
      expect(screen.getByText('about 30 min, straight-line estimate')).toBeTruthy(),
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

/**
 * The way from a practitioner's own screen to the one console screen they may
 * open. Until the fix round of 2026-09-08 there was none: `homeFor` sends a
 * practitioner to `/today`, nothing here linked into `/admin`, and the screen
 * built for the operator's instruction — "every practioner can add their own
 * address" — could only be reached by typing its address.
 *
 * Two things make it a reasonable place to send somebody. The console lays out
 * at phone widths (docs/SPEC/responsive-console.md, piece nineteen), so a
 * practitioner tapping this on a phone gets a usable screen and not a desk one;
 * and a home base is one field a person sets once, not a flow they live in.
 */
describe('the way to your own home base', () => {
  const LEAD = { ...ME, roles: ['lead_practitioner'] };
  const OWNER = { ...ME, roles: ['owner', 'lead_practitioner'] };

  /** The day sheet with somewhere to arrive, so the destination is asserted. */
  function mountWithDestination(me: unknown) {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === '/api/me') return json(me);
      if (url.startsWith('/api/appointments')) return json({ appointments: STOPS });
      if (url.startsWith('/api/routing/day')) return json(FALLBACK);
      return json({ error: 'not_found' }, 404);
    });
    render(
      <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
        <MemoryRouter initialEntries={['/today']}>
          <Routes>
            <Route path="/today" element={<TodayPage />} />
            <Route path="/admin/settings/practitioners" element={<h1>Practitioners</h1>} />
          </Routes>
        </MemoryRouter>
      </AuthProviderBoundary>,
    );
  }

  it('offers a practitioner the door, and it lands on the base screen', async () => {
    mountWithDestination(ME);
    fireEvent.click(await screen.findByRole('button', { name: 'Your home base' }));
    expect(await screen.findByRole('heading', { name: 'Practitioners' })).toBeTruthy();
  });

  it('does not offer it beside the console button an owner already has', async () => {
    mount(FALLBACK, STOPS, undefined, OWNER);
    expect(await screen.findByRole('button', { name: 'Admin console' })).toBeTruthy();
    // They have the rail, and the rail carries Settings (app/shell/AdminLayout.tsx).
    expect(screen.queryByRole('button', { name: 'Your home base' })).toBeNull();
  });

  it('does not offer it to a lead practitioner either, for the same reason', async () => {
    mount(FALLBACK, STOPS, undefined, LEAD);
    expect(await screen.findByRole('button', { name: 'Admin console' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Your home base' })).toBeNull();
  });

  it('keeps "Admin console" meaning what it meant, and never both at once', async () => {
    mount(FALLBACK);
    await screen.findByRole('button', { name: 'Your home base' });
    expect(screen.queryByRole('button', { name: 'Admin console' })).toBeNull();
  });
});

/**
 * Today's "Whole practice" (the practice's request that all four see the day
 * alike; the operator's decision of 2026-10-06). Offered only to the roles the
 * database already lets read every appointment, and a view across the day,
 * never a way to act on somebody else's visit.
 */
describe('the whole practice', () => {
  const LEAD = { ...ME, roles: ['practitioner', 'lead_practitioner'] };
  const OWNER_ONLY = { ...ME, roles: ['owner'] };
  const OTHER = '00000006-0000-4000-8000-000000000002';
  const MINE = '00000006-0000-4000-8000-000000000001';

  const TEAM = [
    {
      ...STOPS[0],
      practitioner: { id: MINE, displayName: 'Rowan Meadow' },
      mine: true,
    },
    {
      ...STOPS[1],
      practitioner: { id: OTHER, displayName: 'Sable Practitioner' },
      mine: false,
    },
  ];

  /** The day sheet answering each scope with its own body. */
  function mountScopes(me: unknown, own: unknown, team: unknown = { appointments: TEAM }) {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === '/api/me') return json(me);
      if (url.startsWith('/api/appointments')) {
        if (url.includes('scope=team')) return json(team);
        if (url.includes('scope=own')) return json(own);
        return json({ error: 'bad_request' }, 400);
      }
      if (url.startsWith('/api/routing/day')) return json(FALLBACK);
      return json({ error: 'not_found' }, 404);
    });
    render(
      <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
        <MemoryRouter initialEntries={['/today']}>
          <TodayPage />
        </MemoryRouter>
      </AuthProviderBoundary>,
    );
    return fetchImpl;
  }

  const asked = (fetchImpl: ReturnType<typeof mountScopes>, scope: string) =>
    fetchImpl.mock.calls.some(([input]) => String(input).includes(`scope=${scope}`));

  it('is not offered to a practitioner, who sees their own day and asks for nothing more', async () => {
    const fetchImpl = mountScopes(ME, { appointments: STOPS, hasOwnDay: true });
    expect(await screen.findByText('Rowan M.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Whole practice' })).toBeNull();
    expect(asked(fetchImpl, 'team')).toBe(false);
  });

  it("opens a lead practitioner on their own day, and switches to everyone's", async () => {
    const fetchImpl = mountScopes(LEAD, { appointments: [STOPS[0]], hasOwnDay: true });
    expect(await screen.findByText('Rowan M.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mine' }).getAttribute('aria-pressed')).toBe('true');
    expect(asked(fetchImpl, 'team')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Whole practice' }));
    expect(await screen.findByText('Dahlia M.')).toBeTruthy();
    expect(asked(fetchImpl, 'team')).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Whole practice' }).getAttribute('aria-pressed'),
    ).toBe('true');
    // Each stop says whose it is.
    expect(screen.getByText('Sable Practitioner')).toBeTruthy();
    expect(screen.getByText('Yours')).toBeTruthy();
  });

  it("keeps Check in and Call off to the caller's own stops", async () => {
    sessionStorage.setItem('mcwellness-today-view', 'team');
    mountScopes(LEAD, { appointments: [STOPS[0]], hasOwnDay: true });
    expect(await screen.findByText('Dahlia M.')).toBeTruthy();
    // Their own stop keeps its buttons; somebody else's is there to look at.
    expect(screen.getAllByRole('button', { name: /Check in/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Check in Rowan M.' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Call off Dahlia/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Navigate to Dahlia/ })).toBeNull();
  });

  it('remembers the choice for the session, and only the session', async () => {
    mountScopes(LEAD, { appointments: [STOPS[0]], hasOwnDay: true });
    fireEvent.click(await screen.findByRole('button', { name: 'Whole practice' }));
    await screen.findByText('Dahlia M.');
    expect(sessionStorage.getItem('mcwellness-today-view')).toBe('team');
    expect(localStorage.getItem('mcwellness-today-view')).toBeNull();

    cleanup();
    mountScopes(LEAD, { appointments: [STOPS[0]], hasOwnDay: true });
    expect(await screen.findByText('Dahlia M.')).toBeTruthy();
  });

  it('ignores a remembered choice the caller may not make', async () => {
    // A shared device, a practitioner signing in after a lead: the stored word
    // is a preference, never a permission.
    sessionStorage.setItem('mcwellness-today-view', 'team');
    const fetchImpl = mountScopes(ME, { appointments: STOPS, hasOwnDay: true });
    expect(await screen.findByText('Rowan M.')).toBeTruthy();
    expect(asked(fetchImpl, 'team')).toBe(false);
  });

  it('opens an owner who is nobody’s practitioner on the whole practice, not an empty day', async () => {
    mountScopes(
      OWNER_ONLY,
      { appointments: [], hasOwnDay: false },
      { appointments: TEAM.map((stop) => ({ ...stop, mine: false })) },
    );
    expect(await screen.findByText('Dahlia M.')).toBeTruthy();
    expect(screen.queryByText('Nothing is booked for you today.')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Whole practice' }).getAttribute('aria-pressed'),
    ).toBe('true');
    // None of it is theirs, so none of it carries a check-in.
    expect(screen.queryByRole('button', { name: /Check in/ })).toBeNull();
  });
});
