// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountsSection } from '../../app/admin/accounting/AccountsSection';
import { JournalSection } from '../../app/admin/accounting/JournalSection';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import type { AuthProvider } from '../../app/shell/auth/types';

afterEach(cleanup);

/**
 * The "Open" actions on Books › Journal and Books › Accounts.
 *
 * Both used to put what they opened beneath the whole table — off the screen
 * on any practice with more than a handful of rows — and to say nothing at all
 * when the read failed, so the button looked as if it did nothing. What is
 * opened now arrives in a drawer beside the table, and a failed read says so
 * there. Synthetic throughout: reserved test-range ids, and no household,
 * because the books name nobody.
 */

const OWNER = {
  userId: '00000002-0000-4000-8000-000000000001',
  displayName: 'Hazel Harbour',
  tenantId: '00000001-0000-4000-8000-000000000001',
  roles: ['owner', 'admin', 'finance', 'lead_practitioner'],
  capabilities: [],
};

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => 'token',
  onChange: () => () => undefined,
};

const BANK = {
  id: '0000000e-0000-4000-8000-000000001010',
  code: '1010',
  name: 'Bank, operating',
  nameAr: null,
  type: 'asset',
  role: 'bank',
  archivedAt: null,
  balanceFils: 1_085_000,
};

const ENTRY = {
  id: '0000000e-0000-4000-8000-000000000a01',
  reference: 'JE-000004',
  enteredOn: '2026-09-02',
  occurredOn: null,
  kind: 'automatic',
  memo: 'Payment received',
  sourceEvent: 'payment.received',
  reversesEntryId: null,
  reversedByEntryId: null,
  debitTotalFils: 105_000,
};

const LINES = [
  {
    lineNo: 1,
    accountId: BANK.id,
    accountCode: '1010',
    accountName: 'Bank, operating',
    debitFils: 105_000,
    creditFils: 0,
  },
  {
    lineNo: 2,
    accountId: '0000000e-0000-4000-8000-000000001200',
    accountCode: '1200',
    accountName: 'Owed by families',
    debitFils: 0,
    creditFils: 105_000,
  },
];

const LEDGER = {
  account: BANK,
  from: '2026-01-01',
  to: '2026-12-31',
  openingBalanceFils: 0,
  rows: [
    {
      entryReference: 'JE-000004',
      enteredOn: '2026-09-02',
      memo: 'Payment received',
      debitFils: 105_000,
      creditFils: 0,
      runningBalanceFils: 105_000,
    },
  ],
  closingBalanceFils: 105_000,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Mounts one section with the list answered and the one opened read answered `openStatus`. */
function mount(section: 'journal' | 'accounts', openStatus = 200) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/me') return json(OWNER);
    if (url.startsWith(`/api/accounting/entries/${ENTRY.id}`)) {
      return openStatus === 200
        ? json({ entry: ENTRY, lines: LINES })
        : json({ error: 'server_error' }, openStatus);
    }
    if (url.startsWith('/api/accounting/entries')) {
      return json({ entries: [ENTRY], truncated: false });
    }
    if (url.includes('/ledger')) {
      return openStatus === 200 ? json(LEDGER) : json({ error: 'server_error' }, openStatus);
    }
    if (url.startsWith('/api/accounting/accounts')) return json({ accounts: [BANK] });
    throw new Error(`Unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
  render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      {section === 'journal' ? (
        <JournalSection canWrite reloadKey={0} onReloaded={() => undefined} />
      ) : (
        <AccountsSection reloadKey={0} />
      )}
    </AuthProviderBoundary>,
  );
}

describe('opening a journal entry', () => {
  it('shows the entry and its lines in a drawer beside the journal', async () => {
    mount('journal');
    fireEvent.click(await screen.findByRole('button', { name: 'Open JE-000004' }));
    const drawer = await screen.findByRole('dialog', { name: 'JE-000004' });
    const lines = await within(drawer).findByRole('table', { name: 'JE-000004: Payment received' });
    expect(within(lines).getByText('Owed by families')).toBeTruthy();
    expect(within(drawer).getAllByText('1,050.00')).toHaveLength(2);
  });

  it('closes the drawer again', async () => {
    mount('journal');
    fireEvent.click(await screen.findByRole('button', { name: 'Open JE-000004' }));
    const drawer = await screen.findByRole('dialog', { name: 'JE-000004' });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says so when the entry cannot be read, rather than doing nothing', async () => {
    mount('journal', 500);
    fireEvent.click(await screen.findByRole('button', { name: 'Open JE-000004' }));
    const drawer = await screen.findByRole('dialog', { name: 'JE-000004' });
    expect(
      await within(drawer).findByText(
        'This entry could not be opened. Try again, or sign in again if it keeps happening.',
      ),
    ).toBeTruthy();
  });
});

describe('opening an account’s ledger', () => {
  it('shows the ledger in a drawer beside the chart', async () => {
    mount('accounts');
    fireEvent.click(await screen.findByRole('button', { name: 'Open 1010' }));
    const drawer = await screen.findByRole('dialog', { name: '1010 Bank, operating' });
    expect(await within(drawer).findByText('Running balance')).toBeTruthy();
    expect(within(drawer).getByText('JE-000004')).toBeTruthy();
    expect(
      within(drawer).getByText('Opening balance 0.00, closing balance 1,050.00.'),
    ).toBeTruthy();
  });

  it('says so when the ledger cannot be read, rather than doing nothing', async () => {
    mount('accounts', 500);
    fireEvent.click(await screen.findByRole('button', { name: 'Open 1010' }));
    const drawer = await screen.findByRole('dialog', { name: '1010 Bank, operating' });
    expect(
      await within(drawer).findByText(
        'This ledger could not be opened. Try again, or sign in again if it keeps happening.',
      ),
    ).toBeTruthy();
  });
});
