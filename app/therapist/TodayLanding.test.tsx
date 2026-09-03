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

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => 'token',
  onChange: () => () => undefined,
};

function mount() {
  const fetchImpl = vi.fn(
    async () => new Response(JSON.stringify(ME), { status: 200 }),
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
});
