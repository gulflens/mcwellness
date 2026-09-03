import { render } from '@testing-library/react';
import { vi } from 'vitest';
import type { ReactElement } from 'react';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import type { AuthProvider } from '../../app/shell/auth/types';

/**
 * Mounting one of the money screens with a stubbed API, in the shape
 * BillingPage.test.tsx set. Everything here is synthetic: seeded-shaped ids,
 * a provider that signs nothing, and people from db/seed/names.ts
 * (.claude/rules/testing.md).
 */

export const OWNER = {
  userId: '00000002-0000-4000-8000-000000000001',
  displayName: 'Hazel Harbour',
  tenantId: '00000001-0000-4000-8000-000000000001',
  roles: ['owner', 'admin', 'finance', 'lead_practitioner'],
  capabilities: [],
};

export const LEAD_PRACTITIONER = {
  userId: '00000002-0000-4000-8000-000000000002',
  displayName: 'Rowan Meadow',
  tenantId: '00000001-0000-4000-8000-000000000001',
  roles: ['lead_practitioner'],
  capabilities: [],
};

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => 'token',
  onChange: () => () => undefined,
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export type Route = (url: string, init?: RequestInit) => Response | null;

/** Renders `element` with `/api/me` answered and every other route stubbed. */
export function mountWith(me: unknown, element: ReactElement, routes: Route) {
  const requests: { url: string; body: unknown }[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/me') return json(me);
    const answer = routes(url, init);
    if (answer) {
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return answer;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
  render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      {element}
    </AuthProviderBoundary>,
  );
  return { fetchImpl, requests };
}
