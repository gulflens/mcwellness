// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BoardResponse } from '../../app/api/appointments/schema';
import type { SharedPositionsResponse } from '../../app/api/location/schema';
import { BoardPage } from '../../app/admin/schedule/board/BoardPage';
import { DayMap } from '../../app/admin/schedule/map/DayMap';
import { describeHelperPosition, helperMapLabel } from '../../app/admin/schedule/board/positions';
import { practiceDay } from '../../app/admin/schedule/windows';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import type { AuthProvider } from '../../app/shell/auth/types';
import { fakeGoogleMaps } from '../scheduling/fakeGoogleMaps';

/**
 * A helper's position on the board and the day map (docs/SPEC/dispatch.md
 * section 15.12): marked as a helper's, by first name, beside the
 * practitioner they accompany — never a row of their own, never a stop.
 * Names from db/seed/names.ts; ids in the reserved shape.
 */

afterEach(cleanup);

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => 'token',
  onChange: () => () => undefined,
};

const CEDAR = '00000008-0000-4000-8000-000000000012';
const SAGE = '00000008-0000-4000-8000-000000000014';

const HELPER_FIX = {
  accompaniesPractitionerId: CEDAR,
  firstName: 'Juniper',
  latitude: 25.21,
  longitude: 55.28,
  accuracyMetres: 9,
  recordedAt: new Date().toISOString(),
  ageMinutes: 3,
};

const POSITIONS: SharedPositionsResponse = { positions: [], helpers: [HELPER_FIX] };

function board(date: string): BoardResponse {
  return {
    date,
    latenessAvailable: true,
    practitioners: [
      { practitionerId: CEDAR, displayName: 'Cedar Ridge', active: true, visits: [] },
      { practitionerId: SAGE, displayName: 'Sage Harbour', active: true, visits: [] },
    ],
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mountBoard(date: string) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/me') {
      return json({
        userId: '00000002-0000-4000-8000-000000000010',
        displayName: 'Hazel Harbour',
        tenantId: '00000001-0000-4000-8000-000000000001',
        roles: ['admin'],
        capabilities: [],
      });
    }
    if (url.startsWith('/api/appointments/board')) return json(board(date));
    if (url === '/api/location/positions') return json(POSITIONS);
    return json({ error: 'not_found' }, 404);
  });
  render(
    <MemoryRouter initialEntries={[`/admin/schedule/board?date=${date}`]}>
      <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl as unknown as typeof fetch}>
        <Routes>
          <Route path="/admin/schedule/board" element={<BoardPage />} />
        </Routes>
      </AuthProviderBoundary>
    </MemoryRouter>,
  );
}

describe('describeHelperPosition', () => {
  it('marks the line as a helper’s, by first name, with its age and how sure it is', () => {
    expect(describeHelperPosition(HELPER_FIX)).toBe(
      'Helper Juniper: location shared 3 min ago, within 9 m',
    );
  });

  it('labels the map pin the same way', () => {
    expect(helperMapLabel(HELPER_FIX)).toBe('Helper Juniper, last shared 3 min ago');
  });
});

describe('a helper on the board', () => {
  it('shows beside the practitioner they accompany, marked as a helper', async () => {
    mountBoard(practiceDay(new Date()));
    const row = await screen.findByRole('region', { name: 'Cedar Ridge' });
    expect(
      await within(row).findByText('Helper Juniper: location shared 3 min ago, within 9 m'),
    ).toBeTruthy();
    // The practitioner's own line still says what is true of them.
    expect(within(row).getByText(/Not sharing now/)).toBeTruthy();
  });

  it('is not shown beside anybody else, and has no row of their own', async () => {
    mountBoard(practiceDay(new Date()));
    const other = await screen.findByRole('region', { name: 'Sage Harbour' });
    expect(within(other).queryByText(/Helper Juniper/)).toBeNull();
    expect(screen.queryByRole('region', { name: /Juniper/ })).toBeNull();
  });
});

describe('a helper on the day map', () => {
  const day = {
    practitionerId: CEDAR,
    homeBase: null,
    stops: [
      {
        appointmentId: 'a1',
        locationId: 'l1',
        point: { lat: 25.3, lng: 55.3 },
        windowStart: '2026-09-10T05:00:00.000Z',
        windowEnd: '2026-09-10T05:45:00.000Z',
        status: 'confirmed' as const,
      },
    ],
    legs: [],
  };

  it('is drawn as a labelled pin of its own beside the practitioner’s, never a stop', () => {
    const state = fakeGoogleMaps();
    render(
      <DayMap
        maps={state.maps}
        day={day}
        selectedId={null}
        onSelect={() => undefined}
        here={{ point: { lat: 25.25, lng: 55.29 }, label: 'Last shared 4 min ago' }}
        alongside={[{ point: { lat: 25.21, lng: 55.28 }, label: helperMapLabel(HELPER_FIX) }]}
      />,
    );
    expect(screen.getByRole('img', { name: 'Helper Juniper, last shared 3 min ago' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Last shared 4 min ago' })).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('does not refit the map when a helper’s position arrives', () => {
    const state = fakeGoogleMaps();
    const props = { maps: state.maps, day, selectedId: null, onSelect: () => undefined };
    const { rerender } = render(<DayMap {...props} />);
    const fitted = state.fitted;
    rerender(
      <DayMap
        {...props}
        alongside={[{ point: { lat: 25.21, lng: 55.28 }, label: helperMapLabel(HELPER_FIX) }]}
      />,
    );
    expect(state.fitted).toBe(fitted);
  });
});
