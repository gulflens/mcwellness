// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppointmentRow } from '../../app/api/appointments/schema';
import { WeekPage } from '../../app/admin/schedule/WeekPage';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import type { AuthProvider } from '../../app/shell/auth/types';

afterEach(cleanup);

/**
 * The week, read only (docs/SPEC/scheduling-manual.md sections 4.1 and 5.2):
 * seven days across, the same facts the day's own rows carry, and nothing on
 * it that changes a visit.
 */

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => null,
  onChange: () => () => undefined,
};

// Thursday 10 September 2026; the week it falls in runs Monday the 7th to
// Sunday the 13th.
const ANCHOR = '2026-09-10';
const MONDAY = '2026-09-07';
const SUNDAY = '2026-09-13';

function appointmentOn(date: string, id: string): AppointmentRow {
  return {
    id,
    windowStart: `${date}T05:00:00.000Z`,
    windowEnd: `${date}T05:45:00.000Z`,
    status: 'confirmed',
    deliveryMode: 'home',
    client: {
      id: '0000000b-0000-4000-8000-000000000001',
      givenName: 'Iris',
      familyName: 'Cliff',
      givenNameAr: 'إيريس',
      familyNameAr: 'كليف',
    },
    practitioner: { id: '0000000b-0000-4000-8000-000000000002', displayName: 'Cedar Ridge' },
    serviceType: { id: '0000000b-0000-4000-8000-000000000003', name: 'Standard session' },
    location: { id: '0000000b-0000-4000-8000-000000000004', label: 'home', emirate: 'DXB' },
  };
}

/** One appointment on the anchor day and nothing on the other six. */
function week(): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    const date = url.searchParams.get('date');
    const appointments =
      date === ANCHOR ? [appointmentOn(ANCHOR, '0000000b-0000-4000-8000-000000000101')] : [];
    return new Response(JSON.stringify({ appointments }), { status: 200 });
  }) as unknown as typeof fetch;
}

function renderWeek(fetchImpl: typeof fetch, date = ANCHOR) {
  return render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <MemoryRouter initialEntries={[`/admin/schedule/week?date=${date}`]}>
        <WeekPage />
      </MemoryRouter>
    </AuthProviderBoundary>,
  );
}

function datesAsked(fetchImpl: typeof fetch): string[] {
  const calls = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  return calls
    .map((call) => new URL(String(call[0]), 'http://localhost').searchParams.get('date'))
    .filter((date): date is string => date !== null)
    .sort();
}

describe('WeekPage', () => {
  it('asks for the seven days of the week the chosen day falls in, Monday first', async () => {
    const fetchImpl = week();
    renderWeek(fetchImpl);
    await screen.findByText('1 appointment');
    const asked = datesAsked(fetchImpl);
    expect(asked).toHaveLength(7);
    expect(asked[0]).toBe(MONDAY);
    expect(asked[6]).toBe(SUNDAY);
  });

  it("carries the same facts a day's own row carries", async () => {
    renderWeek(week());
    expect(await screen.findByText('Iris Cliff')).toBeTruthy();
    expect(screen.getByText('09:00–09:45')).toBeTruthy();
    expect(screen.getByText('Cedar Ridge')).toBeTruthy();
    expect(screen.getByText('Standard session, Home')).toBeTruthy();
    expect(screen.getByText('Confirmed')).toBeTruthy();
    // And the Arabic name, in its own script and direction, as every other
    // screen in the console renders it.
    const arabic = screen.getByText('إيريس كليف');
    expect(arabic.getAttribute('lang')).toBe('ar');
    expect(arabic.getAttribute('dir')).toBe('rtl');
  });

  it('says plainly which days hold nothing', async () => {
    renderWeek(week());
    await screen.findByText('Iris Cliff');
    // Six of the seven, in this fixture.
    expect(screen.getAllByText('Nothing booked.')).toHaveLength(6);
  });

  it('offers no way to change a visit: it is a week to look at', async () => {
    renderWeek(week());
    await screen.findByText('Iris Cliff');
    expect(screen.queryByRole('button', { name: /^Move/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Call off/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add appointment' })).toBeNull();
  });

  it('moves a week at a time, and hands a day back to the day view', async () => {
    const fetchImpl = week();
    renderWeek(fetchImpl);
    await screen.findByText('1 appointment');

    expect(screen.getByRole('link', { name: 'Back to the day' }).getAttribute('href')).toBe(
      `/admin/schedule?date=${ANCHOR}`,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
    await waitFor(() => {
      expect(datesAsked(fetchImpl)).toContain('2026-09-20');
    });
  });
});
