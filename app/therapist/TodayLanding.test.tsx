// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../shell/auth/AuthContext';
import type { AuthProvider } from '../shell/auth/types';
import { TodayLanding } from './TodayLanding';

afterEach(cleanup);

// Synthetic throughout, in the reserved ranges (.claude/rules/testing.md).
const ME = {
  userId: '00000002-0000-4000-8000-000000000009',
  displayName: 'Rowan Meadow',
  tenantId: '00000001-0000-4000-8000-000000000001',
  roles: ['admin'],
  capabilities: [],
};

const PRACTITIONER = { ...ME, roles: ['practitioner'] };
const CLIENT_CONTACT = { ...ME, roles: ['client_contact'] };

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => 'token',
  onChange: () => () => undefined,
};

function mount(me: unknown = ME) {
  const fetchImpl = vi.fn(
    async () => new Response(JSON.stringify(me), { status: 200 }),
  ) as unknown as typeof fetch;
  return render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <MemoryRouter initialEntries={['/today']}>
        <TodayLanding />
      </MemoryRouter>
    </AuthProviderBoundary>,
  );
}

describe('TodayLanding', () => {
  it('tells an account with no day of its own so, and offers the console when it has one', async () => {
    mount();
    await screen.findByText(/There is no day of visits for this account/);
    expect(screen.queryByRole('button', { name: 'Check in' })).toBeNull();
    expect(await screen.findByRole('button', { name: 'Admin console' })).toBeTruthy();
  });

  /**
   * The door to the base screen (the fix round of 2026-09-08; the operator's
   * instruction was "every practioner can add their own address"). As App.tsx
   * routes today a practitioner never reaches this screen — `canOpenToday`
   * sends them to the day sheet — so this is the same condition written on both
   * faces of `/today`, so neither loses the door if that routing changes.
   */
  it('offers someone who may set a base the way to it, and no console button', async () => {
    mount(PRACTITIONER);
    expect(await screen.findByRole('button', { name: 'Your home base' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Admin console' })).toBeNull();
  });

  it('offers an admin the console alone, never a second door beside it', async () => {
    mount();
    expect(await screen.findByRole('button', { name: 'Admin console' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Your home base' })).toBeNull();
  });

  it('offers a client contact neither door: no base to set, and no console', async () => {
    mount(CLIENT_CONTACT);
    await screen.findByText(/There is no day of visits for this account/);
    expect(screen.queryByRole('button', { name: 'Your home base' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Admin console' })).toBeNull();
  });
});
