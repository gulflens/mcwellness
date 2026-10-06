// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HelperPage } from '../../app/therapist/location/HelperPage';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import type { AuthProvider } from '../../app/shell/auth/types';
import { homeFor } from '../../app/shell/routing';

/**
 * A helper's one page, "Share my location while I help" (docs/SPEC/
 * dispatch.md section 15.12): the notice the first time, the switch, the
 * practitioner they go with by first name, and whether sharing is live now —
 * and nothing else of the practice. Every id is synthetic and every name from
 * db/seed/names.ts.
 */

afterEach(cleanup);

const ME = {
  userId: '00000002-0000-4000-8000-000000007921',
  displayName: 'Juniper Vale',
  tenantId: '00000001-0000-4000-8000-000000000001',
  roles: ['helper'],
  capabilities: [],
};

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => 'token',
  onChange: () => () => undefined,
};

type Status = {
  eligible: boolean;
  noticeVersion: string;
  consent: { noticeVersion: string; givenAt: string } | null;
  sharingOn: boolean;
  shiftOpen: boolean;
  accompanies: string | null;
};

const FIRST_TIME: Status = {
  eligible: true,
  noticeVersion: '1.1',
  consent: null,
  sharingOn: false,
  shiftOpen: true,
  accompanies: 'Basil',
};
const AGREED = { noticeVersion: '1.1', givenAt: '2026-10-06T06:00:00.000Z' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mount(initial: Status) {
  const server = { status: { ...initial } };
  const asked: string[] = [];
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    asked.push(url);
    if (url === '/api/me') return json(ME);
    if (url === '/api/location/me') return json(server.status);
    if (url === '/api/location/consent' && init?.method === 'POST') {
      server.status = { ...server.status, consent: AGREED, sharingOn: true };
      return new Response(null, { status: 204 });
    }
    if (url === '/api/location/sharing') {
      const body = JSON.parse(String(init?.body)) as { on: boolean };
      server.status = { ...server.status, sharingOn: body.on };
      return new Response(null, { status: 204 });
    }
    if (url === '/api/location/positions') return new Response(null, { status: 204 });
    return json({ error: 'forbidden' }, 403);
  });
  render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <MemoryRouter initialEntries={['/help']}>
        <HelperPage geolocation={null} />
      </MemoryRouter>
    </AuthProviderBoundary>,
  );
  return { server, asked };
}

describe('where a helper lands', () => {
  it('sends a helper to their one page after sign-in', () => {
    expect(homeFor({ roles: ['helper'] })).toBe('/help');
  });
});

describe('HelperPage', () => {
  it('names the page, the practitioner by first name, and that nothing is shared yet', async () => {
    mount(FIRST_TIME);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Share my location while I help' }),
    ).toBeTruthy();
    expect(await screen.findByText('You are helping Basil.')).toBeTruthy();
    expect(screen.getByText('Your location is not being shared now.')).toBeTruthy();
  });

  it('shows the notice the first time, and shares once the helper agrees', async () => {
    const { server } = mount(FIRST_TIME);
    fireEvent.click(await screen.findByRole('switch', { name: 'Share my location while I help' }));
    const notice = await screen.findByRole('region', { name: 'Before you share your location' });
    fireEvent.click(within(notice).getByRole('button', { name: 'I agree, share my location' }));
    await waitFor(() => expect(server.status.sharingOn).toBe(true));
    expect(await screen.findByText('Your location is being shared now.')).toBeTruthy();
    expect(
      screen.getByText('You are sharing your location with the office while you help.'),
    ).toBeTruthy();
  });

  it('says sharing is not live outside the working day, with the switch on', async () => {
    mount({ ...FIRST_TIME, consent: AGREED, sharingOn: true, shiftOpen: false });
    expect(await screen.findByText('Your location is not being shared now.')).toBeTruthy();
    expect(
      screen.getByText('Nothing is sent outside the working day of the practitioner you help.'),
    ).toBeTruthy();
  });

  it('tells a helper who goes with nobody so, and offers no switch', async () => {
    mount({ ...FIRST_TIME, eligible: false, accompanies: null });
    expect(
      await screen.findByText(
        'You are not helping anybody at the moment. The practice names whom you go with.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('asks the API for nothing but who they are and their own location', async () => {
    const { asked } = mount(FIRST_TIME);
    await screen.findByText('You are helping Basil.');
    expect(new Set(asked)).toEqual(new Set(['/api/me', '/api/location/me']));
  });

  it('has nothing else on it: no client, no visit, no money, no navigation', async () => {
    mount(FIRST_TIME);
    await screen.findByText('You are helping Basil.');
    expect(screen.queryByRole('navigation')).toBeNull();
    const buttons = screen.getAllByRole('button').map((button) => button.textContent);
    expect(buttons.sort()).toEqual(['Sign out']);
    const links = screen.queryAllByRole('link').map((link) => link.textContent);
    expect(links).toEqual(['Change my password']);
  });
});
