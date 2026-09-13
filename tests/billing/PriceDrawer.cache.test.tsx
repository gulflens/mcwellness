// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PriceDrawer } from '../../app/admin/billing/PriceDrawer';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import type { AuthProvider } from '../../app/shell/auth/types';
import { forgetReferences } from '../../app/shell/referenceCache';

afterEach(() => {
  cleanup();
  forgetReferences();
});

/**
 * The second open of a drawer costs no request for the lists it needs
 * (app/shell/referenceCache.ts; the usability pass of 2026-09-14).
 *
 * Under one auth provider, as the console runs: the provider is mounted once
 * at sign-in and every drawer opens and closes beneath it, so `apiFetch` is one
 * function for the session and the cache — keyed by it — is a session's. A
 * test that remounts the provider per render would get a fresh cache each
 * time and prove nothing, which is why this one keeps the provider and
 * toggles only the drawer.
 */

const OWNER = {
  userId: '00000002-0000-4000-8000-000000000031',
  displayName: 'Hazel Harbour',
  tenantId: '00000001-0000-4000-8000-000000000001',
  roles: ['owner', 'admin', 'finance'],
  capabilities: [],
  preferredLocale: 'en',
};

const SERVICE_TYPES = {
  serviceTypes: [
    {
      id: '00000004-0000-4000-8000-000000000005',
      code: 'nf-session',
      name: 'Neurofeedback session',
      nameAr: null,
    },
  ],
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

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen((was) => !was)}>
        {open ? 'Close the drawer' : 'Open the drawer'}
      </button>
      {open ? (
        <PriceDrawer onClose={() => setOpen(false)} onCreated={() => {}} currentPrices={[]} />
      ) : null}
    </>
  );
}

describe('the price drawer and the reference cache', () => {
  it('asks for the service types once, however many times it is opened', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/me') return json(OWNER);
      if (url === '/api/billing/service-types') return json(SERVICE_TYPES);
      if (url.startsWith('/api/billing/vat-rate')) return json({ error: 'not_found' }, 404);
      return json({ error: 'not_found' }, 404);
    }) as unknown as typeof fetch;

    render(
      <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
        <Harness />
      </AuthProviderBoundary>,
    );
    await screen.findByRole('button', { name: 'Open the drawer' });

    const serviceTypeCalls = () =>
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([input]) => String(input) === '/api/billing/service-types',
      ).length;

    // First open: the list is fetched, and the select fills from it.
    fireEvent.click(screen.getByRole('button', { name: 'Open the drawer' }));
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Neurofeedback session' })).toBeTruthy(),
    );
    expect(serviceTypeCalls()).toBe(1);

    // Closed and opened again: the select fills again, from memory.
    fireEvent.click(screen.getByRole('button', { name: 'Close the drawer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open the drawer' }));
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Neurofeedback session' })).toBeTruthy(),
    );
    expect(serviceTypeCalls()).toBe(1);
  });
});
