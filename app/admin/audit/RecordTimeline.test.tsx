// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function mount(pages: Record<string, unknown>, fail = false) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/me') return json(ME);
    if (fail) return json({ error: 'internal' }, 500);
    const key = url.includes('before=') ? 'second' : 'first';
    return json(pages[key]);
  }) as unknown as typeof fetch;
  render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <RecordTimeline clientId={CLIENT} />
    </AuthProviderBoundary>,
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
      actor: { name: 'Rowan Meadow', roles: ['admin'] },
    },
    {
      id: '7',
      occurredAt: '2026-09-01T05:00:00.000Z',
      sentence: 'Hazel Harbour withdrew marketing consent',
      reason: 'Asked by the parent at the door.',
      kind: 'change',
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
