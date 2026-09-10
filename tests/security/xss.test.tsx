// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { RecordTimeline } from '../../app/admin/audit/RecordTimeline';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import type { AuthProvider } from '../../app/shell/auth/types';

afterEach(cleanup);

const HOSTILE = '<img src=x onerror="alert(1)"> and <script>alert(2)</script>';
const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => 'token',
  onChange: () => () => undefined,
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('hostile text in the timeline', () => {
  it('is shown as text and never becomes an element', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === '/api/me'
        ? json({
            userId: '00000002-0000-4000-8000-000000000001',
            displayName: HOSTILE,
            tenantId: '00000001-0000-4000-8000-000000000001',
            roles: ['owner'],
            capabilities: [],
          })
        : json({
            events: [
              {
                id: '1',
                occurredAt: '2026-09-02T06:30:00.000Z',
                sentence: `${HOSTILE} created the record`,
                reason: HOSTILE,
                kind: 'create',
                count: 1,
                actor: { name: HOSTILE, roles: ['owner'] },
              },
            ],
            nextBefore: null,
            hasMore: false,
          }),
    ) as unknown as typeof fetch;
    const { container } = render(
      // The timeline carries a link to the access report since the trunk's
      // round 34, so it needs a router above it; nothing else about this test
      // moved.
      <MemoryRouter initialEntries={['/admin/clients']}>
        <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
          <RecordTimeline clientId="00000008-0000-4000-8000-000000000001" />
        </AuthProviderBoundary>
      </MemoryRouter>,
    );
    expect(await screen.findByText(`${HOSTILE} created the record`)).toBeTruthy();
    expect(screen.getByText(`Reason: ${HOSTILE}`)).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
  });
});
