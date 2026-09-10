// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { plainText } from './support';
import { fakeGoogleMaps } from './fakeGoogleMaps';
import { DayMapPage } from '../../app/admin/schedule/map/DayMapPage';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import type { AuthProvider } from '../../app/shell/auth/types';

afterEach(cleanup);

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => null,
  onChange: () => () => undefined,
};

const DAY = '2026-09-10';
const PRACTITIONER = '00000008-0000-4000-8000-000000000002';

const confirmed = {
  id: '00000008-0000-4000-8000-000000000101',
  windowStart: '2026-09-10T05:00:00.000Z',
  windowEnd: '2026-09-10T05:45:00.000Z',
  status: 'confirmed' as const,
  deliveryMode: 'home' as const,
  client: {
    id: '00000008-0000-4000-8000-000000000001',
    givenName: 'Iris',
    familyName: 'Cliff',
    givenNameAr: 'إيريس',
    familyNameAr: 'كليف',
  },
  practitioner: { id: PRACTITIONER, displayName: 'Cedar Ridge' },
  serviceType: { id: '00000008-0000-4000-8000-000000000003', name: 'Standard session' },
  location: { id: '00000008-0000-4000-8000-000000000004', label: 'home', emirate: 'DXB' },
  movedTo: null,
};

const proposed = {
  ...confirmed,
  id: '00000008-0000-4000-8000-000000000102',
  windowStart: '2026-09-10T07:00:00.000Z',
  windowEnd: '2026-09-10T07:45:00.000Z',
  status: 'proposed' as const,
  client: {
    id: '00000008-0000-4000-8000-000000000005',
    givenName: 'Juniper',
    familyName: 'Valley',
    givenNameAr: null,
    familyNameAr: null,
  },
  location: { id: '00000008-0000-4000-8000-000000000006', label: 'home', emirate: 'SHJ' },
};

const practiceDay = {
  practitioners: [
    {
      practitionerId: PRACTITIONER,
      homeBase: {
        locationId: '00000008-0000-4000-8000-000000000009',
        point: { lat: 25.2, lng: 55.27 },
      },
      stops: [
        {
          appointmentId: confirmed.id,
          locationId: confirmed.location.id,
          point: { lat: 25.3, lng: 55.3 },
          windowStart: confirmed.windowStart,
          windowEnd: confirmed.windowEnd,
          status: 'confirmed',
        },
        {
          appointmentId: proposed.id,
          locationId: proposed.location.id,
          point: { lat: 25.35, lng: 55.4 },
          windowStart: proposed.windowStart,
          windowEnd: proposed.windowEnd,
          status: 'proposed',
        },
      ],
      legs: [
        {
          toStopId: confirmed.id,
          fromLocationId: '00000008-0000-4000-8000-000000000009',
          toLocationId: confirmed.location.id,
          departAt: confirmed.windowStart,
          seconds: 900,
          metres: 9000,
          source: 'traffic' as const,
        },
        {
          toStopId: proposed.id,
          fromLocationId: confirmed.location.id,
          toLocationId: proposed.location.id,
          departAt: '2026-09-10T06:45:00.000Z',
          seconds: 1500,
          metres: 18000,
          source: 'traffic' as const,
        },
      ],
    },
  ],
};

function fetchImpl(): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/appointments?')) {
      return new Response(JSON.stringify({ appointments: [confirmed, proposed] }), { status: 200 });
    }
    if (url.startsWith('/api/routing/practice-day?')) {
      return new Response(JSON.stringify(practiceDay), { status: 200 });
    }
    // What the call-off drawer needs to run all the way through, so the
    // document boundary can be exercised where a coordinator really meets it.
    if (url.startsWith('/api/appointments/settings')) {
      return new Response(JSON.stringify({ noticeHours: 24, unfitFeeFils: 15000 }), {
        status: 200,
      });
    }
    if (url.endsWith('/cancel')) {
      return new Response(
        JSON.stringify({
          id: confirmed.id,
          status: 'cancelled',
          reason: 'client_request',
          noticeHours: 24,
          callOutFeeNetFils: null,
          callOutFeeVatFils: null,
          callOutFeeGrossFils: null,
          feeInvoiceId: null,
        }),
        { status: 200 },
      );
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

/**
 * A day with nothing booked. `/api/routing/practice-day` builds its list by
 * looping over appointments, so an empty day names no practitioner at all —
 * this is that answer, not an invented one.
 */
function fetchEmptyDay(): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/appointments?')) {
      return new Response(JSON.stringify({ appointments: [] }), { status: 200 });
    }
    if (url.startsWith('/api/routing/practice-day?')) {
      return new Response(JSON.stringify({ practitioners: [] }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

/** Reads back where the router thinks it is, so a test can prove it did not move. */
let whereTheRouterIs = '';
function LocationProbe() {
  const location = useLocation();
  whereTheRouterIs = `${location.pathname}${location.search}`;
  return null;
}

function renderPage(
  fetchStub: typeof globalThis.fetch,
  options: { key?: string | null; loadMaps?: () => Promise<typeof google.maps> } = {},
) {
  const loadMaps = options.loadMaps ?? (() => Promise.resolve(fakeGoogleMaps().maps));
  return render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchStub}>
      <MemoryRouter initialEntries={[`/admin/schedule/map?date=${DAY}`]}>
        <LocationProbe />
        <DayMapPage
          browserKey={options.key === undefined ? 'a-restricted-browser-key' : options.key}
          loadMaps={loadMaps}
        />
      </MemoryRouter>
    </AuthProviderBoundary>,
  );
}

describe('DayMapPage', () => {
  it('lists the day beside the map, in window order, with the drive beneath each stop after the first', async () => {
    renderPage(fetchImpl());
    expect(await screen.findByRole('button', { name: 'Iris Cliff' })).toBeTruthy();
    expect(screen.getByText('09:00–09:45', plainText)).toBeTruthy();
    expect(screen.getByText('about 25 min, 18 km, estimate from traffic')).toBeTruthy();
    // Nothing above the first stop: there is no drive before the day begins.
    expect(screen.queryAllByText(/estimate from traffic/)).toHaveLength(1);
  });

  it('draws the map when the practice has a browser key', async () => {
    renderPage(fetchImpl(), { key: 'a-restricted-browser-key' });
    expect(await screen.findByRole('button', { name: 'Stop 1 on the map' })).toBeTruthy();
    expect(screen.queryByText("The map needs the practice's browser key.")).toBeNull();
  });

  it('draws the map on a day with nothing booked, centred on the city rather than blank', async () => {
    // Production went live with no visit booked, and the day map showed a flat
    // grey panel: the page waited for a practitioner as well as for Google's
    // script, and `/api/routing/practice-day` names a practitioner only when
    // they have a stop. A coordinator could not tell an empty day from a
    // broken map.
    const fake = fakeGoogleMaps();
    renderPage(fetchEmptyDay(), { loadMaps: () => Promise.resolve(fake.maps) });

    expect(await screen.findByText('No appointments are booked for this day.')).toBeTruthy();
    // The map is real, not the placeholder panel.
    await waitFor(() => expect(fake.mapOptions).not.toBeNull());
    expect(fake.mapOptions?.center).toEqual({ lat: 25.2, lng: 55.27 });
    // Nothing to fit a viewport around, so the default zoom stands.
    expect(fake.fitted).toBe(0);
    expect(screen.queryByRole('button', { name: /Stop \d+ on the map/ })).toBeNull();
  });

  it('says the map needs a key, and still shows the whole day, when there is none', async () => {
    renderPage(fetchImpl(), { key: null });
    expect(await screen.findByText("The map needs the practice's browser key.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Iris Cliff' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Optimise the day' })).toBeTruthy();
  });

  it('says how to reach a map that could not load on a page reached from another screen', async () => {
    renderPage(fetchImpl(), { key: 'k', loadMaps: () => Promise.reject(new Error('blocked')) });
    expect(
      await screen.findByText(
        'Open the day map from the Schedule page — a map cannot load on a screen you reached from another one.',
      ),
    ).toBeTruthy();
  });

  it('says plainly when the day could not be loaded', async () => {
    renderPage((() =>
      Promise.resolve(new Response('no', { status: 500 }))) as unknown as typeof fetch);
    expect(await screen.findByText('The day could not be loaded. Try again.')).toBeTruthy();
  });

  it('picks a stop out when its pin is pressed, and shows the practitioner’s own name over the panel', async () => {
    renderPage(fetchImpl(), { key: 'k' });
    fireEvent.click(await screen.findByRole('button', { name: 'Stop 2 on the map' }));
    expect(screen.getByRole('listitem', { current: true })).toBeTruthy();
    expect(screen.getByText('Cedar Ridge')).toBeTruthy();
  });

  it('offers Move and Call off on an open visit, and Confirm only on one nobody has been told about', async () => {
    renderPage(fetchImpl(), { key: 'k' });
    expect(await screen.findByRole('button', { name: /^Move Iris Cliff/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Confirm Juniper Valley/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Confirm Iris Cliff/ })).toBeNull();
  });

  it('is English throughout, whatever the wire carries', async () => {
    renderPage(fetchImpl(), { key: 'k' });
    await screen.findByRole('button', { name: 'Iris Cliff' });
    expect(screen.queryByText('إيريس كليف')).toBeNull();
  });

  /**
   * The boundary this document is (docs/SECURITY.md; the review of this pull
   * request, finding B2, and the re-check of the first fix round).
   *
   * This page is served with the wider content security policy Google's map
   * script needs. If anything inside it navigates **in place**, the screen it
   * lands on is rendered in this document, under `'unsafe-eval'` and
   * `'strict-dynamic'` — and from Billing the rail puts Clients, Books, Audit
   * and Settings one click away for the rest of the session. So every way out
   * has to be a fresh document load, and the way to be sure of that is to make
   * it a property of the tree rather than of whoever wrote the link.
   *
   * The path below is the one a coordinator really walks: call a visit off
   * from the map, and the drawer offers Billing beside Close.
   */
  it('does not navigate in place when a drawer inside it offers a way out', async () => {
    renderPage(fetchImpl(), { key: 'k' });
    fireEvent.click(await screen.findByRole('button', { name: /^Call off Iris Cliff/ }));

    fireEvent.change(screen.getByLabelText('What happened?'), {
      target: { value: 'The family called it off.' },
    });
    // The drawer will not act until it knows what the practice's own notice
    // period costs, so this waits for that rather than clicking a dead button.
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Call off this visit' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Call off this visit' }));

    const billing = await screen.findByRole('link', { name: 'Open Billing' });
    // A plain anchor, which jsdom will not follow; a router Link would move
    // the location below without ever loading a document.
    expect(billing.getAttribute('href')).toBe('/admin/billing');
    fireEvent.click(billing);
    expect(whereTheRouterIs).toBe(`/admin/schedule/map?date=${DAY}`);
  });

  it('keeps the way back to the Schedule a fresh document too', async () => {
    renderPage(fetchImpl(), { key: 'k' });
    const schedule = await screen.findByRole('link', { name: 'Schedule' });
    expect(schedule.getAttribute('href')).toBe(`/admin/schedule?date=${DAY}`);
    fireEvent.click(schedule);
    expect(whereTheRouterIs).toBe(`/admin/schedule/map?date=${DAY}`);
  });
});
