// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { plainText } from './support';
import { SchedulePage } from '../../app/admin/schedule/SchedulePage';
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

const appointment = {
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
  practitioner: { id: '00000008-0000-4000-8000-000000000002', displayName: 'Cedar Ridge' },
  serviceType: { id: '00000008-0000-4000-8000-000000000003', name: 'Standard session' },
  location: { id: '00000008-0000-4000-8000-000000000004', label: 'home', emirate: 'DXB' },
};

/**
 * A visit still waiting for somebody to tell the household about it
 * (docs/SPEC/scheduling-manual.md section 3). Names from db/seed/names.ts.
 */
const proposed = {
  ...appointment,
  id: '00000008-0000-4000-8000-000000000102',
  status: 'proposed' as const,
  client: {
    id: '00000008-0000-4000-8000-000000000005',
    givenName: 'Juniper',
    familyName: 'Valley',
    givenNameAr: null,
    familyNameAr: null,
  },
};

/** The day the screen opens on lives in the address, so the week view can
 * hand a day back; a router is what supplies that, and the two links out of
 * the toolbar need one anyway. */
function renderPage(fetchImpl: typeof fetch, date = '2026-09-10') {
  return render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <MemoryRouter initialEntries={[`/admin/schedule?date=${date}`]}>
        <SchedulePage />
      </MemoryRouter>
    </AuthProviderBoundary>,
  );
}

describe('SchedulePage', () => {
  it("renders the day's appointments as rows with their window, client, practitioner, service, delivery and status", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/appointments?')) {
        return new Response(JSON.stringify({ appointments: [appointment] }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Iris Cliff' })).toBeTruthy());
    // The Arabic name sits beneath the Latin one, exactly as the clients table renders it.
    expect(screen.getByText('إيريس كليف')).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Cedar Ridge' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Standard session' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Home' })).toBeTruthy();
    expect(screen.getByText('Confirmed')).toBeTruthy();
    expect(screen.getByText('09:00–09:45', plainText)).toBeTruthy();
    expect(screen.getByText('1 appointment')).toBeTruthy();
  });

  it("opens the client's own drawer from the client link, beside the ledger", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/appointments?')) {
        return new Response(JSON.stringify({ appointments: [appointment] }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Iris Cliff' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Iris Cliff' }));

    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByRole('heading', { name: 'Iris Cliff' })).toBeTruthy();
    expect(within(drawer).getByText('إيريس كليف')).toBeTruthy();
  });

  it('Add appointment is a secondary action beside the heading, not a second primary button', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ appointments: [] }), { status: 200 }),
    ) as unknown as typeof fetch;

    renderPage(fetchImpl);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add appointment' })).toBeTruthy(),
    );
    expect(screen.getByRole('button', { name: 'Add appointment' }).className).not.toContain(
      'button--primary',
    );
  });

  it('shows the empty line in plain words when no appointments are booked', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ appointments: [] }), { status: 200 }),
    ) as unknown as typeof fetch;

    renderPage(fetchImpl);

    await waitFor(() =>
      expect(screen.getByText('No appointments are booked for this day.')).toBeTruthy(),
    );
  });

  it('offers Confirm on a visit the household has not been told about, and not on one it has', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/appointments?')) {
        return new Response(JSON.stringify({ appointments: [proposed, appointment] }), {
          status: 200,
        });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: "Confirm Juniper Valley's appointment" }),
      ).toBeTruthy(),
    );
    // The confirmed visit keeps Move and Call off and gains nothing: there is
    // nothing left to tell anybody.
    expect(screen.queryByRole('button', { name: "Confirm Iris Cliff's appointment" })).toBe(null);
    expect(screen.getByRole('button', { name: "Move Iris Cliff's appointment" })).toBeTruthy();
  });

  it('records the household as told and reloads the day', async () => {
    const calls: string[] = [];
    let confirmed = false;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.startsWith('/api/appointments?')) {
        return new Response(
          JSON.stringify({
            appointments: [confirmed ? { ...proposed, status: 'confirmed' } : proposed],
          }),
          { status: 200 },
        );
      }
      if (url === `/api/appointments/${proposed.id}/confirm`) {
        confirmed = true;
        return new Response(JSON.stringify({ id: proposed.id, status: 'confirmed' }), {
          status: 200,
        });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);

    const button = await screen.findByRole('button', {
      name: "Confirm Juniper Valley's appointment",
    });
    fireEvent.click(button);

    await waitFor(() => expect(screen.getByText('Confirmed')).toBeTruthy());
    expect(calls).toContain(`POST /api/appointments/${proposed.id}/confirm`);
    // Confirming asks nothing and takes nothing, so no reason travels with it.
    expect(screen.queryByRole('button', { name: "Confirm Juniper Valley's appointment" })).toBe(
      null,
    );
  });

  it('says plainly when a visit somebody else has already moved on cannot be confirmed', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/appointments?')) {
        return new Response(JSON.stringify({ appointments: [proposed] }), { status: 200 });
      }
      if (url === `/api/appointments/${proposed.id}/confirm`) {
        return new Response(
          JSON.stringify({ error: 'bad_request', code: 'appointment_not_proposed' }),
          {
            status: 400,
          },
        );
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    renderPage(fetchImpl);

    fireEvent.click(
      await screen.findByRole('button', { name: "Confirm Juniper Valley's appointment" }),
    );

    await waitFor(() =>
      expect(
        screen.getByText(
          'This visit is no longer waiting to be confirmed — it has been confirmed, moved or ' +
            'called off already. Reload the day to see where it stands.',
        ),
      ).toBeTruthy(),
    );
  });

  it('answers a failed load with a plain-words error, not a blank table', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('nope', { status: 500 }),
    ) as unknown as typeof fetch;

    renderPage(fetchImpl);

    await waitFor(() =>
      expect(
        screen.getByText("The day's appointments could not be loaded. Try again."),
      ).toBeTruthy(),
    );
  });
});
