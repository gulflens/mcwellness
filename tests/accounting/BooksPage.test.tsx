// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BooksPage } from '../../app/admin/accounting/BooksPage';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import type { AuthProvider } from '../../app/shell/auth/types';

afterEach(cleanup);
// The page names its section in the address bar, so one test's last click
// would otherwise decide the next test's opening section.
afterEach(() => window.history.replaceState(null, '', '#'));

/**
 * The Books page (docs/SPEC/accounting.md section 5). Synthetic throughout:
 * seeded-shaped ids in the reserved test range, and no household anywhere,
 * because the books name nobody.
 */

const OWNER = {
  userId: '00000002-0000-4000-8000-000000000001',
  displayName: 'Hazel Harbour',
  tenantId: '00000001-0000-4000-8000-000000000001',
  roles: ['owner', 'admin', 'finance', 'lead_practitioner'],
  capabilities: [],
};
const FINANCE = {
  userId: '00000002-0000-4000-8000-000000000003',
  displayName: 'Yusra Almas',
  tenantId: '00000001-0000-4000-8000-000000000001',
  roles: ['finance'],
  capabilities: [],
};

const ACCOUNT_IDS = {
  bank: '0000000e-0000-4000-8000-000000001010',
  cash: '0000000e-0000-4000-8000-000000001020',
  expenses: '0000000e-0000-4000-8000-000000006000',
};

const ACCOUNTS = {
  accounts: [
    {
      id: ACCOUNT_IDS.bank,
      code: '1010',
      name: 'Bank, operating',
      nameAr: null,
      type: 'asset',
      role: 'bank',
      archivedAt: null,
      balanceFils: 1_085_000,
    },
    {
      id: ACCOUNT_IDS.cash,
      code: '1020',
      name: 'Cash box',
      nameAr: null,
      type: 'asset',
      role: 'cash',
      archivedAt: null,
      balanceFils: 0,
    },
    {
      id: ACCOUNT_IDS.expenses,
      code: '6000',
      name: 'General expenses',
      nameAr: null,
      type: 'expense',
      role: null,
      archivedAt: null,
      balanceFils: 20_000,
    },
  ],
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

const ENTRIES = { entries: [ENTRY], truncated: false };

const OVERVIEW = {
  month: '2026-09',
  asOf: '2026-09-07',
  fiscalYearStartsOn: '2026-01-01',
  resultYearToDateFils: 140_000,
  revenueYearToDateFils: 180_000,
  cashPositionFils: 1_085_000,
  cashAccounts: [
    {
      accountCode: '1010',
      accountName: 'Bank, operating',
      accountType: 'asset',
      balanceFils: 1_085_000,
    },
  ],
  receivableFils: 45_000,
  corporateTaxEstimateFils: 0,
  reliefWatch: 'clear',
  reliefThresholdFils: 300_000_000,
  reliefElected: true,
  unpostedCount: 0,
  unknownCount: 0,
  recentEntries: [ENTRY],
};

const SETTINGS = {
  booksStartOn: '2026-09-01',
  yearEndMonth: 12,
  yearEndDay: 31,
  lockedThrough: null,
  corporateTaxRateBasisPoints: 900,
  corporateTaxThresholdFils: 37_500_000,
  smallBusinessReliefElected: true,
  smallBusinessReliefThresholdFils: 300_000_000,
  entryCount: 4,
};

const SUMMARY = {
  month: '2026-09',
  cashCollectedFils: 1_082_500,
  revenueRecognisedFils: 180_000,
  deferredNetFils: 852_500,
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

type Mounted = {
  calls: string[];
  posted: { path: string; body: unknown; reason: string | null }[];
};

function mount(
  me: unknown,
  options: { overview?: unknown; overviewStatus?: number } = {},
): Mounted {
  const calls: string[] = [];
  const posted: Mounted['posted'] = [];
  // Once the poster has run, the books are up to date: the overview says so.
  let hasPosted = false;
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${url}`);
    if (url === '/api/me') return json(me);
    if (method === 'POST' || method === 'PATCH') {
      posted.push({
        path: url,
        body: init?.body ? JSON.parse(String(init.body)) : null,
        reason: new Headers(init?.headers).get('x-reason'),
      });
      if (url === '/api/accounting/post') {
        hasPosted = true;
        return json({ posted: 0, unknown: 0 });
      }
      if (url === '/api/accounting/entries') {
        return json(
          { entry: { ...ENTRY, kind: 'manual', memo: 'Office supplies' }, lines: [] },
          201,
        );
      }
      return json({}, 200);
    }
    if (url.startsWith('/api/accounting/overview')) {
      const body = hasPosted && posted.length > 1 ? OVERVIEW : (options.overview ?? OVERVIEW);
      return json(body, options.overviewStatus ?? 200);
    }
    if (url.startsWith('/api/accounting/entries/')) return json({ entry: ENTRY, lines: [] });
    if (url.startsWith('/api/accounting/entries')) return json(ENTRIES);
    if (url.startsWith('/api/accounting/accounts')) return json(ACCOUNTS);
    if (url.startsWith('/api/accounting/settings')) return json(SETTINGS);
    if (url.startsWith('/api/accounting/years')) return json({ years: [] });
    if (url.startsWith('/api/billing/summary')) return json(SUMMARY);
    throw new Error(`Unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
  render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <BooksPage />
    </AuthProviderBoundary>,
  );
  return { calls, posted };
}

describe('the Books overview', () => {
  it('posts the outstanding events before it reads the overview, and says the books are up to date', async () => {
    const mounted = mount(OWNER);
    expect(await screen.findByText('Result, year to date')).toBeTruthy();
    const postAt = mounted.calls.indexOf('POST /api/accounting/post');
    const overviewAt = mounted.calls.findIndex((call) =>
      call.startsWith('GET /api/accounting/overview'),
    );
    expect(postAt).toBeGreaterThanOrEqual(0);
    expect(overviewAt).toBeGreaterThan(postAt);
    expect(mounted.posted[0]?.reason).toBe('Opening the books');
    expect(screen.getByText('In the bank')).toBeTruthy();
    expect(screen.getByText('Corporate tax to set aside (estimate)')).toBeTruthy();
    expect(screen.getByText('Everything is in the books.')).toBeTruthy();
  });

  it('counts what is not in the books yet and offers to bring them up to date', async () => {
    mount(OWNER, { overview: { ...OVERVIEW, unpostedCount: 3 } });
    expect(await screen.findByText('3 events are not yet in the books.')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Bring the books up to date' });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText('Everything is in the books.')).toBeTruthy());
  });

  it('formats every figure it shows, and shows no raw fils', async () => {
    mount(OWNER);
    await screen.findByText('Result, year to date');
    const figures = [
      ...document.querySelectorAll('.figures__value'),
      ...document.querySelectorAll('td.numeric'),
    ];
    expect(figures.length).toBeGreaterThan(0);
    for (const figure of figures) {
      expect(figure.textContent ?? '', figure.textContent ?? '').toMatch(
        /^-?\d{1,3}(,\d{3})*\.\d{2}$/,
      );
    }
  });

  it('says so plainly when the books are not this person’s to read', async () => {
    mount(OWNER, { overview: { error: 'forbidden' }, overviewStatus: 403 });
    expect(await screen.findByText("You don't have permission to see the books.")).toBeTruthy();
    expect(screen.queryByText('Result, year to date')).toBeNull();
  });
});

describe('the journal', () => {
  it('lists the entries with the event each came from in words', async () => {
    mount(OWNER);
    await screen.findByText('Result, year to date');
    fireEvent.click(screen.getByRole('button', { name: 'Journal' }));
    expect(await screen.findByText('JE-000004')).toBeTruthy();
    expect(screen.getAllByText('Payment received').length).toBeGreaterThan(0);
    expect(screen.getByText('2 Sept 2026')).toBeTruthy();
  });

  it('takes a balanced entry and refuses to offer Save until it balances', async () => {
    const mounted = mount(OWNER);
    await screen.findByText('Result, year to date');
    fireEvent.click(screen.getByRole('button', { name: 'Journal' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Post an entry' }));

    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('What this entry is'), {
      target: { value: 'Office supplies' },
    });
    fireEvent.change(screen.getByLabelText('Why this entry is posted'), {
      target: { value: 'The stationery order for September.' },
    });
    fireEvent.change(await screen.findByLabelText('Line 1 account'), {
      target: { value: ACCOUNT_IDS.expenses },
    });
    fireEvent.change(screen.getByLabelText('Line 1 amount'), { target: { value: '200' } });
    fireEvent.change(screen.getByLabelText('Line 2 account'), {
      target: { value: ACCOUNT_IDS.bank },
    });
    fireEvent.change(screen.getByLabelText('Line 2 side'), { target: { value: 'credit' } });
    fireEvent.change(screen.getByLabelText('Line 2 amount'), { target: { value: '150' } });

    const save = screen.getByRole('button', { name: 'Post the entry' });
    expect(save.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('50.00')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Line 2 amount'), { target: { value: '200' } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Post the entry' }).hasAttribute('disabled')).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Post the entry' }));

    await waitFor(() =>
      expect(mounted.posted.some((call) => call.path === '/api/accounting/entries')).toBe(true),
    );
    const sent = mounted.posted.find((call) => call.path === '/api/accounting/entries')!;
    expect(sent.reason).toBe('The stationery order for September.');
    expect(sent.body).toMatchObject({
      kind: 'manual',
      memo: 'Office supplies',
      lines: [
        { accountId: ACCOUNT_IDS.expenses, debitFils: 20_000, creditFils: 0 },
        { accountId: ACCOUNT_IDS.bank, debitFils: 0, creditFils: 20_000 },
      ],
    });
  });

  it('offers a finance actor the same two actions the owner has', async () => {
    mount(FINANCE);
    await screen.findByText('Result, year to date');
    fireEvent.click(screen.getByRole('button', { name: 'Journal' }));
    expect(await screen.findByRole('button', { name: 'Post an entry' })).toBeTruthy();
    for (const label of ['Overview', 'Journal', 'Accounts', 'Statements', 'Settings']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
  });

  it('reverses an entry with a reason', async () => {
    const mounted = mount(OWNER);
    await screen.findByText('Result, year to date');
    fireEvent.click(screen.getByRole('button', { name: 'Journal' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reverse JE-000004' }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('Why this entry is reversed'), {
      target: { value: 'It was posted against the wrong account.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Post the reversal' }));
    await waitFor(() =>
      expect(mounted.posted.some((call) => call.path.endsWith('/reversal'))).toBe(true),
    );
    const sent = mounted.posted.find((call) => call.path.endsWith('/reversal'))!;
    expect(sent.reason).toBe('It was posted against the wrong account.');
  });
});
