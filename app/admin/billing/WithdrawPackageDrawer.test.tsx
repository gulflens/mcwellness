// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PackageRow } from '../../api/billing/ledger-schema';
import { AuthProviderBoundary } from '../../shell/auth/AuthContext';
import type { AuthProvider } from '../../shell/auth/types';
import { WithdrawPackageDrawer } from './WithdrawPackageDrawer';

afterEach(cleanup);

/**
 * Withdrawing a bundle the practice no longer offers: what the drawer sends,
 * and what it says when the route refuses it (round 62, Task 2).
 */

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => null,
  onChange: () => () => undefined,
};

// Synthetic, in the reserved range (.claude/rules/testing.md). Only the id
// and name matter to this drawer; the rest is here so the value type-checks
// as a real PackageRow.
const SILVER: PackageRow = {
  id: '00000004-0000-4000-8000-000000000201',
  code: 'silver',
  name: 'Silver',
  nameAr: null,
  listPriceFils: 1_215_000,
  term: null,
  status: 'active',
  components: [],
  currentPrice: null,
  componentsTotalFils: null,
  sellable: false,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mount(reply: Response) {
  const onClose = vi.fn();
  const onWithdrawn = vi.fn();
  const fetchImpl = vi.fn(async () => reply) as unknown as typeof fetch;
  render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <WithdrawPackageDrawer bundle={SILVER} onClose={onClose} onWithdrawn={onWithdrawn} />
    </AuthProviderBoundary>,
  );
  return { fetchImpl, onClose, onWithdrawn };
}

/** The one PATCH call this drawer ever sends, its url and its init. */
function patchSent(fetchImpl: unknown): [string, RequestInit] {
  const calls = (fetchImpl as { mock: { calls: [string, RequestInit | undefined][] } }).mock.calls;
  const call = calls.find(([, init]) => init?.method === 'PATCH');
  if (!call) throw new Error('No PATCH was sent.');
  return call as [string, RequestInit];
}

describe('WithdrawPackageDrawer', () => {
  it('refuses to submit without a reason', () => {
    mount(json({}));
    expect((screen.getByRole('button', { name: 'Withdraw' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('sends x-reason and JSON content-type, and asks for status inactive', async () => {
    const { fetchImpl, onWithdrawn } = mount(json({ package: { ...SILVER, status: 'inactive' } }));
    fireEvent.change(screen.getByLabelText('Why'), {
      target: { value: 'No longer offered.' },
    });
    expect((screen.getByRole('button', { name: 'Withdraw' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(onWithdrawn).toHaveBeenCalled());

    const [url, init] = patchSent(fetchImpl);
    expect(url).toBe(`/api/billing/packages/${SILVER.id}`);
    expect(new Headers(init.headers).get('x-reason')).toBe('No longer offered.');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(String(init.body))).toEqual({ status: 'inactive' });
  });

  it("shows the server's error sentence on a non-200", async () => {
    mount(json({ error: 'forbidden' }, 403));
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'No longer offered.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      "You don't have permission to withdraw a package.",
    );
  });
});
