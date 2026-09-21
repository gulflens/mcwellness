// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STAFF_ROLE_OPENS } from '@domain/shared';
import type { TeamProfile } from '../../api/team/schema';
import { AuthProviderBoundary } from '../../shell/auth/AuthContext';
import type { AuthProvider } from '../../shell/auth/types';
import { TeamMemberDrawer } from './TeamMemberDrawer';

/**
 * One colleague's profile, opened. Synthetic throughout
 * (.claude/rules/testing.md): seed names, example.com, reserved ids, phones in
 * the `+971 50 000 00xx` range.
 *
 * Every assertion is on what the person reads or presses — a sentence, a
 * switch's `aria-checked`, the one request that left — and never on a stub.
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
const THEM = '00000002-0000-4000-8000-000000000010';
const TENANT = '00000001-0000-4000-8000-000000000001';

const THEIR_PROFILE: TeamProfile = {
  id: THEM,
  displayName: 'Iris Harbour',
  email: 'iris@example.com',
  status: 'active',
  roles: ['admin'],
  isYou: false,
  locked: false,
  jobTitle: 'Coordinator',
  phone: '+971500000012',
  preferredLocale: 'en',
  startedOn: '2026-03-01',
  emergencyContactName: 'Hazel Harbour',
  emergencyContactPhone: '+971500000013',
  privateNotes: 'Probation ends in June.',
  editable: true,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

type Call = { method: string; url: string; contentType: string | null; body: unknown };

function mount(
  options: {
    profile?: Partial<TeamProfile>;
    myRoles?: string[];
    /** What `PATCH /api/team/:id` answers instead of `{ ok: true }`. */
    saveRefusal?: { status: number; error: string };
    /** What a role switch answers instead of `{ ok: true }`. */
    roleRefusal?: { status: number; error: string };
  } = {},
) {
  const calls: Call[] = [];
  let reads = 0;
  const profile: TeamProfile = { ...THEIR_PROFILE, ...options.profile };
  const onClose = vi.fn();
  const onChanged = vi.fn();
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers);
    if (method !== 'GET') {
      calls.push({
        method,
        url,
        contentType: headers.get('content-type'),
        body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      });
    }
    if (url === '/api/me') {
      return json({
        userId: ME,
        displayName: 'Hazel Harbour',
        tenantId: TENANT,
        roles: options.myRoles ?? ['owner', 'lead_practitioner'],
        capabilities: [],
      });
    }
    if (url === `/api/team/${profile.id}` && method === 'GET') {
      reads += 1;
      return json(profile);
    }
    if (url === `/api/team/${profile.id}` && method === 'PATCH') {
      const refused = options.saveRefusal;
      return refused ? json({ error: refused.error }, refused.status) : json({ ok: true });
    }
    if (/\/roles\/[a-z_]+$/.test(url)) {
      const refused = options.roleRefusal;
      return refused ? json({ error: refused.error }, refused.status) : json({ ok: true });
    }
    if (url.endsWith('/status')) {
      return json({ ok: true });
    }
    if (url.endsWith('/password')) {
      return json({ userId: profile.id, temporaryPassword: '<shown-once-0002>' });
    }
    return json({ error: 'not_found' }, 404);
  }) as unknown as typeof fetch;
  render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <TeamMemberDrawer memberId={profile.id} onClose={onClose} onChanged={onChanged} />
    </AuthProviderBoundary>,
  );
  return { calls, onClose, onChanged, readCount: () => reads };
}

/** Waits for the profile to have loaded, which every case below starts from. */
async function opened(): Promise<void> {
  await screen.findByRole('heading', { name: 'Iris Harbour' });
}

async function onAccess(): Promise<void> {
  fireEvent.click(screen.getByRole('tab', { name: 'Access' }));
}

describe('TeamMemberDrawer', () => {
  it('is titled with the person’s name and carries two tabs the arrow keys move between', async () => {
    mount();
    await opened();
    const profileTab = screen.getByRole('tab', { name: 'Profile' });
    const accessTab = screen.getByRole('tab', { name: 'Access' });
    expect(profileTab.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(profileTab, { key: 'ArrowRight' });
    expect(accessTab.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(accessTab, { key: 'ArrowLeft' });
    expect(profileTab.getAttribute('aria-selected')).toBe('true');
  });

  it('saves the whole profile in one request, declared as JSON', async () => {
    const { calls, onChanged } = mount();
    await opened();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Iris Meadow' } });
    fireEvent.change(screen.getByLabelText('Job title'), { target: { value: 'Office manager' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the profile' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({
      method: 'PATCH',
      url: `/api/team/${THEM}`,
      contentType: 'application/json',
      body: {
        displayName: 'Iris Meadow',
        email: 'iris@example.com',
        phone: '+971500000012',
        preferredLocale: 'en',
        jobTitle: 'Office manager',
        startedOn: '2026-03-01',
        emergencyContactName: 'Hazel Harbour',
        emergencyContactPhone: '+971500000013',
        privateNotes: 'Probation ends in June.',
      },
    });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('says the address already has a sign-in, and keeps what was typed', async () => {
    mount({ saveRefusal: { status: 409, error: 'email_in_use' } });
    await opened();
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'hazel@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save the profile' }));
    expect(await screen.findByText('That email address already has a sign-in.')).toBeTruthy();
    expect((screen.getByLabelText('Email address') as HTMLInputElement).value).toBe(
      'hazel@example.com',
    );
  });

  it('keeps what was typed when the reader looks at Access and comes back', async () => {
    mount();
    await opened();
    fireEvent.change(screen.getByLabelText('Private notes'), {
      target: { value: 'Contract renews in March.' },
    });
    await onAccess();
    expect(screen.queryByLabelText('Private notes')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Profile' }));
    expect((screen.getByLabelText('Private notes') as HTMLTextAreaElement).value).toBe(
      'Contract renews in March.',
    );
  });

  it('says what private notes are for, beneath the box they are typed in', async () => {
    mount();
    await opened();
    expect(
      screen.getByText(
        'Contract terms and reminders. Nothing about health. The person may ask to see what is written here.',
      ),
    ).toBeTruthy();
  });

  it('shows four switches with the line each role opens, and turns one off and on again', async () => {
    const { calls } = mount({ profile: { roles: ['admin', 'finance'] } });
    await opened();
    await onAccess();
    expect(screen.getAllByRole('switch')).toHaveLength(4);
    expect(screen.getByRole('switch', { name: 'Finance' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(screen.getByRole('switch', { name: 'Practitioner' }).getAttribute('aria-checked')).toBe(
      'false',
    );
    for (const line of Object.values(STAFF_ROLE_OPENS)) {
      expect(screen.getByText(line)).toBeTruthy();
    }
    fireEvent.click(screen.getByRole('switch', { name: 'Finance' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.method).toBe('DELETE');
    expect(calls[0]?.url).toBe(`/api/team/${THEM}/roles/finance`);
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Finance' }).getAttribute('aria-checked')).toBe(
        'false',
      ),
    );
    fireEvent.click(screen.getByRole('switch', { name: 'Finance' }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]?.method).toBe('PUT');
    expect(calls[1]?.url).toBe(`/api/team/${THEM}/roles/finance`);
    expect(calls[1]?.contentType).toBe('application/json');
  });

  it('puts a refused switch back and says a person keeps at least one role', async () => {
    mount({
      profile: { roles: ['admin', 'finance'] },
      roleRefusal: { status: 409, error: 'last_role' },
    });
    await opened();
    await onAccess();
    fireEvent.click(screen.getByRole('switch', { name: 'Finance' }));
    expect(
      await screen.findByText(
        'A person keeps at least one role. To shut somebody out, suspend them.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Finance' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('reads the profile again when somebody else changed the access first', async () => {
    const { readCount } = mount({
      profile: { roles: ['admin', 'finance'] },
      roleRefusal: { status: 409, error: 'conflict' },
    });
    await opened();
    expect(readCount()).toBe(1);
    await onAccess();
    fireEvent.click(screen.getByRole('switch', { name: 'Finance' }));
    expect(
      await screen.findByText(
        'Somebody else changed this person’s access just now. Reload and try again.',
      ),
    ).toBeTruthy();
    await waitFor(() => expect(readCount()).toBe(2));
  });

  it('shows an owner’s row as locked, with no switch to press and nothing to suspend', async () => {
    mount({ profile: { roles: ['owner', 'lead_practitioner'], locked: true } });
    await opened();
    await onAccess();
    expect(screen.getByText('Owner. Full access. Cannot be changed.')).toBeTruthy();
    for (const control of screen.getAllByRole('switch')) {
      expect((control as HTMLButtonElement).disabled).toBe(true);
    }
    // Off still reads as off to a screen reader, disabled or not.
    expect(screen.getByRole('switch', { name: 'Finance' }).getAttribute('aria-checked')).toBe(
      'false',
    );
    expect(
      screen.getByRole('switch', { name: 'Lead practitioner' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(screen.queryByRole('button', { name: 'Suspend' })).toBeNull();
  });

  it('reads back a profile that is not the reader’s to change, with no Save', async () => {
    mount({ profile: { roles: ['owner', 'lead_practitioner'], locked: true, editable: false } });
    await opened();
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save the profile' })).toBeNull();
    // The details are still readable, as text.
    expect(screen.getByText('iris@example.com')).toBeTruthy();
    expect(screen.getByText('Probation ends in June.')).toBeTruthy();
  });

  it('mints a temporary password, shows it once, and turns Suspend into Reactivate', async () => {
    const { calls } = mount();
    await opened();
    await onAccess();
    fireEvent.click(screen.getByRole('button', { name: 'New temporary password' }));
    expect(await screen.findByText('<shown-once-0002>')).toBeTruthy();
    expect(calls[0]).toEqual({
      method: 'POST',
      url: `/api/team/${THEM}/password`,
      contentType: 'application/json',
      body: {},
    });
    fireEvent.click(screen.getByRole('button', { name: 'Suspend' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reactivate' })).toBeTruthy());
    expect(calls[1]).toEqual({
      method: 'POST',
      url: `/api/team/${THEM}/status`,
      contentType: 'application/json',
      body: { status: 'suspended' },
    });
  });

  it('closes on Escape', async () => {
    const { onClose } = mount();
    await opened();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
