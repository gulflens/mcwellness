// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

/** What GET /api/practice answers on this synthetic practice. */
const PRACTICE = {
  legalName: 'Synthetic Wellness Studio',
  legalNameAr: null,
  taxRegistrationNumber: null,
  licenceNumber: null,
  licensingAuthority: null,
  licenceExpiresOn: null,
  vatRegistered: false,
  vatTrn: null,
  // The VAT threshold watch (migration 953): well below both marks.
  vatTaxableSuppliesFils: 4_200_000,
  vatTaxableSuppliesAsOf: '2026-09-06',
  // What the client portal's ask-for-a-visit button opens (migration 910).
  whatsappNumber: null,
  defaultEmirate: 'DXB',
  timezone: 'Asia/Dubai',
  address: null,
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
    if (url === '/api/billing/prices') return json({ prices: [], vatRegistered: false });
    if (url === '/api/practice') return json({ practice: PRACTICE });
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

  it('lets an admin reach the week, behind the same rule as the day', async () => {
    mount(ADMIN, '/admin/schedule/week');
    expect(await screen.findByRole('heading', { name: 'Week' })).toBeTruthy();
  });

  it('sends a practitioner home instead of the week', async () => {
    mount(PRACTITIONER, '/admin/schedule/week');
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Week' })).toBeNull();
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

describe('App — /admin/settings/practice', () => {
  it('lets an admin reach the practice settings', async () => {
    mount(ADMIN, '/admin/settings/practice');
    expect(await screen.findByRole('heading', { name: 'Practice' })).toBeTruthy();
  });

  it('sends a lead practitioner to their own desk instead', async () => {
    mount(LEAD_PRACTITIONER, '/admin/settings/practice');
    // practice.settings.write is the owner's and an admin's alone: what a tax
    // invoice says the supplier is, is not a clinical decision.
    expect(await screen.findByRole('heading', { name: 'Clients' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Practice' })).toBeNull();
  });

  it('sends finance to their own desk instead', async () => {
    mount(FINANCE, '/admin/settings/practice');
    expect(await screen.findByRole('heading', { name: 'Clients' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Practice' })).toBeNull();
  });

  it('shows an admin the Settings link', async () => {
    mount(ADMIN, '/admin/clients');
    expect(await screen.findByRole('link', { name: 'Settings' })).toHaveProperty(
      'href',
      expect.stringContaining('/admin/settings/practice'),
    );
  });

  it('takes the rest of the console out of reach while the drawer is open', async () => {
    // The drawer's `inert` used to be a no-op: it read document.body.children,
    // and the app renders inside #root, so nothing behind it was ever marked
    // and a rail link could take focus from an open drawer (design review,
    // round 20). jsdom implements `inert` as a property and not as behaviour,
    // so the mechanism is asserted directly, and the focus cycle beside it.
    mount(ADMIN, '/admin/settings/practice');
    const edit = await screen.findByRole('button', { name: 'Edit details' });
    // Disabled until the details land: pressing it before then does nothing.
    await waitFor(() => expect(edit).toHaveProperty('disabled', false));
    fireEvent.click(edit);
    const drawer = await screen.findByRole('dialog', { name: 'Practice details' });

    const rail = document.querySelector<HTMLElement>('.rail');
    const main = document.querySelector<HTMLElement>('.admin__main');
    expect(rail?.inert).toBe(true);
    // The drawer's own ancestors stay live, or the drawer would be inert too.
    expect(main?.inert).toBeFalsy();
    expect(drawer.inert).toBeFalsy();
    // Everything else on the page behind it is not.
    expect(document.querySelector<HTMLElement>('.page__header')?.inert).toBe(true);
    expect(document.querySelector<HTMLElement>('.practice')?.inert).toBe(true);

    // Tab does not walk out of the drawer.
    const close = screen.getByRole('button', { name: 'Close' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(drawer.contains(document.activeElement)).toBe(true);

    // And it all comes back when the drawer closes.
    fireEvent.keyDown(document, { key: 'Escape' });
    await screen.findByRole('button', { name: 'Edit details' });
    expect(rail?.inert).toBeFalsy();
    expect(document.querySelector<HTMLElement>('.practice')?.inert).toBeFalsy();
  });

  it('never offers finance a Settings link its own route would refuse', async () => {
    mount(FINANCE, '/admin/clients');
    await screen.findByRole('link', { name: 'Billing' });
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull();
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
    await screen.findByText('Nothing is booked for you today.');
    expect(screen.queryByRole('button', { name: 'Admin console' })).toBeNull();
  });

  it('offers a lead practitioner the way back to the console from Today', async () => {
    mount(LEAD_PRACTITIONER, '/today');
    expect(await screen.findByRole('button', { name: 'Admin console' })).toBeTruthy();
  });
});

describe('App — /today is the day sheet for someone who treats', () => {
  it('shows a practitioner their day, not the landing', async () => {
    mount(PRACTITIONER, '/today');
    await screen.findByText('Nothing is booked for you today.');
    expect(screen.queryByText(/There is no day of visits for this account/)).toBeNull();
  });

  it('keeps the landing for an admin-only account that types the address', async () => {
    mount(ADMIN, '/today');
    await screen.findByText(/There is no day of visits for this account/);
    expect(screen.queryByText('Nothing is booked for you today.')).toBeNull();
  });
});
