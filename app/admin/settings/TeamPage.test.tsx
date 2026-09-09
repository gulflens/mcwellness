// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TeamMember } from '../../api/team/schema';
import { AuthProviderBoundary } from '../../shell/auth/AuthContext';
import type { AuthProvider } from '../../shell/auth/types';
import { TeamPage } from './TeamPage';

/**
 * Settings › Team. Synthetic throughout (.claude/rules/testing.md): seed
 * names, example.com, reserved ids.
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
};
const ADMIN: TeamMember = {
  id: '00000002-0000-4000-8000-000000000010',
  displayName: 'Iris Harbour',
  email: 'iris@example.com',
  status: 'active',
  roles: ['admin'],
  isYou: false,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mount(options: { inviteStatus?: number } = {}) {
  const posts: { url: string; body: unknown }[] = [];
  let members: TeamMember[] = [OWNER, ADMIN];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/me') {
      return json({
        userId: ME,
        displayName: 'Hazel Harbour',
        tenantId: '00000001-0000-4000-8000-000000000001',
        roles: ['owner', 'lead_practitioner'],
        capabilities: [],
      });
    }
    if (url === '/api/team' && (!init?.method || init.method === 'GET')) {
      return json({ members });
    }
    if (url === '/api/team' && init?.method === 'POST') {
      posts.push({ url, body: JSON.parse(String(init.body)) });
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
        },
      ];
      return json(
        { userId: '00000002-0000-4000-8000-000000000020', temporaryPassword: '<shown-once-0001>' },
        201,
      );
    }
    if (url.endsWith('/password')) {
      posts.push({ url, body: null });
      return json({ userId: ADMIN.id, temporaryPassword: '<shown-once-0002>' });
    }
    if (url.endsWith('/status') || url.endsWith('/roles')) {
      posts.push({ url, body: JSON.parse(String(init?.body)) });
      if (url.endsWith('/status')) {
        members = members.map((m) => (url.includes(m.id) ? { ...m, status: 'suspended' } : m));
      }
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
  return { posts };
}

describe('TeamPage', () => {
  it('lists the staff with their roles, and offers no suspend button on your own row', async () => {
    mount();
    expect(await screen.findByText('Iris Harbour')).toBeTruthy();
    expect(screen.getByText('Lead practitioner')).toBeTruthy();
    expect(screen.getByText('Owner')).toBeTruthy();
    // Two rows, one suspend button: the owner's own row has none.
    expect(screen.getAllByRole('button', { name: 'Suspend' })).toHaveLength(1);
    // And no widening of your own access: the owner's row offers no "Add …",
    // the admin's offers the three roles they lack.
    expect(
      screen.getAllByRole('button', {
        name: /^Add (admin|finance|practitioner|lead practitioner)$/,
      }),
    ).toHaveLength(3);
  });

  it('mints a new temporary password for a colleague and shows it once', async () => {
    const { posts } = mount();
    const buttons = await screen.findAllByRole('button', { name: 'New temporary password' });
    fireEvent.click(buttons[1] as HTMLElement);
    expect(await screen.findByText('<shown-once-0002>')).toBeTruthy();
    expect(posts).toEqual([{ url: `/api/team/${ADMIN.id}/password`, body: null }]);
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

  it('suspends a colleague and offers to reactivate them', async () => {
    const { posts } = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Suspend' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reactivate' })).toBeTruthy());
    expect(posts).toEqual([{ url: `/api/team/${ADMIN.id}/status`, body: { status: 'suspended' } }]);
  });
});
