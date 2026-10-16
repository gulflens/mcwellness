// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from './auth/AuthContext';
import type { AuthProvider } from './auth/types';
import { usePendingReviewCount } from './usePendingReviewCount';

afterEach(cleanup);

/**
 * The rail's count of website reviews waiting for a decision: asked on every
 * navigation, never asked for somebody who may not see reviews, and never
 * written into the window's title, which is the enquiries' signal alone.
 */

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => 'token',
  onChange: () => () => undefined,
};

function counting(answers: number[]) {
  let index = 0;
  return vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === '/api/testimonials/count') {
      const n = answers[Math.min(index, answers.length - 1)] ?? 0;
      index += 1;
      return new Response(JSON.stringify({ pending: n }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

function asked(fetchImpl: typeof fetch): number {
  const calls = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  return calls.filter((call) => String(call[0]) === '/api/testimonials/count').length;
}

function Probe({ enabled }: { enabled: boolean }) {
  const count = usePendingReviewCount(enabled);
  const navigate = useNavigate();
  return (
    <div>
      <span data-testid="count">{count === null ? 'none' : String(count)}</span>
      <button type="button" onClick={() => void navigate('/admin/schedule')}>
        Go
      </button>
    </div>
  );
}

function mount(fetchImpl: typeof fetch, enabled = true) {
  document.title = 'McWellness';
  return render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <MemoryRouter initialEntries={['/admin/clients']}>
        <Probe enabled={enabled} />
      </MemoryRouter>
    </AuthProviderBoundary>,
  );
}

describe('usePendingReviewCount', () => {
  it('reads the waiting count, and leaves the title to the enquiries', async () => {
    mount(counting([3]));
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('3'));
    expect(document.title).toBe('McWellness');
  });

  it('asks again when the reader moves to another screen', async () => {
    mount(counting([3, 1]));
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('3'));
    act(() => screen.getByRole('button', { name: 'Go' }).click());
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
  });

  it('never asks for somebody who may not see reviews', async () => {
    const fetchImpl = counting([5]);
    mount(fetchImpl, false);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.getByTestId('count').textContent).toBe('none');
    expect(asked(fetchImpl)).toBe(0);
  });
});
