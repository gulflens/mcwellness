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
