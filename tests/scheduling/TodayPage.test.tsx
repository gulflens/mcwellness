// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DayStop } from '../../app/api/appointments/schema';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import type { AuthProvider } from '../../app/shell/auth/types';
import { TodayPage } from '../../app/therapist/today/TodayPage';

afterEach(cleanup);

/**
 * The practitioner's Today screen (docs/SPEC/scheduling-manual.md section
 * 5.1): the stops of one day in one column, the current one emphasised, the
 * ones behind it folded but whole, a drive out to Google Maps and a way into
 * check-in that carries the record number without putting it in the address.
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
// Names and their Arabic come from db/seed/names.ts, the one list every
// invented person in this repository is named from: Iris is سوسن and Cliff is
// جرف there, so those are the spellings here too.
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
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

function stop(overrides: Partial<DayStop> & { id: string }): DayStop {
  const windowStart = overrides.windowStart ?? dubai('09:00:00');
  return {
    windowStart,
    windowEnd: plus45(windowStart),
    status: 'confirmed',
    deliveryMode: 'home',
    client: {
      mrn: 'MW-000123',
      givenName: 'Iris',
      givenNameAr: null,
      familyInitial: 'C',
      familyInitialAr: null,
      age: 9,
    },
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

function dayOf(...appointments: DayStop[]): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/appointments?')) {
      return new Response(JSON.stringify({ appointments }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

/** Renders where a navigation landed, and what it carried out of sight. */
function Wherever() {
  const location = useLocation();
  return (
    <div>
      <div data-testid="destination">{`${location.pathname}${location.search}`}</div>
      <div data-testid="carried">{JSON.stringify(location.state)}</div>
    </div>
  );
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
    // The family name never reaches the browser at all (the wire carries one
    // initial), and the record number is never put on the face of the screen.
    expect(screen.queryByText(/Cliff/)).toBeNull();
    expect(screen.queryByText(/MW-000123/)).toBeNull();
  });

  it('renders an Arabic name as given name and initial, in its own script and direction', async () => {
    renderPage(
      dayOf(
        stop({
          id: '00000009-0000-4000-8000-000000000203',
          client: {
            mrn: 'MW-000123',
            givenName: 'Iris',
            givenNameAr: 'سوسن',
            familyInitial: 'C',
            familyInitialAr: 'ج',
            age: 9,
          },
        }),
      ),
    );
    const arabic = await screen.findByText('سوسن ج.');
    expect(arabic.getAttribute('lang')).toBe('ar');
    expect(arabic.getAttribute('dir')).toBe('rtl');
  });

  it('drives to the parking point when there is one, and says where the link goes', async () => {
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
    const link = await screen.findByRole('link', {
      name: 'Navigate to Iris C., opens Google Maps in a new tab',
    });
    expect(link.getAttribute('href')).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=25.21,55.28',
    );
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    // Only the word is on screen; the rest is for a screen reader.
    expect(link.textContent).toContain('Navigate');
  });

  it('falls back to the entrance when nobody has recorded where to park', async () => {
    renderPage(dayOf(stop({ id: '00000009-0000-4000-8000-000000000205' })));
    const link = await screen.findByRole('link', { name: /^Navigate/ });
    expect(link.getAttribute('href')).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=25.2,55.27',
    );
  });

  it('hands check-in the record number out of sight, never in the address', async () => {
    renderPage(dayOf(stop({ id: '00000009-0000-4000-8000-000000000206' })));
    fireEvent.click(await screen.findByRole('button', { name: 'Check in Iris C.' }));
    await waitFor(() =>
      expect(screen.getByTestId('destination').textContent).toBe('/today/check-in'),
    );
    // .claude/rules/ui.md: no personal data in paths or query strings. It
    // travels in router state, so it never reaches history or a server log.
    expect(screen.getByTestId('destination').textContent).not.toContain('MW-000123');
    expect(JSON.parse(screen.getByTestId('carried').textContent ?? '{}')).toEqual({
      record: 'MW-000123',
    });
  });

  it('emphasises the stop being delivered', async () => {
    const first = stop({ id: '00000009-0000-4000-8000-000000000207', windowStart: hoursAgo(3) });
    const second = stop({
      id: '00000009-0000-4000-8000-000000000208',
      windowStart: hoursAgo(2),
      client: {
        mrn: 'MW-000456',
        givenName: 'Hazel',
        givenNameAr: null,
        familyInitial: 'B',
        familyInitialAr: null,
        age: 41,
      },
    });
    renderPage(dayOf(first, second));
    // What a screen reader is told, and what a person reads in it.
    const current = await screen.findByRole('listitem', { current: 'step' });
    expect(current.textContent).toContain('Hazel B.');
    expect(current.textContent).not.toContain('Iris C.');
  });

  it('keeps the actions on a stop nobody closed, however far the day has moved on', async () => {
    // The gap this test exists for: the earlier visit is behind the
    // practitioner but still open, and it must not lose its buttons just
    // because a later window has since opened.
    const forgotten = stop({
      id: '00000009-0000-4000-8000-000000000209',
      windowStart: hoursAgo(3),
    });
    const current = stop({
      id: '00000009-0000-4000-8000-000000000210',
      windowStart: hoursAgo(2),
      client: {
        mrn: 'MW-000456',
        givenName: 'Hazel',
        givenNameAr: null,
        familyInitial: 'B',
        familyInitialAr: null,
        age: 41,
      },
    });
    const { container } = renderPage(dayOf(forgotten, current));
    await waitFor(() => expect(container.querySelectorAll('.stop')).toHaveLength(2));
    const [behind] = Array.from(container.querySelectorAll<HTMLElement>('.stop'));
    if (!behind) throw new Error('no stop rendered');

    // Folded to when it was and who it was.
    const summary = within(behind).getByText('Iris C.');
    expect(summary).toBeTruthy();

    // And it opens to the whole stop, drive and check-in included.
    const fold = behind.querySelector('details');
    fireEvent.click(behind.querySelector('summary') as HTMLElement);
    expect(fold?.hasAttribute('open')).toBe(true);
    expect(within(behind).getByRole('button', { name: 'Check in Iris C.' })).toBeTruthy();
    expect(within(behind).getByRole('link', { name: /^Navigate to Iris C\./ })).toBeTruthy();
    expect(within(behind).getByText('Standard session')).toBeTruthy();
  });

  it('offers no drive and no check-in for a visit already settled', async () => {
    renderPage(dayOf(stop({ id: '00000009-0000-4000-8000-000000000211', status: 'completed' })));
    expect(await screen.findByText('Done')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Navigate/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Check in/ })).toBeNull();
  });

  it('says what happened at a visit nobody answered', async () => {
    renderPage(dayOf(stop({ id: '00000009-0000-4000-8000-000000000212', status: 'no_show' })));
    expect(await screen.findByText('Nobody answered')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Check in/ })).toBeNull();
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

  it('asks again when the practitioner comes back to the screen', async () => {
    const fetchImpl = dayOf(stop({ id: '00000009-0000-4000-8000-000000000213' }));
    renderPage(fetchImpl);
    await screen.findByText('09:00–09:45');
    const dayCalls = () =>
      (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((call) =>
        String(call[0]).startsWith('/api/appointments?'),
      ).length;
    const before = dayCalls();
    fireEvent(document, new Event('visibilitychange'));
    await waitFor(() => expect(dayCalls()).toBeGreaterThan(before));
  });

  it('keeps the landing screen it replaces: the roles line and a quiet sign-out', async () => {
    renderPage(dayOf());
    expect(await screen.findByText('Practitioner')).toBeTruthy();
    const signOut = screen.getByRole('button', { name: 'Sign out' });
    // Not a slab of the same weight as checking a client in.
    expect(signOut.className).toContain('button--quiet');
    expect(signOut.className).not.toContain('stop__action');
    expect(screen.queryByRole('button', { name: 'Admin console' })).toBeNull();
  });

  it('offers the console back to someone whose home is the console', async () => {
    renderPage(dayOf(), OWNER_WHO_TREATS);
    expect(await screen.findByRole('button', { name: 'Admin console' })).toBeTruthy();
  });

  it('states plainly that it needs a connection, without describing a roadmap', async () => {
    renderPage(dayOf());
    expect(await screen.findByText('Today needs a connection.')).toBeTruthy();
    expect(screen.queryByText(/next piece of work/)).toBeNull();
  });
});
