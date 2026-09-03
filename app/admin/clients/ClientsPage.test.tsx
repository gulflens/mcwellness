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

function mount(matches: (typeof row)[] = []) {
  const urls: string[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
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
  return urls;
}

describe('ClientsPage search', () => {
  it('sends an Emirates ID as the search term, unchanged, and shows what it finds', async () => {
    const urls = mount([row]);
    await screen.findByRole('table');

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: EMIRATES_ID } });

    await waitFor(() =>
      expect(urls.some((u) => u === `/api/clients?q=${encodeURIComponent(EMIRATES_ID)}`)).toBe(
        true,
      ),
    );
    // The hashing is the server's (app/api/clients/list.ts, proved in
    // tests/client/db/identity.test.ts): the browser sends the digits it was given and
    // never reformats, splits or truncates them on the way.
    expect(await screen.findByRole('button', { name: 'Juniper Quarry' })).toBeTruthy();
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
