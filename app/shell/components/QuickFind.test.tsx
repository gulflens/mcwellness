// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../auth/AuthContext';
import type { AuthProvider } from '../auth/types';
import { QuickFind, matchSections } from './QuickFind';
import { ADMIN_SECTIONS } from './Rail';

afterEach(cleanup);

/**
 * Quick-find: sections the person may open, and clients through the same
 * list route the Clients page searches. Synthetic throughout.
 */

const CLIENT_ID = '00000008-0000-4000-8000-0000000000f3';

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => 'token',
  onChange: () => () => undefined,
};

function clientList() {
  return {
    clients: [
      {
        id: CLIENT_ID,
        mrn: 'MW-000045',
        givenName: 'Willow',
        familyName: 'Creek',
        givenNameAr: null,
        familyNameAr: null,
        age: 30,
        status: 'active',
        contact: null,
        emirate: 'DXB',
      },
    ],
    note: null,
  };
}

function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
}

function mount({ mayFindClients = true } = {}) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/clients?q=')) {
      return new Response(JSON.stringify(clientList()), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  const onClose = vi.fn();
  render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <MemoryRouter initialEntries={['/admin/clients']}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <QuickFind
                  open
                  onClose={onClose}
                  sections={ADMIN_SECTIONS}
                  mayFindClients={mayFindClients}
                />
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </AuthProviderBoundary>,
  );
  const calls = () =>
    (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.startsWith('/api/clients'));
  return { onClose, calls };
}

describe('matchSections', () => {
  it('lists the top-level sections before anything is typed', () => {
    const keys = matchSections(ADMIN_SECTIONS, '').map((r) => r.key);
    expect(keys).toContain('clients');
    expect(keys.some((key) => key.includes('/'))).toBe(false);
  });

  it('finds a page beneath a section by its own name', () => {
    const labels = matchSections(ADMIN_SECTIONS, 'invoices').map((r) =>
      r.kind === 'section' ? r.label : '',
    );
    expect(labels).toEqual(['Billing: Invoices']);
  });
});

describe('QuickFind', () => {
  it('finds a client by name and opens their record on Enter', async () => {
    const { onClose } = mount();
    const field = screen.getByRole('combobox', { name: 'Find a client or a section' });
    fireEvent.change(field, { target: { value: 'wil' } });
    expect(await screen.findByText('MW-000045')).toBeTruthy();
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(screen.getByTestId('where').textContent).toBe(
      `/admin/clients?client=${CLIENT_ID}&section=overview`,
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('sends nothing for a single letter, and says why', async () => {
    const { calls } = mount();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'w' } });
    expect(await screen.findByText('Type one more letter to search clients.')).toBeTruthy();
    expect(calls()).toHaveLength(0);
  });

  it('never searches clients for a person who may not list them', async () => {
    const { calls } = mount({ mayFindClients: false });
    const field = screen.getByRole('combobox', { name: 'Find a section' });
    fireEvent.change(field, { target: { value: 'billing' } });
    expect(await screen.findByText('Billing')).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 260));
    expect(calls()).toHaveLength(0);
  });

  it('moves through the results with the arrow keys and opens a section', () => {
    mount({ mayFindClients: false });
    const field = screen.getByRole('combobox');
    fireEvent.change(field, { target: { value: 'books' } });
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(screen.getByTestId('where').textContent).toBe('/admin/books');
  });
});
