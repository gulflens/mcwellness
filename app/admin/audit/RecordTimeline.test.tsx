// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../../shell/auth/AuthContext';
import type { AuthProvider } from '../../shell/auth/types';
import { RecordTimeline } from './RecordTimeline';

afterEach(cleanup);

// Synthetic throughout: seeded ids and word-names.
const CLIENT = '00000008-0000-4000-8000-000000000005';
const ME = {
  userId: '00000002-0000-4000-8000-000000000001',
  displayName: 'Hazel Harbour',
  tenantId: '00000001-0000-4000-8000-000000000001',
  roles: ['owner'],
  capabilities: [],
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

function mount(pages: Record<string, unknown>, fail = false, roles: string[] = ME.roles) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/me') return json({ ...ME, roles });
    if (fail) return json({ error: 'internal' }, 500);
    const key = url.includes('before=') ? 'second' : 'first';
    return json(pages[key]);
  }) as unknown as typeof fetch;
  render(
    <MemoryRouter initialEntries={['/admin/clients']}>
      <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
        <RecordTimeline clientId={CLIENT} />
      </AuthProviderBoundary>
    </MemoryRouter>,
  );
  return fetchImpl;
}

const first = {
  events: [
    {
      id: '12',
      occurredAt: '2026-09-02T06:30:00.000Z',
      sentence: 'Rowan Meadow viewed this record',
      reason: null,
      kind: 'read',
      count: 1,
      actor: { name: 'Rowan Meadow', roles: ['admin'] },
    },
    {
      id: '7',
      occurredAt: '2026-09-01T05:00:00.000Z',
      sentence: 'Hazel Harbour withdrew marketing consent',
      reason: 'Asked by the parent at the door.',
      kind: 'change',
      count: 1,
      actor: { name: 'Hazel Harbour', roles: ['owner'] },
    },
  ],
  nextBefore: '7',
  hasMore: true,
};
const second = {
  events: [
    {
      id: '3',
      occurredAt: '2026-08-30T05:00:00.000Z',
      sentence: 'Hazel Harbour created the record',
      reason: null,
      kind: 'create',
      count: 1,
      actor: { name: 'Hazel Harbour', roles: ['owner'] },
    },
  ],
  nextBefore: null,
  hasMore: false,
};

describe('RecordTimeline', () => {
  it('groups the sentences by day in the practice time zone, with the reason on its own line', async () => {
    mount({ first, second });
    expect(await screen.findByText('Rowan Meadow viewed this record')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Wednesday,? 2 September 2026/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Tuesday,? 1 September 2026/ })).toBeTruthy();
    expect(screen.getByText('Reason: Asked by the parent at the door.')).toBeTruthy();
    expect(screen.getByText('10:30')).toBeTruthy();
  });

  it('says how many times a folded read happened', async () => {
    const folded = {
      events: [
        {
          id: '12',
          occurredAt: '2026-09-02T06:30:00.000Z',
          sentence: 'Rowan Meadow saw the appointment in the schedule',
          reason: null,
          kind: 'read',
          count: 3,
          actor: { name: 'Rowan Meadow', roles: ['admin'] },
        },
      ],
      nextBefore: null,
      hasMore: false,
    };
    mount({ first: folded });
    expect(
      await screen.findByText('Rowan Meadow saw the appointment in the schedule (3 times)'),
    ).toBeTruthy();
  });

  it('loads the earlier page on request and stops when there is no more', async () => {
    const fetchImpl = mount({ first, second });
    fireEvent.click(await screen.findByRole('button', { name: 'Show earlier' }));
    expect(await screen.findByText('Hazel Harbour created the record')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Show earlier' })).toBeNull());
    const calls = (fetchImpl as unknown as { mock: { calls: [string][] } }).mock.calls.map((c) =>
      String(c[0]),
    );
    expect(calls.some((url) => url.includes('before=7'))).toBe(true);
  });

  it('says so when nothing has touched the record, and names the problem when loading fails', async () => {
    mount({ first: { events: [], nextBefore: null, hasMore: false } });
    expect(await screen.findByText('Nothing has touched this record yet.')).toBeTruthy();
    cleanup();
    mount({ first }, true);
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'The timeline could not be loaded. Try again.',
    );
  });
});

/**
 * The one press to the access report
 * (docs/CHANGE-REQUESTS/trunk-notes.md round 31's fix round, section 3).
 *
 * The link is a courtesy and not a boundary: `app/api/audit/activity.ts`
 * refuses the request and `db/policies/core/audit_log.sql` refuses the rows.
 * What it must not do is offer a person an action the server would refuse,
 * which is why finance — who sees this tab and may not read the report — is
 * asserted as carefully as the lead practitioner who may.
 */
const LINK = 'Who has opened this record';

describe('the press to the access report', () => {
  it('offers a lead practitioner the report for the record they are looking at', async () => {
    mount({ first, second }, false, ['lead_practitioner']);
    const link = await screen.findByRole('link', { name: LINK });
    expect(link.getAttribute('href')).toBe(`/admin/audit?report=${CLIENT}`);
  });

  it('offers it to the owner and to an administrator, who read the trail too', async () => {
    mount({ first, second }, false, ['owner']);
    expect(await screen.findByRole('link', { name: LINK })).toBeTruthy();
    cleanup();
    mount({ first, second }, false, ['admin']);
    expect(await screen.findByRole('link', { name: LINK })).toBeTruthy();
  });

  it('does not offer it to finance, who sees this tab and may not read the report', async () => {
    // `audit.read` is the owner's, an administrator's and the lead
    // practitioner's (domain/shared/actor.ts): finance reads money, never the
    // trail. A link finance could press would only teach them the app is
    // broken.
    mount({ first, second }, false, ['finance']);
    expect(await screen.findByText('Rowan Meadow viewed this record')).toBeTruthy();
    expect(screen.queryByRole('link', { name: LINK })).toBeNull();
  });

  it('stands at the head whatever the timeline itself is doing', async () => {
    // A record nothing has touched, and a timeline that failed to load, are
    // both states this component returns early from; the press belongs above
    // that, because who has opened a record is a different question from what
    // the record's own feed says.
    mount({ first: { events: [], nextBefore: null, hasMore: false } }, false, ['owner']);
    expect(await screen.findByText('Nothing has touched this record yet.')).toBeTruthy();
    expect(screen.getByRole('link', { name: LINK })).toBeTruthy();
    cleanup();
    mount({ first }, true, ['owner']);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('link', { name: LINK })).toBeTruthy();
  });
});
