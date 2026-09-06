// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from '../../shell/auth/AuthContext';
import type { AuthProvider } from '../../shell/auth/types';
import { AuditPage } from './AuditPage';

/**
 * The Audit screen: the practice's whole trail and the access report
 * (docs/SPEC/audit.md section 9, views 2 and 4).
 *
 * What is asserted here is what the screen may say — sentences the API
 * composed, a record named by its number and never by a name — and that the
 * filters reach the query. Synthetic throughout (.claude/rules/testing.md).
 */

afterEach(cleanup);

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => 'token',
  onChange: () => () => undefined,
};

const CLIENT = '00000001-0000-4000-8000-000000000011';
const ACTOR = '00000002-0000-4000-8000-000000000010';

const FILTERS = {
  actors: [{ id: ACTOR, name: 'Hazel Harbour' }],
  entityTypes: ['client', 'session'],
  actions: ['insert', 'read'],
};

const EVENTS = [
  {
    id: '900',
    occurredAt: '2026-09-06T05:30:00.000Z',
    sentence: 'Hazel Harbour opened this client record',
    reason: null,
    kind: 'read',
    actor: { id: ACTOR, name: 'Hazel Harbour', roles: ['owner'] },
    entityType: 'client',
    clientId: CLIENT,
    clientMrn: 'MW-000011',
  },
  {
    id: '899',
    occurredAt: '2026-09-05T11:00:00.000Z',
    sentence: 'Hazel Harbour created this client record',
    reason: 'The household enrolled.',
    kind: 'create',
    actor: { id: ACTOR, name: 'Hazel Harbour', roles: ['owner'] },
    entityType: 'client',
    clientId: CLIENT,
    clientMrn: 'MW-000011',
  },
];

const REPORT = {
  client: { id: CLIENT, mrn: 'MW-000011' },
  readers: [
    {
      actorId: ACTOR,
      name: 'Hazel Harbour',
      roles: ['owner'],
      reads: 4,
      firstAt: '2026-08-01T06:00:00.000Z',
      lastAt: '2026-09-06T05:30:00.000Z',
      entityTypes: ['client', 'document'],
    },
  ],
  generatedAt: '2026-09-06T06:00:00.000Z',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mount(options: { activityStatus?: number; reportStatus?: number } = {}) {
  const urls: string[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url === '/api/me') {
      return json({
        userId: ACTOR,
        displayName: 'Hazel Harbour',
        tenantId: '00000001-0000-4000-8000-000000000001',
        roles: ['owner'],
        capabilities: [],
      });
    }
    if (url.startsWith('/api/audit/filters')) return json(FILTERS);
    if (url.startsWith('/api/audit/access-report')) {
      return options.reportStatus
        ? json({ error: 'forbidden' }, options.reportStatus)
        : json(REPORT);
    }
    if (options.activityStatus) return json({ error: 'forbidden' }, options.activityStatus);
    return json({ events: EVENTS, nextBefore: null, hasMore: false });
  }) as unknown as typeof fetch;

  render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <AuditPage />
    </AuthProviderBoundary>,
  );
  return urls;
}

describe('the activity feed', () => {
  it('shows the trail as sentences, grouped by day, newest first', async () => {
    mount();
    expect(await screen.findByText('Hazel Harbour opened this client record')).toBeTruthy();
    expect(screen.getByText('Hazel Harbour created this client record')).toBeTruthy();
    expect(screen.getByText('The household enrolled.')).toBeTruthy();
    // The day headings, in the practice's own zone.
    expect(screen.getByText('Sunday, 6 September 2026')).toBeTruthy();
    expect(screen.getByText('Saturday, 5 September 2026')).toBeTruthy();
  });

  it('names a record by its number and never by anybody’s name', async () => {
    mount();
    await screen.findByText('Hazel Harbour opened this client record');
    expect(screen.getAllByRole('button', { name: 'MW-000011' }).length).toBe(2);
    // The only person named on the page is a member of the practice, which is
    // who did it — the household is a record number.
    expect(screen.queryByText(/Harbour household/)).toBeNull();
  });

  it('sends each filter to the query rather than sifting in the browser', async () => {
    const urls = mount();
    await screen.findByText('Hazel Harbour opened this client record');
    fireEvent.change(screen.getByLabelText('Kind of row'), { target: { value: 'session' } });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-01' } });
    await waitFor(() => {
      const asked = urls.filter((url) => url.startsWith('/api/audit/activity'));
      expect(asked.some((url) => url.includes('entityType=session'))).toBe(true);
      expect(asked.some((url) => url.includes('from=2026-09-01'))).toBe(true);
    });
  });

  it('says the trail is not theirs when the server refuses', async () => {
    mount({ activityStatus: 403 });
    expect(await screen.findByText('The practice’s trail is not yours to read.')).toBeTruthy();
  });
});

describe('the access report', () => {
  it('answers who has opened a record, how often and when', async () => {
    mount();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Who has opened it' }))[0]!);
    const report = await screen.findByRole('region', { name: 'Access report' });
    expect(within(report).getByText('Hazel Harbour')).toBeTruthy();
    expect(within(report).getByText('4')).toBeTruthy();
    expect(within(report).getByText('Client record, Document')).toBeTruthy();
  });

  it('says so plainly when the record is not theirs to ask about', async () => {
    mount({ reportStatus: 403 });
    fireEvent.click((await screen.findAllByRole('button', { name: 'Who has opened it' }))[0]!);
    expect(
      await screen.findByText(/access report could not be read/, { exact: false }),
    ).toBeTruthy();
  });
});
