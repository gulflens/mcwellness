// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../../shell/auth/AuthContext';
import type { AuthProvider } from '../../shell/auth/types';
import { ClientDrawer } from './ClientDrawer';
import { ADMIN, FINANCE, PRACTITIONER, signedInProvider } from './testActors';

afterEach(cleanup);

const provider: AuthProvider = signedInProvider;

const client = {
  id: '00000008-0000-4000-8000-000000000005',
  mrn: 'MW-000005',
  givenName: 'Dahlia',
  familyName: 'Bay',
  givenNameAr: 'داليا',
  familyNameAr: 'خليج',
  age: 38,
  status: 'active' as const,
  contact: { relationship: 'self', phone: '+971500001105' },
  emirate: 'UAQ',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const record = {
  id: client.id,
  mrn: client.mrn,
  givenName: client.givenName,
  familyName: client.familyName,
  givenNameAr: client.givenNameAr,
  familyNameAr: client.familyNameAr,
  dateOfBirth: '1988-04-01',
  sexAtBirth: 'female',
  preferredLocale: 'en',
  referralSource: 'Instagram',
  status: 'active',
  contacts: [
    {
      id: '00000008-0000-4000-8000-0000000000c1',
      relationship: 'self',
      isLegalGuardian: false,
      canConsent: true,
      givenName: 'Laurel',
      familyName: 'Meadow',
      givenNameAr: 'لوريل',
      familyNameAr: 'مرج',
      canReceiveReports: true,
      canPay: true,
      phone: '+971500001105',
      email: null,
      whatsappOptIn: false,
      hasEmiratesId: false,
    },
  ],
  locations: [],
  consents: [],
  goals: [],
};

/** Mounts the drawer with `fetchImpl` answering GET /api/clients/:id with `record` (or 500 if omitted). */
function mount(recordBody: unknown = record, me: unknown = ADMIN) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/me') return json(me);
    if (url === `/api/clients/${client.id}`) {
      return recordBody === null ? json({ error: 'internal' }, 500) : json(recordBody);
    }
    if (url === '/api/clients/goal-categories') {
      return json({ categories: [] });
    }
    if (url === `/api/clients/${client.id}/documents`) {
      return json({ documents: [] });
    }
    if (url.startsWith(`/api/clients/${client.id}/timeline`)) {
      return json({ events: [], nextBefore: null, hasMore: false });
    }
    return json({ error: 'not_found' }, 404);
  }) as unknown as typeof fetch;
  render(
    // The Timeline tab carries a link to the access report since the trunk's
    // round 34, so the drawer needs a router above it.
    <MemoryRouter initialEntries={['/admin/clients']}>
      <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
        <ClientDrawer client={client} onClose={vi.fn()} />
      </AuthProviderBoundary>
    </MemoryRouter>,
  );
}

describe('ClientDrawer', () => {
  it('names the client, takes focus, and closes on the button and on Escape', () => {
    const onClose = vi.fn();
    render(
      // The Timeline tab carries a link to the access report since the trunk's
      // round 34, so the drawer needs a router above it.
      <MemoryRouter initialEntries={['/admin/clients']}>
        <AuthProviderBoundary
          provider={provider}
          fetchImpl={
            vi.fn(async () => json({ error: 'not_found' }, 404)) as unknown as typeof fetch
          }
        >
          <ClientDrawer client={client} onClose={onClose} />
        </AuthProviderBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByRole('dialog', { name: 'Dahlia Bay' })).toBeTruthy();
    expect(screen.getByText('MW-000005')).toBeTruthy();
    const close = screen.getByRole('button', { name: 'Close' });
    expect(document.activeElement).toBe(close);
    fireEvent.click(close);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('renders a real tablist, starts on Overview, and switches to Contacts on click', async () => {
    mount();
    const tablist = await screen.findByRole('tablist', { name: 'Record sections' });
    expect(tablist).toBeTruthy();
    const overviewTab = screen.getByRole('tab', { name: 'Overview' });
    expect(overviewTab.getAttribute('aria-selected')).toBe('true');
    expect(await screen.findByText('Instagram')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Contacts' }));
    expect(screen.getByRole('tab', { name: 'Contacts' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(overviewTab.getAttribute('aria-selected')).toBe('false');
    expect(await screen.findByText('+971500001105')).toBeTruthy();
  });

  it('moves focus and selection with the arrow keys, and wraps at the ends', async () => {
    mount();
    await screen.findByRole('tablist');
    const overviewTab = screen.getByRole('tab', { name: 'Overview' });
    const contactsTab = screen.getByRole('tab', { name: 'Contacts' });
    const timelineTab = screen.getByRole('tab', { name: 'Timeline' });
    overviewTab.focus();

    fireEvent.keyDown(overviewTab, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(contactsTab);
    expect(contactsTab.getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(contactsTab, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(overviewTab);

    fireEvent.keyDown(overviewTab, { key: 'End' });
    expect(document.activeElement).toBe(timelineTab);
    expect(timelineTab.getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(timelineTab, { key: 'Home' });
    expect(document.activeElement).toBe(overviewTab);
  });

  it('lists the documents on file and every consent purpose', async () => {
    mount();
    await screen.findByRole('tablist');
    fireEvent.click(screen.getByRole('tab', { name: 'Documents' }));
    // Nothing filed against this fixture, said plainly rather than as an empty
    // table, and the way to file one is on the same screen.
    expect(await screen.findByText('Nothing filed against this client yet.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'File document' })).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Consent' }));
    // Every purpose the practice asks for, with the ones activation needs
    // first and each saying where it stands. Photographs are not among them:
    // the practice takes none since 2026-09-09.
    expect(await screen.findByText('Participation')).toBeTruthy();
    expect(screen.getByText('Brain-map and neurofeedback information')).toBeTruthy();
    expect(screen.queryByText('Photographs and video')).toBeNull();
    expect(
      screen.getAllByText('Needed before this client can be activated').length,
    ).toBeGreaterThan(0);
  });

  it('shows finance the three tabs it may read, and no more', async () => {
    mount(record, FINANCE);
    await screen.findByRole('tablist');
    for (const name of ['Overview', 'Contacts', 'Timeline']) {
      expect(screen.getByRole('tab', { name })).toBeTruthy();
    }
    // Locations, consents, goals and documents are not finance's to read
    // (docs/SPEC/client-record.md section 2 and rule 6); the read policies refuse
    // them, so a tab would open onto nothing it could fill.
    for (const name of ['Locations', 'Consent', 'Goals', 'Documents']) {
      expect(screen.queryByRole('tab', { name })).toBeNull();
    }
  });

  it('offers no write action to a practitioner, and every one to an admin', async () => {
    mount(record, PRACTITIONER);
    await screen.findByRole('tablist');
    fireEvent.click(screen.getByRole('tab', { name: 'Contacts' }));
    expect(screen.queryByRole('button', { name: 'Add contact' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    cleanup();

    mount(record, ADMIN);
    await screen.findByRole('tablist');
    fireEvent.click(screen.getByRole('tab', { name: 'Contacts' }));
    expect(await screen.findByRole('button', { name: 'Add contact' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
  });

  it('names the problem when the record fails to load', async () => {
    mount(null);
    expect(await screen.findByText('The record could not be loaded. Try again.')).toBeTruthy();
  });

  it('prompts for a reason when the record refuses without one, and retries with it', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/me') return json(ADMIN);
      if (url === `/api/clients/${client.id}`) {
        calls += 1;
        const headers = new Headers(init?.headers);
        if (!headers.get('x-reason')) return json({ error: 'reason_required' }, 400);
        return json(record);
      }
      if (url === '/api/clients/goal-categories') return json({ categories: [] });
      return json({ error: 'not_found' }, 404);
    }) as unknown as typeof fetch;
    render(
      // The Timeline tab carries a link to the access report since the trunk's
      // round 34, so the drawer needs a router above it.
      <MemoryRouter initialEntries={['/admin/clients']}>
        <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
          <ClientDrawer client={client} onClose={vi.fn()} />
        </AuthProviderBoundary>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/erased/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'Confirming for a compliance check' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'View record' }));
    await waitFor(() => expect(calls).toBe(2));
    expect(await screen.findByText('Instagram')).toBeTruthy();
  });
});
