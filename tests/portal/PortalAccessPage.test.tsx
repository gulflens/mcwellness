// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccessResponse, OfficeRequestsResponse } from '../../app/api/portal/schema';
import { PortalAccessPage } from '../../app/admin/portal/PortalAccessPage';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import type { AuthProvider } from '../../app/shell/auth/types';
import { CHILD_A, FATHER_CONTACT, MOTHER_CONTACT } from './fixtures';
import { json } from './harness';

/**
 * Settings › Portal (docs/SPEC/client-portal.md section 3.8): the practice's
 * own view of who can open a household's record.
 *
 * Two things this screen must get right, and both are about what it does not
 * say: the table carries no telephone number and no email address, only whether
 * a contact has one; and the link is shown once, when the invitation is issued,
 * and is never rendered before or after.
 */

afterEach(cleanup);

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => 'a-token-that-unlocks-nothing',
  onChange: () => () => undefined,
};

const ACCESS: AccessResponse = {
  access: [
    {
      contactId: MOTHER_CONTACT,
      clientId: CHILD_A,
      clientName: 'Cedar Meadow',
      name: 'Hazel Meadow',
      relationship: 'mother',
      hasPhone: true,
      hasEmail: true,
      state: 'active',
      expiresAt: null,
      since: '2026-08-01T06:00:00.000Z',
    },
    {
      contactId: FATHER_CONTACT,
      clientId: CHILD_A,
      clientName: 'Cedar Meadow',
      name: 'Jasper Meadow',
      relationship: 'father',
      hasPhone: true,
      hasEmail: false,
      state: 'none',
      expiresAt: null,
      since: null,
    },
  ],
};

const REQUESTS: OfficeRequestsResponse = {
  requests: [
    {
      id: '00000001-0000-4000-8000-000000000041',
      clientId: CHILD_A,
      kind: 'erasure',
      consentId: null,
      note: 'We are moving away.',
      status: 'open',
      createdAt: '2026-09-01T06:00:00.000Z',
      handledAt: null,
      clientName: 'Cedar Meadow',
      askedByName: 'Hazel Meadow',
      askedByRelationship: 'mother',
    },
  ],
};

const INVITE = {
  contactId: FATHER_CONTACT,
  kind: 'first_sign_in' as const,
  url: 'http://localhost:3007/portal/invite/a-token-that-opens-nothing',
  expiresAt: '2026-09-12T06:00:00.000Z',
  message: { en: 'A synthetic invitation.', ar: 'دعوة صناعية.' },
  phone: '+971500000023',
};

function mount(answers: Record<string, () => Response> = {}) {
  const calls: { path: string; init?: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    calls.push({ path, init });
    if (path === '/api/me') {
      return json({
        userId: '00000001-0000-4000-8000-000000000011',
        displayName: 'Iris Harbour',
        tenantId: '00000000-0000-4000-8000-00000000000a',
        roles: ['admin'],
        capabilities: [],
        preferredLocale: 'en',
      });
    }
    const match = Object.keys(answers)
      .sort((a, b) => b.length - a.length)
      .find((prefix) => path.startsWith(prefix));
    return match ? (answers[match] as () => Response)() : json({ error: 'not_found' }, 404);
  }) as unknown as typeof fetch;

  const view = render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <PortalAccessPage />
    </AuthProviderBoundary>,
  );
  return { ...view, calls };
}

const BOTH = {
  '/api/portal/access': () => json(ACCESS),
  '/api/portal/requests': () => json(REQUESTS),
};

describe('Settings › Portal', () => {
  it('lists who has access, and never a number or an address', async () => {
    mount(BOTH);
    expect((await screen.findAllByText('Hazel Meadow')).length).toBeGreaterThan(0);
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText('No access')).toBeTruthy();
    // Whether they can be reached, never how.
    expect(screen.getByText('telephone, email')).toBeTruthy();
    expect(document.body.textContent).not.toContain('+971');
    expect(document.body.textContent).not.toContain('example.com');
  });

  it('offers Invite for a contact with no access and Resend for one who has it', async () => {
    mount(BOTH);
    expect(await screen.findByRole('button', { name: 'Invite' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resend' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeTruthy();
  });

  it('shows the link once, with the WhatsApp hand-off beside it', async () => {
    mount({
      ...BOTH,
      '/api/portal/access/': () => json(INVITE, 201),
    });
    // Nothing is on the page before the button is pressed.
    await screen.findAllByText('Hazel Meadow');
    expect(screen.queryByText(/portal\/invite\//)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Invite' }));
    expect(await screen.findByText(INVITE.url)).toBeTruthy();
    expect(screen.getByText('The link, shown once')).toBeTruthy();

    const send = screen.getByRole('link', { name: 'Send on WhatsApp' });
    // The number is turned into a wa.me address in this browser and handed to
    // WhatsApp; nothing leaves this server (docs/SEAMS.md).
    expect(send.getAttribute('href')).toContain('https://wa.me/971500000023');
  });

  it('revokes access and reloads the table', async () => {
    const { calls } = mount(BOTH);
    await screen.findAllByText('Hazel Meadow');
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(calls.some((call) => call.path.endsWith('/revoke'))).toBe(true));
    const revoke = calls.find((call) => call.path.endsWith('/revoke'));
    expect(revoke?.init?.method).toBe('POST');
    expect(revoke?.path).toContain(MOTHER_CONTACT);
  });

  it('shows the asks with their note, and marks one handled', async () => {
    const { calls } = mount(BOTH);
    expect(await screen.findByText('Erase the record')).toBeTruthy();
    expect(screen.getByText('We are moving away.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mark as handled' }));
    await waitFor(() => expect(calls.some((call) => call.path.endsWith('/handle'))).toBe(true));
  });

  it('says so when the screen is not this person’s to open', async () => {
    mount({
      '/api/portal/access': () => json({ error: 'forbidden' }, 403),
      '/api/portal/requests': () => json({ error: 'forbidden' }, 403),
    });
    expect(
      await screen.findByText(/Household access is the owner’s and an admin’s to manage./),
    ).toBeTruthy();
  });

  it('says so, once, when a table cannot be loaded', async () => {
    mount({
      '/api/portal/access': () => json({ error: 'internal' }, 500),
      '/api/portal/requests': () => json(REQUESTS),
    });
    expect(
      await screen.findByText('Household access could not be loaded. Try again.'),
    ).toBeTruthy();
  });
});
