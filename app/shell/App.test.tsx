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

const FINANCE = {
  userId: '00000002-0000-4000-8000-000000000012',
  displayName: 'Priya Nair',
  tenantId: TENANT_ID,
  roles: ['finance'],
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
    if (url === '/api/billing/prices') return json({ prices: [] });
    if (url.startsWith('/api/appointments')) return json({ appointments: [] });
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

describe('App — /admin/billing and /admin/schedule', () => {
  it('lets an admin reach the price list', async () => {
    mount(ADMIN, '/admin/billing');
    expect(await screen.findByRole('heading', { name: 'Billing' })).toBeTruthy();
  });

  it('lets an admin reach the day schedule', async () => {
    mount(ADMIN, '/admin/schedule');
    expect(await screen.findByRole('heading', { name: 'Schedule' })).toBeTruthy();
  });

  it("shows the rail's Billing and Schedule links for an admin", async () => {
    mount(ADMIN, '/admin/clients');
    expect(await screen.findByRole('link', { name: 'Billing' })).toHaveProperty(
      'href',
      expect.stringContaining('/admin/billing'),
    );
    expect(screen.getByRole('link', { name: 'Schedule' })).toHaveProperty(
      'href',
      expect.stringContaining('/admin/schedule'),
    );
  });

  it('sends a practitioner home instead of the price list', async () => {
    mount(PRACTITIONER, '/admin/billing');
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Billing' })).toBeNull();
  });

  it('sends a practitioner home instead of the day schedule', async () => {
    mount(PRACTITIONER, '/admin/schedule');
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Schedule' })).toBeNull();
  });

  it('lets finance reach the price list', async () => {
    mount(FINANCE, '/admin/billing');
    expect(await screen.findByRole('heading', { name: 'Billing' })).toBeTruthy();
  });

  it('sends finance to their own desk instead of the day schedule', async () => {
    mount(FINANCE, '/admin/schedule');
    // billing.price.read admits finance, but appointment.list's practice
    // scope does not — canOpenSchedule refuses, so homeFor lands them on
    // the admin desk (Clients), not the schedule they cannot read.
    expect(await screen.findByRole('heading', { name: 'Clients' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Schedule' })).toBeNull();
  });

  it('shows finance the Billing link but not the Schedule link', async () => {
    mount(FINANCE, '/admin/clients');
    expect(await screen.findByRole('link', { name: 'Billing' })).toHaveProperty(
      'href',
      expect.stringContaining('/admin/billing'),
    );
    expect(screen.queryByRole('link', { name: 'Schedule' })).toBeNull();
  });
});

describe('App — the way across to the practitioner side', () => {
  it('shows a lead practitioner the Today link in the console rail', async () => {
    mount(LEAD_PRACTITIONER, '/admin/clients');
    const link = await screen.findByRole('link', { name: 'Today' });
    expect(link).toHaveProperty('href', expect.stringContaining('/today'));
  });

  it('never shows an admin-only account a Today link it could not open', async () => {
    mount(ADMIN, '/admin/clients');
    await screen.findByRole('link', { name: 'Clients' });
    expect(screen.queryByRole('link', { name: 'Today' })).toBeNull();
  });

  it('shows a practitioner-only account no way into the console from Today', async () => {
    mount(PRACTITIONER, '/today');
    await screen.findByRole('button', { name: 'Check in' });
    expect(screen.queryByRole('button', { name: 'Admin console' })).toBeNull();
  });

  it('offers a lead practitioner the way back to the console from Today', async () => {
    mount(LEAD_PRACTITIONER, '/today');
    expect(await screen.findByRole('button', { name: 'Admin console' })).toBeTruthy();
  });
});
