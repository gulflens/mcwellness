// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from './auth/AuthContext';
import type { AuthProvider } from './auth/types';
import { App } from './App';

afterEach(cleanup);

// Synthetic throughout, in the reserved ranges (.claude/rules/testing.md).
const TENANT_ID = '00000001-0000-4000-8000-000000000001';

const PRACTITIONER = {
  userId: '00000002-0000-4000-8000-000000000009',
  displayName: 'Rowan Meadow',
  tenantId: TENANT_ID,
  roles: ['practitioner'],
  capabilities: [],
};

const LEAD_PRACTITIONER = {
  userId: '00000002-0000-4000-8000-000000000011',
  displayName: 'Sami Osei',
  tenantId: TENANT_ID,
  roles: ['lead_practitioner'],
  capabilities: [],
};

const ADMIN = {
  userId: '00000002-0000-4000-8000-000000000010',
  displayName: 'Hazel Harbour',
  tenantId: TENANT_ID,
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mount(me: unknown, path = '/today/check-in') {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/me') return json(me);
    if (url === '/api/sessions/service-types') return json({ serviceTypes: [] });
    if (url.startsWith('/api/clients')) return json({ clients: [], note: null });
    return json({ error: 'not_found', requestId: null }, 404);
  }) as unknown as typeof fetch;

  return render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </AuthProviderBoundary>,
  );
}

describe('App — /today/check-in', () => {
  it('lets a practitioner reach the check-in screen', async () => {
    mount(PRACTITIONER);
    expect(await screen.findByRole('heading', { name: 'Check in' })).toBeTruthy();
  });

  it('lets a lead practitioner reach the check-in screen', async () => {
    mount(LEAD_PRACTITIONER);
    expect(await screen.findByRole('heading', { name: 'Check in' })).toBeTruthy();
  });

  it('sends an admin-only account to their own desk instead', async () => {
    mount(ADMIN);
    // Landed on the admin console (Clients), never the check-in screen.
    expect(await screen.findByRole('heading', { name: 'Clients' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Check in' })).toBeNull();
  });
});
