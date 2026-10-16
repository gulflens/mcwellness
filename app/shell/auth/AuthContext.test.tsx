// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary, useAuth } from './AuthContext';
import type { AuthProvider } from './types';

/**
 * `apiFetch` sends whatever reason the person typed: one a browser would
 * refuse in a header goes percent-encoded and marked (./reasonHeader.ts), and
 * a plain one goes as it always went. Synthetic throughout.
 */

afterEach(cleanup);

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => 'token-for-tests',
  onChange: () => () => undefined,
};

function sent(reason: string): Promise<Headers> {
  return new Promise((resolve) => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/save') resolve(new Headers(init?.headers));
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;
    function Saver() {
      const { apiFetch } = useAuth();
      useEffect(() => {
        void apiFetch('/api/save', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-reason': reason },
          body: '{}',
        });
      }, [apiFetch]);
      return null;
    }
    render(
      <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
        <Saver />
      </AuthProviderBoundary>,
    );
  });
}

describe('apiFetch and the reason header', () => {
  it('sends an Arabic reason with a curly apostrophe and a dash, encoded and marked', async () => {
    const typed = 'العائلة طلبت ذلك — the family’s request';
    const headers = await sent(typed);
    await waitFor(() => expect(headers.get('x-reason-encoding')).toBe('uri'));
    expect(decodeURIComponent(headers.get('x-reason') ?? '')).toBe(typed);
    expect(headers.get('authorization')).toBe('Bearer token-for-tests');
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('sends a plain reason exactly as it always did', async () => {
    const headers = await sent('Opening the books');
    expect(headers.get('x-reason')).toBe('Opening the books');
    expect(headers.has('x-reason-encoding')).toBe(false);
  });
});
