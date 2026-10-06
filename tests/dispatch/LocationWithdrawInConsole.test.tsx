// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminLayout } from '../../app/shell/AdminLayout';
import { LocationSharing } from '../../app/therapist/location/LocationSharing';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import type { AuthProvider } from '../../app/shell/auth/types';

/**
 * Withdrawal from the console (docs/SPEC/dispatch.md section 15.11): somebody
 * moved to an admin-only role lands in the console, not on Today, and the
 * notice promises they can always withdraw. Names from db/seed/names.ts; ids
 * in the reserved shape.
 */

afterEach(cleanup);

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => 'token',
  onChange: () => () => undefined,
};

const AGREED = { noticeVersion: '1.1', givenAt: '2026-10-06T06:00:00.000Z' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function server(roles: string[], status: Record<string, unknown>) {
  const state = { status: { ...status } };
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/me') {
      return json({
        userId: '00000002-0000-4000-8000-000000000010',
        displayName: 'Hazel Harbour',
        tenantId: '00000001-0000-4000-8000-000000000001',
        roles,
        capabilities: [],
      });
    }
    if (url === '/api/location/me') return json(state.status);
    if (url === '/api/location/consent/withdraw') {
      state.status = { ...state.status, consent: null, sharingOn: false };
      return new Response(null, { status: 204 });
    }
    return json({ error: 'not_found' }, 404);
  });
  return fetchImpl;
}

describe('withdrawal from the console', () => {
  it('lets somebody in an admin-only role with a standing consent withdraw it', async () => {
    const fetchImpl = server(['admin'], {
      eligible: false,
      noticeVersion: '1.1',
      consent: AGREED,
      sharingOn: true,
      shiftOpen: false,
    });
    render(
      <MemoryRouter initialEntries={['/admin/clients']}>
        <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl as unknown as typeof fetch}>
          <Routes>
            <Route path="/admin" element={<AdminLayout actorName="Hazel Harbour" />}>
              <Route path="clients" element={<p>Clients</p>} />
            </Route>
          </Routes>
        </AuthProviderBoundary>
      </MemoryRouter>,
    );
    expect(await screen.findByText('This account can no longer share its location.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw my agreement' }));
    await waitFor(() =>
      expect(
        fetchImpl.mock.calls.some(([url]) => String(url) === '/api/location/consent/withdraw'),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(screen.queryByText('This account can no longer share its location.')).toBeNull(),
    );
  });

  it('shows an eligible lead nothing in the console, and never reads their position there', async () => {
    const fetchImpl = server(['lead_practitioner'], {
      eligible: true,
      noticeVersion: '1.1',
      consent: AGREED,
      sharingOn: true,
      shiftOpen: true,
    });
    const geolocation = { getCurrentPosition: vi.fn() };
    render(
      <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl as unknown as typeof fetch}>
        <LocationSharing withdrawOnly geolocation={geolocation} />
      </AuthProviderBoundary>,
    );
    await waitFor(() =>
      expect(fetchImpl.mock.calls.some(([url]) => String(url) === '/api/location/me')).toBe(true),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText(/sharing/i)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
  });
});
