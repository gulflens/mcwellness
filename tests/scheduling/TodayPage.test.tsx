// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppointmentRow } from '../../app/api/appointments/schema';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import type { AuthProvider } from '../../app/shell/auth/types';
import { TodayPage } from '../../app/therapist/today/TodayPage';

afterEach(cleanup);

/**
 * The practitioner's Today screen (docs/SPEC/scheduling-manual.md section
 * 5.1): the stops of one day in one column, the current one emphasised, the
 * ones behind it collapsed, a drive out to Google Maps and a way into
 * check-in carrying the record number.
 */

// A signed-in session: the screen shows who is signed in and offers the
// console back, so it needs a token and an /api/me answer, not just a fetch.
const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => 'token',
  onChange: () => () => undefined,
};

// Synthetic throughout, in the reserved ranges (.claude/rules/testing.md).
const PRACTITIONER = {
  userId: '00000009-0000-4000-8000-000000000001',
  displayName: 'Rowan Meadow',
  tenantId: '00000009-0000-4000-8000-000000000002',
  roles: ['practitioner'],
  capabilities: [],
};

const OWNER_WHO_TREATS = { ...PRACTITIONER, roles: ['owner', 'lead_practitioner'] };

/** Today in Dubai, so the screen asks for the day it is actually on. */
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date());
const dubai = (hour: string) => new Date(`${TODAY}T${hour}+04:00`).toISOString();
const plus45 = (iso: string) => new Date(new Date(iso).getTime() + 45 * 60_000).toISOString();

function stop(overrides: Partial<AppointmentRow> & { id: string }): AppointmentRow {
  const windowStart = overrides.windowStart ?? dubai('09:00:00');
  return {
    windowStart,
    windowEnd: plus45(windowStart),
    status: 'confirmed',
    deliveryMode: 'home',
    client: {
      id: '00000009-0000-4000-8000-000000000101',
      givenName: 'Iris',
      familyName: 'Cliff',
      givenNameAr: null,
      familyNameAr: null,
      mrn: 'MW-000123',
      age: 9,
    },
    practitioner: { id: '00000009-0000-4000-8000-000000000102', displayName: 'Rowan Meadow' },
    serviceType: { id: '00000009-0000-4000-8000-000000000103', name: 'Standard session' },
    location: {
      id: '00000009-0000-4000-8000-000000000104',
      label: 'home',
      emirate: 'DXB',
      entrancePoint: { lat: 25.2, lng: 55.27 },
      parkingPoint: null,
    },
    ...overrides,
  };
}

function dayOf(...appointments: AppointmentRow[]): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/appointments?')) {
      return new Response(JSON.stringify({ appointments }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

/** Renders the destination path, so a navigation can be asserted on. */
function Wherever() {
  const location = useLocation();
  return <div data-testid="destination">{`${location.pathname}${location.search}`}</div>;
}

function renderPage(fetchImpl: typeof fetch, actor: typeof PRACTITIONER = PRACTITIONER) {
  const me = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).startsWith('/api/me')) {
      return new Response(JSON.stringify(actor), { status: 200 });
    }
    return fetchImpl(input);
  }) as unknown as typeof fetch;
  return render(
    <AuthProviderBoundary provider={provider} fetchImpl={me}>
      <MemoryRouter initialEntries={['/today']}>
        <Routes>
          <Route path="/today" element={<TodayPage />} />
          <Route path="*" element={<Wherever />} />
        </Routes>
      </MemoryRouter>
    </AuthProviderBoundary>,
  );
}

describe('TodayPage', () => {
  it("asks only for the caller's own day, for today in the practice's zone", async () => {
    const fetchImpl = dayOf(stop({ id: '00000009-0000-4000-8000-000000000201' }));
    renderPage(fetchImpl);
    await screen.findByText('09:00–09:45');
    const calls = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls.some((call) => String(call[0]).includes(`date=${TODAY}&scope=own`))).toBe(true);
  });

  it('shows the window, the first name and family initial, the age, the service and the place', async () => {
    renderPage(dayOf(stop({ id: '00000009-0000-4000-8000-000000000202' })));
    expect(await screen.findByText('09:00–09:45')).toBeTruthy();
    expect(screen.getByText('Iris C.')).toBeTruthy();
    expect(screen.getByText('9 years old')).toBeTruthy();
    expect(screen.getByText('Standard session')).toBeTruthy();
    expect(screen.getByText('Home, Dubai')).toBeTruthy();
    // Never the full family name, and never a record number on the face of it.
    expect(screen.queryByText(/Cliff/)).toBeNull();
    expect(screen.queryByText(/MW-000123/)).toBeNull();
  });

  it('renders an Arabic given name in its own script and direction', async () => {
    renderPage(
      dayOf(
        stop({
          id: '00000009-0000-4000-8000-000000000203',
          client: {
            id: '00000009-0000-4000-8000-000000000101',
            givenName: 'Iris',
            familyName: 'Cliff',
            givenNameAr: 'إيريس',
            familyNameAr: 'كليف',
            mrn: 'MW-000123',
            age: 9,
          },
        }),
      ),
    );
    const arabic = await screen.findByText('إيريس');
    expect(arabic.getAttribute('lang')).toBe('ar');
    expect(arabic.getAttribute('dir')).toBe('rtl');
  });

  it('drives to the parking point when there is one, and the entrance when there is not', async () => {
    renderPage(
      dayOf(
        stop({
          id: '00000009-0000-4000-8000-000000000204',
          location: {
            id: '00000009-0000-4000-8000-000000000104',
            label: 'home',
            emirate: 'DXB',
            entrancePoint: { lat: 25.2, lng: 55.27 },
            parkingPoint: { lat: 25.21, lng: 55.28 },
          },
        }),
      ),
    );
    const link = await screen.findByRole('link', { name: 'Navigate to Iris C.' });
    expect(link.getAttribute('href')).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=25.21,55.28',
    );
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('carries the record number into check-in through the query string', async () => {
    renderPage(dayOf(stop({ id: '00000009-0000-4000-8000-000000000205' })));
    fireEvent.click(await screen.findByRole('button', { name: 'Check in Iris C.' }));
    await waitFor(() =>
      expect(screen.getByTestId('destination').textContent).toBe('/today/check-in?mrn=MW-000123'),
    );
  });

  it('emphasises the stop being delivered and collapses the ones behind it', async () => {
    // Two stops, both still open, both already begun: the later of the two is
    // the one the practitioner is on. Timed from the real clock rather than a
    // fixed hour, so the assertion holds whenever the suite runs.
    const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
    const first = stop({ id: '00000009-0000-4000-8000-000000000206', windowStart: hoursAgo(3) });
    const second = stop({ id: '00000009-0000-4000-8000-000000000207', windowStart: hoursAgo(2) });
    const { container } = renderPage(dayOf(first, second));
    await waitFor(() => expect(container.querySelectorAll('.stop')).toHaveLength(2));
    const stops = container.querySelectorAll('.stop');
    expect(stops[0]?.className).toContain('stop--past');
    expect(stops[1]?.className).toContain('stop--current');
    // The collapsed stop keeps its window and its name and loses the rest.
    expect(stops[0]?.textContent).toContain('Iris C.');
    expect(stops[0]?.textContent).not.toContain('Standard session');
    expect(stops[1]?.textContent).toContain('Standard session');
  });

  it('offers no drive and no check-in for a visit already settled', async () => {
    renderPage(dayOf(stop({ id: '00000009-0000-4000-8000-000000000208', status: 'cancelled' })));
    expect(await screen.findByText('Cancelled')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Navigate/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Check in/ })).toBeNull();
  });

  it('warns when the client has not been told about the visit yet', async () => {
    renderPage(dayOf(stop({ id: '00000009-0000-4000-8000-000000000209', status: 'proposed' })));
    expect(await screen.findByText('Not yet confirmed with the client')).toBeTruthy();
  });

  it('says so plainly when nothing is booked', async () => {
    renderPage(dayOf());
    expect(await screen.findByText('Nothing is booked for you today.')).toBeTruthy();
  });

  it('offers a way back when the day cannot be loaded', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).startsWith('/api/appointments?')) {
        return new Response('no', { status: 500 });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;
    renderPage(fetchImpl);
    expect(
      await screen.findByText(
        'Your day could not be loaded. Check your connection, then try again.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('keeps the landing screen it replaces: the roles line and sign-out', async () => {
    renderPage(dayOf());
    expect(await screen.findByText('Practitioner')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Admin console' })).toBeNull();
  });

  it('offers the console back to someone whose home is the console', async () => {
    renderPage(dayOf(), OWNER_WHO_TREATS);
    expect(await screen.findByRole('button', { name: 'Admin console' })).toBeTruthy();
  });

  it('states that offline is still to come, rather than pretending the day is cached', async () => {
    renderPage(dayOf());
    expect(await screen.findByText(/Today needs a connection for now/)).toBeTruthy();
  });
});
