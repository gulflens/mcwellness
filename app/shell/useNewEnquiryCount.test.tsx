// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProviderBoundary } from './auth/AuthContext';
import type { AuthProvider } from './auth/types';
import { ENQUIRY_COUNT_REFRESH_MS, useNewEnquiryCount } from './useNewEnquiryCount';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.title = 'McWellness';
});

/**
 * The rail's count of waiting enquiries: asked on every navigation and every
 * couple of minutes, never asked for somebody who may not see enquiries, and
 * carried into the window's title. Synthetic throughout.
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
    const url = String(input);
    if (url === '/api/enquiries/count') {
      const n = answers[Math.min(index, answers.length - 1)] ?? 0;
      index += 1;
      return new Response(JSON.stringify({ new: n }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

function asked(fetchImpl: typeof fetch): number {
  const calls = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  return calls.filter((call) => String(call[0]) === '/api/enquiries/count').length;
}

function Probe({ enabled }: { enabled: boolean }) {
  const count = useNewEnquiryCount(enabled);
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

describe('useNewEnquiryCount', () => {
  it('reads the waiting count and puts it before the title', async () => {
    mount(counting([2]));
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2'));
    expect(document.title).toBe('(2) McWellness');
  });

  it('asks again when the reader moves to another screen', async () => {
    const fetchImpl = counting([2, 3]);
    mount(fetchImpl);
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2'));
    act(() => screen.getByRole('button', { name: 'Go' }).click());
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('3'));
    expect(document.title).toBe('(3) McWellness');
  });

  it('asks again every couple of minutes on a screen left open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchImpl = counting([1, 4]);
    mount(fetchImpl);
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
    expect(ENQUIRY_COUNT_REFRESH_MS).toBe(120_000);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ENQUIRY_COUNT_REFRESH_MS);
    });
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('4'));
  });

  it('leaves the title bare when nothing is waiting', async () => {
    mount(counting([0]));
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('0'));
    expect(document.title).toBe('McWellness');
  });

  it('never asks for somebody who may not see enquiries', async () => {
    const fetchImpl = counting([5]);
    mount(fetchImpl, false);
    // Let the session settle, then check nothing was asked.
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('none'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(asked(fetchImpl)).toBe(0);
    expect(document.title).toBe('McWellness');
  });
});
