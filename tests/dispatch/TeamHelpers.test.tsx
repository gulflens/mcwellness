// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HelpersResponse, TeamMember } from '../../app/api/team/schema';
import { TeamPage } from '../../app/admin/settings/TeamPage';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import type { AuthProvider } from '../../app/shell/auth/types';

/**
 * Helpers in Settings › Team (docs/SPEC/dispatch.md section 15.12): the owner
 * or an admin adds one — a name, a sign-in address and the practitioner they
 * go with — and revokes one. A helper is listed there and not among the
 * staff, so nobody opens a helper's profile or switches a working role on for
 * them by accident. Seed names, example.com, reserved ids.
 */

afterEach(cleanup);

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => 'token',
  onChange: () => () => undefined,
};

const ME = '00000002-0000-4000-8000-000000007931';
const HELPER = '00000002-0000-4000-8000-000000007932';
const NEW_HELPER = '00000002-0000-4000-8000-000000007933';
const BASIL = '00000002-0000-4000-8000-000000007934';

function member(over: Partial<TeamMember>): TeamMember {
  return {
    id: ME,
    displayName: 'Hazel Harbour',
    email: 'hazel@example.com',
    status: 'active',
    roles: ['owner'],
    isYou: true,
    locked: true,
    jobTitle: null,
    ...over,
  };
}

const HELPER_ROW = member({
  id: HELPER,
  displayName: 'Juniper Vale',
  email: 'juniper@example.com',
  roles: ['helper'],
  isYou: false,
  locked: false,
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mount(myRoles: string[] = ['owner']) {
  const writes: { method: string; url: string; body: unknown }[] = [];
  let helpers: HelpersResponse['helpers'] = [
    {
      userId: HELPER,
      displayName: 'Juniper Vale',
      status: 'active',
      accompanies: { practitionerId: BASIL, displayName: 'Basil Vale' },
    },
  ];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url === '/api/me') {
      return json({
        userId: ME,
        displayName: 'Hazel Harbour',
        tenantId: '00000001-0000-4000-8000-000000000001',
        roles: myRoles,
        capabilities: [],
      });
    }
    if (url === '/api/team' && method === 'GET') {
      return json({ members: [member({ roles: myRoles }), HELPER_ROW] });
    }
    if (url === '/api/team/helpers' && method === 'GET') {
      return json({
        helpers,
        practitioners: [{ practitionerId: BASIL, displayName: 'Basil Vale' }],
      });
    }
    if (url === '/api/team/helpers' && method === 'POST') {
      writes.push({ method, url, body: JSON.parse(String(init?.body)) });
      helpers = [
        ...helpers,
        {
          userId: NEW_HELPER,
          displayName: 'Linden Shore',
          status: 'active',
          accompanies: { practitionerId: BASIL, displayName: 'Basil Vale' },
        },
      ];
      return json({ userId: NEW_HELPER, temporaryPassword: '<shown-once-0002>' }, 201);
    }
    if (url === `/api/team/helpers/${HELPER}` && method === 'DELETE') {
      writes.push({ method, url, body: JSON.parse(String(init?.body ?? '{}')) });
      helpers = helpers.map((row) =>
        row.userId === HELPER ? { ...row, status: 'suspended', accompanies: null } : row,
      );
      return json({ ok: true });
    }
    return json({ error: 'not_found' }, 404);
  }) as unknown as typeof fetch;
  render(
    <MemoryRouter initialEntries={['/admin/settings/team']}>
      <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
        <TeamPage />
      </AuthProviderBoundary>
    </MemoryRouter>,
  );
  return { writes };
}

describe('helpers in Settings › Team', () => {
  it('lists each helper with whom they go, apart from the staff', async () => {
    mount();
    const helpers = await screen.findByRole('table', { name: 'Helpers and whom each goes with' });
    const row = within(helpers).getByRole('row', { name: /Juniper Vale/ });
    expect(within(row).getByText('Basil Vale')).toBeTruthy();
    const staff = screen.getByRole('table', { name: "The practice's staff and their roles" });
    expect(within(staff).queryByText('Juniper Vale')).toBeNull();
  });

  it('adds a helper with a name, a sign-in address and the practitioner they go with', async () => {
    const { writes } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Add a helper' }));
    fireEvent.change(screen.getByLabelText('Helper’s name'), { target: { value: 'Linden Shore' } });
    fireEvent.change(screen.getByLabelText('Helper’s email address'), {
      target: { value: 'linden@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Goes with'), { target: { value: BASIL } });
    fireEvent.click(screen.getByRole('button', { name: 'Create the helper’s sign-in' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({
      method: 'POST',
      url: '/api/team/helpers',
      body: { displayName: 'Linden Shore', email: 'linden@example.com', practitionerId: BASIL },
    });
    expect(await screen.findByText('<shown-once-0002>')).toBeTruthy();
    expect(await screen.findByRole('row', { name: /Linden Shore/ })).toBeTruthy();
  });

  it('asks for all three before sending anything', async () => {
    const { writes } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Add a helper' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create the helper’s sign-in' }));
    expect(
      await screen.findByText('A name, an email address and the practitioner they go with.'),
    ).toBeTruthy();
    expect(writes).toEqual([]);
  });

  it('revokes a helper after one confirmation', async () => {
    const { writes } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke Juniper Vale' }));
    expect(writes).toEqual([]);
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, revoke Juniper Vale' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ method: 'DELETE', url: `/api/team/helpers/${HELPER}` });
    const row = await screen.findByRole('row', { name: /Juniper Vale/ });
    await within(row).findByText('Revoked');
  });

  it('offers an admin the same, on a list they otherwise only read', async () => {
    mount(['admin']);
    expect(await screen.findByRole('button', { name: 'Add a helper' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Revoke Juniper Vale' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add a person' })).toBeNull();
  });
});
