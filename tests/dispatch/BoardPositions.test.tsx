// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BoardResponse } from '../../app/api/appointments/schema';
import type { SharedPositionsResponse } from '../../app/api/location/schema';
import { BoardPage } from '../../app/admin/schedule/board/BoardPage';
import { practiceDay } from '../../app/admin/schedule/windows';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import type { AuthProvider } from '../../app/shell/auth/types';

/**
 * Where they are, on the board (docs/SPEC/dispatch.md section 15): each
 * sharing person's last position, with how old it is, and "Not sharing now" for
 * everybody else; only on today's board. Names from db/seed/names.ts; ids in
 * the reserved shape.
 */

afterEach(cleanup);

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => 'token',
  onChange: () => () => undefined,
};

const CEDAR = '00000008-0000-4000-8000-000000000002';
const SAGE = '00000008-0000-4000-8000-000000000004';

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

const POSITIONS: SharedPositionsResponse = {
  positions: [
    {
      practitionerId: CEDAR,
      latitude: 25.2,
      longitude: 55.27,
      accuracyMetres: 12,
      recordedAt: new Date().toISOString(),
      ageMinutes: 4,
    },
  ],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mount(date: string) {
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
  return fetchImpl;
}

describe('where they are, on the board', () => {
  it("shows a sharing person's last position with how old it is, and the way to the map", async () => {
    const today = practiceDay(new Date());
    mount(today);
    const row = await screen.findByRole('region', { name: 'Cedar Ridge' });
    expect(await within(row).findByText(/Location shared 4 min ago, within 12 m/)).toBeTruthy();
    const link = within(row).getByRole('link', { name: 'See it on the day map' });
    expect(link.getAttribute('href')).toBe(`/admin/schedule/map?date=${today}`);
  });

  it('says "Not sharing now" for somebody who is not sharing, rather than pretending to know', async () => {
    mount(practiceDay(new Date()));
    const row = await screen.findByRole('region', { name: 'Sage Harbour' });
    expect(await within(row).findByText('Not sharing now')).toBeTruthy();
    expect(within(row).queryByRole('link')).toBeNull();
  });

  it('asks for nothing and shows nothing on the board of another day', async () => {
    const fetchImpl = mount('2026-09-04');
    await screen.findByRole('region', { name: 'Cedar Ridge' });
    expect(screen.queryByText(/Location shared|Not sharing now/)).toBeNull();
    expect(fetchImpl.mock.calls.some(([url]) => String(url) === '/api/location/positions')).toBe(
      false,
    );
  });
});
