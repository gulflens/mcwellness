// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TeamMember, TeamProfile } from '../../api/team/schema';
import { AuthProviderBoundary } from '../../shell/auth/AuthContext';
import type { AuthProvider } from '../../shell/auth/types';
import { TeamPage } from './TeamPage';

/**
 * Settings › Team. Synthetic throughout (.claude/rules/testing.md): seed
 * names, example.com, reserved ids.
 *
 * The list is the owner's and an admin's; everything on it is the owner's alone
 * (round 58, 2026-09-21), so what an admin sees is a row and no button. The
 * four "Add …" presses this file used to count are gone: they could only ever
 * widen somebody's access, and they are switches inside the drawer now, which
 * can be turned off again.
 */

afterEach(cleanup);

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => 'token',
  onChange: () => () => undefined,
};

const ME = '00000002-0000-4000-8000-000000000001';
const OWNER: TeamMember = {
  id: ME,
  displayName: 'Hazel Harbour',
  email: 'hazel@example.com',
  status: 'active',
  roles: ['lead_practitioner', 'owner'],
  isYou: true,
  locked: true,
  jobTitle: 'Founder',
};
const ADMIN: TeamMember = {
  id: '00000002-0000-4000-8000-000000000010',
  displayName: 'Iris Harbour',
  email: 'iris@example.com',
  status: 'active',
  roles: ['admin'],
  isYou: false,
  locked: false,
  jobTitle: null,
};

/** What `GET /api/team/:id` answers for the admin's row, so Open has something to open. */
const ADMIN_PROFILE: TeamProfile = {
  ...ADMIN,
  phone: '+971500000012',
  preferredLocale: 'en',
  startedOn: '2026-03-01',
  emergencyContactName: null,
  emergencyContactPhone: null,
  privateNotes: null,
  editable: true,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mount(
  options: { inviteStatus?: number; members?: TeamMember[]; myRoles?: string[] } = {},
) {
  const posts: { url: string; body: unknown }[] = [];
  const gets: string[] = [];
  let members: TeamMember[] = options.members ?? [OWNER, ADMIN];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'GET') gets.push(url);
    if (url === '/api/me') {
      return json({
        userId: ME,
        displayName: 'Hazel Harbour',
        tenantId: '00000001-0000-4000-8000-000000000001',
        roles: options.myRoles ?? ['owner', 'lead_practitioner'],
        capabilities: [],
      });
    }
    if (url === '/api/team' && method === 'GET') {
      return json({ members });
    }
    if (url === '/api/team' && method === 'POST') {
      posts.push({ url, body: JSON.parse(String(init?.body)) });
      if (options.inviteStatus && options.inviteStatus !== 201) {
        return json({ error: 'email_in_use' }, options.inviteStatus);
      }
      members = [
        ...members,
        {
          id: '00000002-0000-4000-8000-000000000020',
          displayName: 'Rowan Meadow',
          email: 'rowan@example.com',
          status: 'active',
          roles: ['finance'],
          isYou: false,
          locked: false,
          jobTitle: null,
        },
      ];
      return json(
        { userId: '00000002-0000-4000-8000-000000000020', temporaryPassword: '<shown-once-0001>' },
        201,
      );
    }
    if (url === `/api/team/${ADMIN.id}` && method === 'GET') {
      return json(ADMIN_PROFILE);
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
  return { posts, gets };
}

describe('TeamPage', () => {
  it('lists the staff with their roles and job titles, and offers an owner one Open on every row', async () => {
    mount();
    expect(await screen.findByText('Iris Harbour')).toBeTruthy();
    expect(screen.getByText('Lead practitioner')).toBeTruthy();
    expect(screen.getByText('Owner')).toBeTruthy();
    // A job title reads under the name when there is one; the admin has none.
    expect(screen.getByText('Founder')).toBeTruthy();
    // One press per row, and no row of "Add …" buttons anywhere.
    expect(screen.getAllByRole('button', { name: 'Open' })).toHaveLength(2);
    expect(
      screen.queryAllByRole('button', {
        name: /^Add (admin|finance|practitioner|lead practitioner)$/,
      }),
    ).toHaveLength(0);
    // The row's other two presses moved inside the drawer with them.
    expect(screen.queryAllByRole('button', { name: 'New temporary password' })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: 'Suspend' })).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Add a person' })).toBeTruthy();
  });

  // The operator's decision of 21 September 2026: managing the team is the
  // owner's alone, so an admin reads the list and presses nothing on it.
  it('offers an admin the rows and no button at all', async () => {
    mount({
      members: [
        { ...OWNER, isYou: false, jobTitle: null },
        { ...ADMIN, isYou: true },
      ],
      myRoles: ['admin'],
    });
    expect(await screen.findByText('Hazel Harbour')).toBeTruthy();
    expect(screen.getByText('Iris Harbour')).toBeTruthy();
    expect(screen.queryAllByRole('button', { name: 'Open' })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: 'Add a person' })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: 'New temporary password' })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: 'Suspend' })).toHaveLength(0);
  });

  it('opens the drawer on the row that was pressed', async () => {
    const { gets } = mount();
    const opens = await screen.findAllByRole('button', { name: 'Open' });
    fireEvent.click(opens[1] as HTMLElement);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Iris Harbour' })).toBeTruthy();
    expect(gets).toContain(`/api/team/${ADMIN.id}`);
  });

  it('closes the drawer on Escape and puts focus back on the row’s Open button', async () => {
    mount();
    const opens = await screen.findAllByRole('button', { name: 'Open' });
    const pressed = opens[1] as HTMLElement;
    // A browser focuses a button it is given a click; jsdom does not.
    pressed.focus();
    fireEvent.click(pressed);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(pressed);
  });

  it('creates a sign-in and shows the temporary password once', async () => {
    const { posts } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Add a person' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Rowan Meadow' } });
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'rowan@example.com' },
    });
    fireEvent.click(screen.getByLabelText('Finance'));
    fireEvent.click(screen.getByRole('button', { name: 'Create sign-in' }));
    expect(await screen.findByText('<shown-once-0001>')).toBeTruthy();
    expect(posts).toEqual([
      {
        url: '/api/team',
        body: { displayName: 'Rowan Meadow', email: 'rowan@example.com', roles: ['finance'] },
      },
    ]);
    expect(await screen.findByText('Rowan Meadow')).toBeTruthy();
  });

  it('says so when the address already has a sign-in', async () => {
    mount({ inviteStatus: 409 });
    fireEvent.click(await screen.findByRole('button', { name: 'Add a person' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Rowan Meadow' } });
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'iris@example.com' },
    });
    fireEvent.click(screen.getByLabelText('Admin'));
    fireEvent.click(screen.getByRole('button', { name: 'Create sign-in' }));
    expect(await screen.findByText('That email address already has a sign-in.')).toBeTruthy();
  });
});
