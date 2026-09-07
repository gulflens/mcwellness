// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BooksPage } from '../../app/admin/accounting/BooksPage';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import type { AuthProvider } from '../../app/shell/auth/types';

afterEach(cleanup);
// The page names its section in the address bar, so one test's last click
// would otherwise decide the next test's opening section.
afterEach(() => window.history.replaceState(null, '', '#'));

/**
 * jsdom has no object URLs and its anchors do not download, so the pair is
 * stubbed and counted, and the temporary anchor's `download` name is recorded
 * (app/admin/accounting/download.ts).
 */
const objectUrls = { created: [] as string[], revoked: [] as string[] };
let downloaded: string[] = [];

beforeEach(() => {
  objectUrls.created = [];
  objectUrls.revoked = [];
  downloaded = [];
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => {
      const url = `blob:mcwellness/${objectUrls.created.length}`;
      objectUrls.created.push(url);
      return url;
    }),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn((url: string) => objectUrls.revoked.push(url)),
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloaded.push(this.download);
  });
});

afterEach(() => vi.restoreAllMocks());

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

const LEDGER = {
  account: ACCOUNTS.accounts[0],
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

const TRIAL_BALANCE = {
  asOf: '2026-12-31',
  rows: [
    {
      accountCode: '1010',
      accountName: 'Bank, operating',
      accountType: 'asset',
      debitFils: 1_105_000,
      creditFils: 20_000,
      balanceFils: 1_085_000,
    },
  ],
  totalDebitFils: 1_105_000,
  totalCreditFils: 1_105_000,
};

const PROFIT_AND_LOSS = {
  from: '2026-01-01',
  to: '2026-12-31',
  income: [
    {
      accountCode: '4000',
      accountName: 'Session income',
      accountType: 'income',
      balanceFils: 180_000,
    },
  ],
  expenses: [
    {
      accountCode: '6000',
      accountName: 'General expenses',
      accountType: 'expense',
      balanceFils: 40_000,
    },
  ],
  incomeFils: 180_000,
  expenseFils: 40_000,
  resultFils: 140_000,
};

const BALANCE_SHEET = {
  asOf: '2026-12-31',
  assets: [
    {
      accountCode: '1010',
      accountName: 'Bank, operating',
      accountType: 'asset',
      balanceFils: 1_085_000,
    },
  ],
  liabilities: [
    {
      accountCode: '2400',
      accountName: 'Contract liability, sessions owed',
      accountType: 'liability',
      balanceFils: 852_500,
    },
  ],
  equity: [
    {
      accountCode: '3100',
      accountName: 'Opening balance equity',
      accountType: 'equity',
      balanceFils: 92_500,
    },
  ],
  resultYearToDateFils: 140_000,
  retainedEarningsFils: 0,
  totalAssetsFils: 1_085_000,
  totalLiabilitiesAndEquityFils: 1_085_000,
};

const CASH_FLOW = {
  from: '2026-01-01',
  to: '2026-12-31',
  byCategory: {
    fromHouseholds: 1_105_000,
    forExpenses: -20_000,
    toOwners: 0,
    tax: 0,
    other: 0,
    transfers: 0,
  },
  openingCashFils: 0,
  netChangeFils: 1_085_000,
  closingCashFils: 1_085_000,
};

const YEARS = {
  years: [
    {
      id: '0000000e-0000-4000-8000-000000002026',
      startsOn: '2026-01-01',
      endsOn: '2026-12-31',
      status: 'open',
      closedAt: null,
      closeReason: null,
      reopenedAt: null,
      reopenReason: null,
    },
  ],
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

/** A statement as the routes send one: text/csv with the name on the header. */
function csv(name: string, status = 200): Response {
  return new Response('Account code,Account name\r\n1010,Bank\r\n', {
    status,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${name}"`,
    },
  });
}

function mount(
  me: unknown,
  options: {
    overview?: unknown;
    overviewStatus?: number;
    csvStatus?: number;
    settings?: unknown;
  } = {},
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
    if (url.includes('/ledger')) return json(LEDGER);
    // The `.csv` twin of every statement, and the two Zoho files.
    if (url.includes('.csv')) {
      const name = `${url.split('?')[0]?.split('/').pop()?.replace('.csv', '')}-2026-12-31.csv`;
      return csv(name, options.csvStatus ?? 200);
    }
    if (url.startsWith('/api/accounting/statements/trial-balance')) return json(TRIAL_BALANCE);
    if (url.startsWith('/api/accounting/statements/profit-and-loss')) return json(PROFIT_AND_LOSS);
    if (url.startsWith('/api/accounting/statements/balance-sheet')) return json(BALANCE_SHEET);
    if (url.startsWith('/api/accounting/statements/cash-flow')) return json(CASH_FLOW);
    if (url.startsWith('/api/accounting/entries/')) return json({ entry: ENTRY, lines: [] });
    if (url.startsWith('/api/accounting/entries')) return json(ENTRIES);
    if (url.startsWith('/api/accounting/accounts')) return json(ACCOUNTS);
    if (url.startsWith('/api/accounting/settings')) return json(options.settings ?? SETTINGS);
    if (url.startsWith('/api/accounting/years')) return json(YEARS);
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

  it('names the lock when the chosen day is shut, before it asks the server', async () => {
    const mounted = mount(OWNER, { settings: { ...SETTINGS, lockedThrough: '2026-06-30' } });
    await screen.findByText('Result, year to date');
    fireEvent.click(screen.getByRole('button', { name: 'Journal' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Post an entry' }));
    await screen.findByRole('dialog');

    fireEvent.change(screen.getByLabelText('Day'), { target: { value: '2026-06-30' } });
    expect(
      await screen.findByText('The books are locked through 30 Jun 2026. Choose a later day.'),
    ).toBeTruthy();

    // Everything else about the entry is right, and it still cannot be posted.
    fireEvent.change(screen.getByLabelText('What this entry is'), {
      target: { value: 'Office supplies' },
    });
    fireEvent.change(screen.getByLabelText('Why this entry is posted'), {
      target: { value: 'The stationery order for June.' },
    });
    fireEvent.change(screen.getByLabelText('Line 1 account'), {
      target: { value: ACCOUNT_IDS.expenses },
    });
    fireEvent.change(screen.getByLabelText('Line 1 amount'), { target: { value: '200' } });
    fireEvent.change(screen.getByLabelText('Line 2 account'), {
      target: { value: ACCOUNT_IDS.bank },
    });
    fireEvent.change(screen.getByLabelText('Line 2 side'), { target: { value: 'credit' } });
    fireEvent.change(screen.getByLabelText('Line 2 amount'), { target: { value: '200' } });

    const save = screen.getByRole('button', { name: 'Post the entry' });
    expect(save.hasAttribute('disabled')).toBe(true);
    fireEvent.click(save);
    expect(mounted.posted.some((call) => call.path === '/api/accounting/entries')).toBe(false);

    // A day the lock leaves open takes the sentence away again.
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: '2026-07-01' } });
    await waitFor(() =>
      expect(
        screen.queryByText('The books are locked through 30 Jun 2026. Choose a later day.'),
      ).toBeNull(),
    );
    expect(screen.getByRole('button', { name: 'Post the entry' }).hasAttribute('disabled')).toBe(
      false,
    );
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

describe('the chart of accounts', () => {
  it('lists every account in words, with its balance', async () => {
    mount(OWNER);
    await screen.findByText('Result, year to date');
    fireEvent.click(screen.getByRole('button', { name: 'Accounts' }));
    expect(await screen.findByText('Bank, operating')).toBeTruthy();
    expect(screen.getByText('1010')).toBeTruthy();
    expect(screen.getAllByText('Asset').length).toBeGreaterThan(0);
    expect(screen.getByText('Bank')).toBeTruthy();
    expect(screen.getByText('10,850.00')).toBeTruthy();
  });

  it('refuses a code whose first digit disagrees with the type before it asks the server', async () => {
    const mounted = mount(OWNER);
    await screen.findByText('Result, year to date');
    fireEvent.click(screen.getByRole('button', { name: 'Accounts' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add account' }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '4999' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Software' } });
    fireEvent.change(screen.getByLabelText('Kind of account'), { target: { value: 'expense' } });
    fireEvent.change(screen.getByLabelText('Why this account is added'), {
      target: { value: 'The practice pays for software monthly.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add the account' }));
    expect(await screen.findByText("An expense's code starts with 5 or 6.")).toBeTruthy();
    expect(mounted.posted.some((call) => call.path === '/api/accounting/accounts')).toBe(false);

    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '6300' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add the account' }));
    await waitFor(() =>
      expect(mounted.posted.some((call) => call.path === '/api/accounting/accounts')).toBe(true),
    );
    const sent = mounted.posted.find((call) => call.path === '/api/accounting/accounts')!;
    expect(sent.reason).toBe('The practice pays for software monthly.');
  });

  it('shows an account’s ledger with a running balance', async () => {
    mount(OWNER);
    await screen.findByText('Result, year to date');
    fireEvent.click(screen.getByRole('button', { name: 'Accounts' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open 1010' }));
    expect(await screen.findByText('Running balance')).toBeTruthy();
    // AED once per table: the debit column carries it for the ledger's three.
    const ledger = screen.getByRole('table', { name: '1010 Bank, operating' });
    expect(within(ledger).getAllByText(/\(AED\)/)).toHaveLength(1);
    expect(screen.getByText('JE-000004')).toBeTruthy();
    // The debit and the running balance are the same figure on a first line.
    expect(screen.getAllByText('1,050.00')).toHaveLength(2);
  });
});

describe('the statements', () => {
  it('shows the four of them, each with a file to download', async () => {
    mount(OWNER);
    await screen.findByText('Result, year to date');
    fireEvent.click(screen.getByRole('button', { name: 'Statements' }));
    expect(await screen.findByText('Trial balance')).toBeTruthy();
    expect(screen.getByText('Profit and loss')).toBeTruthy();
    expect(screen.getByText('Balance sheet')).toBeTruthy();
    expect(screen.getByText('Cash flow')).toBeTruthy();
    // Buttons, not links: a link would navigate, and a navigation carries no
    // bearer token (app/admin/accounting/download.ts).
    expect(screen.queryAllByRole('link', { name: /Download/ })).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: /Download/ })).toHaveLength(6);
  });

  it('fetches the trial balance through the auth provider’s own fetch, and never navigates', async () => {
    const mounted = mount(OWNER);
    await screen.findByText('Result, year to date');
    fireEvent.click(screen.getByRole('button', { name: 'Statements' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Download the trial balance' }));

    await waitFor(() =>
      expect(
        mounted.calls.some((call) =>
          call.startsWith('GET /api/accounting/statements/trial-balance.csv?asOf='),
        ),
      ).toBe(true),
    );
    const asked = mounted.calls.find((call) => call.includes('trial-balance.csv'))!;
    expect(asked).toContain(`asOf=${new Date().getUTCFullYear()}-12-31`);
    expect(objectUrls.created).toHaveLength(1);
    await waitFor(() => expect(objectUrls.revoked).toEqual(objectUrls.created));
    expect(downloaded).toEqual(['trial-balance-2026-12-31.csv']);
  });

  it('says one fixed sentence when the file is refused, and not the server’s', async () => {
    mount(OWNER, { csvStatus: 403 });
    await screen.findByText('Result, year to date');
    fireEvent.click(screen.getByRole('button', { name: 'Statements' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Download the cash flow' }));
    expect(await screen.findByText('The file could not be prepared. Try again.')).toBeTruthy();
    expect(screen.queryByText(/forbidden/)).toBeNull();
  });

  it('marks the balance sheet’s two computed lines as computed', async () => {
    mount(OWNER);
    await screen.findByText('Result, year to date');
    fireEvent.click(screen.getByRole('button', { name: 'Statements' }));
    expect(await screen.findByText('Result for the year to date, computed')).toBeTruthy();
    expect(screen.getByText('Retained earnings, computed')).toBeTruthy();
  });
});

describe('the books’ settings', () => {
  it('shows the settings and the years to the owner, and refuses a lock in the future', async () => {
    mount(OWNER);
    await screen.findByText('Result, year to date');
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(await screen.findByText('The books start on')).toBeTruthy();
    expect(screen.getByText('Small Business Relief is elected.')).toBeTruthy();
    expect(screen.getByText('1 Jan 2026')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Lock through' }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('Lock the books through'), {
      target: { value: '2030-01-01' },
    });
    fireEvent.change(screen.getByLabelText('Why the lock moves'), {
      target: { value: 'The quarter has been filed.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Move the lock' }));
    expect(await screen.findByText('The lock cannot be in the future.')).toBeTruthy();
  });

  it('says why the year end cannot move once the journal holds an entry', async () => {
    mount(OWNER);
    await screen.findByText('Result, year to date');
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(
      await screen.findByText('The year end can change only while the journal is empty.'),
    ).toBeTruthy();
  });

  it('closes a year with a reason', async () => {
    const mounted = mount(OWNER);
    await screen.findByText('Result, year to date');
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Close 2026' }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('Why this year is closed'), {
      target: { value: 'The adviser has signed the year off.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Close the year' }));
    await waitFor(() =>
      expect(mounted.posted.some((call) => call.path.endsWith('/close'))).toBe(true),
    );
  });

  it('shows finance the settings and none of the buttons', async () => {
    mount(FINANCE);
    await screen.findByText('Result, year to date');
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(await screen.findByText('The books start on')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Lock through' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close 2026' })).toBeNull();
  });
});
