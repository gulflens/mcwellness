// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../../shell/auth/AuthContext';
import type { AuthProvider } from '../../shell/auth/types';
import { ClientsPage } from './ClientsPage';

afterEach(cleanup);

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => null,
  onChange: () => () => undefined,
};

/** The reserved synthetic range (.claude/rules/testing.md), with its own check digit. */
const EMIRATES_ID = '784-1900-0000013-4';

const row = {
  id: '00000008-0000-4000-8000-0000000000a1',
  mrn: 'MW-000031',
  givenName: 'Juniper',
  familyName: 'Quarry',
  givenNameAr: null,
  familyNameAr: null,
  age: 41,
  status: 'active' as const,
  contact: { relationship: 'self', phone: '+971500000031' },
  emirate: 'DXB',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mount(matches: (typeof row)[] = [], lookupStatus = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === '/api/clients/lookup') {
      return lookupStatus === 200
        ? json({ clients: matches, note: null })
        : json({ error: 'emirates_id_unavailable' }, lookupStatus);
    }
    if (url.startsWith('/api/clients')) {
      const q = new URL(url, 'http://localhost').searchParams.get('q');
      return json({ clients: q ? matches : [], note: null });
    }
    return json({ error: 'not_found' }, 404);
  }) as unknown as typeof fetch;
  render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <ClientsPage />
    </AuthProviderBoundary>,
  );
  return calls;
}

describe('ClientsPage search', () => {
  it('looks an Emirates ID up through the body, never through the address', async () => {
    const calls = mount([row]);
    await screen.findByRole('table');

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: EMIRATES_ID } });

    await waitFor(() => expect(calls.some((c) => c.url === '/api/clients/lookup')).toBe(true));
    const lookup = calls.find((c) => c.url === '/api/clients/lookup');
    expect(lookup?.init?.method).toBe('POST');
    // Normalised to its fifteen digits, and nowhere near a query string
    // (.claude/rules/ui.md: no personal data in a URL). The hashing is the server's,
    // proved in tests/client/db/identity.test.ts.
    expect(JSON.parse(String(lookup?.init?.body))).toEqual({
      emiratesId: EMIRATES_ID.replace(/-/g, ''),
    });
    expect(calls.every((c) => !c.url.includes('784'))).toBe(true);
    expect(await screen.findByRole('button', { name: 'Juniper Quarry' })).toBeTruthy();
  });

  it('searches names and record numbers through the ordinary query', async () => {
    const calls = mount([row]);
    await screen.findByRole('table');

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'Juniper' } });

    await waitFor(() => expect(calls.some((c) => c.url === '/api/clients?q=Juniper')).toBe(true));
    expect(calls.every((c) => c.url !== '/api/clients/lookup')).toBe(true);
  });

  it('says an installation without identity keys cannot search by Emirates ID', async () => {
    mount([], 503);
    await screen.findByRole('table');

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: EMIRATES_ID } });

    expect(
      await screen.findByText(
        'Searching by Emirates ID is not set up on this installation yet. Search by name or record number.',
      ),
    ).toBeTruthy();
  });

  it('offers the enrolment wizard from the page header, and closes it again', async () => {
    mount();
    await screen.findByRole('table');

    fireEvent.click(screen.getByRole('button', { name: 'Enrol a client' }));
    expect(screen.getByRole('dialog', { name: 'Enrolment' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Enrolment' })).toBeNull());
  });
});
