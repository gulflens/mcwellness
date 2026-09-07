// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BillingPage } from '../../app/admin/billing/BillingPage';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import type { AuthProvider } from '../../app/shell/auth/types';

afterEach(cleanup);

// Synthetic throughout: seeded-shaped ids, following the reserved test range
// (.claude/rules/testing.md) the same way app/admin/audit/RecordTimeline.test.tsx does.
const OWNER = {
  userId: '00000002-0000-4000-8000-000000000001',
  displayName: 'Hazel Harbour',
  tenantId: '00000001-0000-4000-8000-000000000001',
  roles: ['owner', 'admin', 'finance', 'lead_practitioner'],
  capabilities: [],
};
const LEAD_PRACTITIONER = {
  userId: '00000002-0000-4000-8000-000000000002',
  displayName: 'Rowan Meadow',
  tenantId: '00000001-0000-4000-8000-000000000001',
  roles: ['lead_practitioner'],
  capabilities: [],
};

const NF_SESSION_ID = '00000004-0000-4000-8000-000000000005';
const SERVICE_TYPES = {
  serviceTypes: [
    { id: NF_SESSION_ID, code: 'nf-session', name: 'Neurofeedback session', nameAr: null },
  ],
};

const NF_PRICE = {
  id: '00000004-0000-4000-8000-000000000101',
  serviceTypeId: NF_SESSION_ID,
  serviceTypeCode: 'nf-session',
  serviceTypeName: 'Neurofeedback session',
  serviceTypeNameAr: 'جلسة التغذية الراجعة العصبية',
  listPriceFils: 90_000,
  discountFils: 0,
  discountBasisPoints: null,
  unitPriceFils: 90_000,
  vatRateBasisPoints: 500,
  vatFils: 4_500,
  grossFils: 94_500,
  validFrom: '2026-09-02',
  supersedesId: null,
  amendmentReason: 'Setting the launch price.',
};

// A practice registered for VAT: the rate is stamped on the row and it is
// charged, so the total carries five per cent.
const PRICES = { vatRegistered: true, prices: [NF_PRICE] };

// The practice as it actually is: not registered, so the same stamped rate
// charges nothing and the total is the price (migration 406).
const PRICES_UNREGISTERED = {
  vatRegistered: false,
  prices: [{ ...NF_PRICE, vatFils: 0, grossFils: 90_000 }],
};

const NO_VAT_NOTE =
  'The practice is not registered for VAT, so no VAT is charged and the total is the price.';

const CREATED_PRICE = {
  id: '00000004-0000-4000-8000-000000000102',
  serviceTypeId: NF_SESSION_ID,
  serviceTypeCode: 'nf-session',
  serviceTypeName: 'Neurofeedback session',
  serviceTypeNameAr: null,
  listPriceFils: 90_000,
  discountFils: 0,
  discountBasisPoints: null,
  unitPriceFils: 90_000,
  vatRateBasisPoints: 500,
  vatFils: 4_500,
  grossFils: 94_500,
  validFrom: '2026-12-01',
  supersedesId: '00000004-0000-4000-8000-000000000101',
  amendmentReason: 'Adjusting for the new season.',
};

const VAT_RATE = { rateBasisPoints: 500, effectiveFrom: '2018-01-01' };

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

function mount(me: unknown, pricesStatus: { body: unknown; status?: number }) {
  const posted: unknown[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/me') return json(me);
    if (url === '/api/billing/service-types') return json(SERVICE_TYPES);
    if (url.startsWith('/api/billing/vat-rate')) return json(VAT_RATE);
    if (url === '/api/billing/prices' && init?.method === 'POST') {
      posted.push(JSON.parse(String(init.body)));
      return json({ price: CREATED_PRICE }, 201);
    }
    if (url.startsWith('/api/billing/prices')) {
      return json(pricesStatus.body, pricesStatus.status ?? 200);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
  render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <BillingPage />
    </AuthProviderBoundary>,
  );
  return { fetchImpl, posted };
}

describe('BillingPage', () => {
  it("renders the price list's seeded-shaped rows: the service, unit price, VAT, total and effective date", async () => {
    mount(OWNER, { body: PRICES });
    expect(await screen.findByText('Neurofeedback session')).toBeTruthy();
    // The service's Arabic name is on the row and is not drawn: the console is
    // English only (operator's decision of 7 September 2026,
    // docs/DESIGN-BRIEF.md section 10 item 4). An invoice still prints it.
    expect(screen.queryByText('جلسة التغذية الراجعة العصبية')).toBeNull();
    // Bare figures: the currency word is named once, in the "List price (AED)"
    // header. 900.00 twice — the list price and, with nothing off it, the price.
    expect(screen.getAllByText('900.00')).toHaveLength(2);
    expect(screen.getByText('45.00')).toBeTruthy();
    expect(screen.getByText('945.00')).toBeTruthy();
    // Formatted like RecordTimeline's own dates: Intl, en-GB, Asia/Dubai — never the raw ISO string.
    // (en-GB's short-month form for September is "Sept", not "Sep".)
    expect(screen.getByText('2 Sept 2026')).toBeTruthy();
    expect(screen.queryByText('2026-09-02')).toBeNull();
  });

  it('says in one line that no VAT is charged while the practice is not registered', async () => {
    mount(OWNER, { body: PRICES_UNREGISTERED });
    await screen.findByText('Neurofeedback session');
    // One quiet sentence above the table, and the columns left as they are:
    // a reader who sees nothing in the VAT column should not have to guess
    // whether it is a zero or a missing figure.
    expect(screen.getByText(NO_VAT_NOTE)).toBeTruthy();
    expect(screen.getByText('VAT')).toBeTruthy();
    expect(screen.getByText('0.00')).toBeTruthy();
    // The list price, the price and the total: three columns, one figure,
    // because nothing is off it and no VAT is charged on it.
    expect(screen.getAllByText('900.00')).toHaveLength(3);
  });

  it('says nothing extra once the practice is registered for VAT', async () => {
    mount(OWNER, { body: PRICES });
    await screen.findByText('Neurofeedback session');
    expect(screen.queryByText(NO_VAT_NOTE)).toBeNull();
    expect(screen.getByText('45.00')).toBeTruthy();
  });

  it('names the currency once, on the list price column', async () => {
    mount(OWNER, { body: PRICES });
    await screen.findByText('Neurofeedback session');
    expect(screen.getByText('List price (AED)')).toBeTruthy();
    expect(screen.getByText('Price')).toBeTruthy();
    expect(screen.getByText('Discount')).toBeTruthy();
  });

  it('shows an em dash in the discount column when a price carries none', async () => {
    mount(OWNER, { body: PRICES });
    await screen.findByText('Neurofeedback session');
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('shows the share in the discount column when a price was set as one', async () => {
    mount(OWNER, {
      body: {
        vatRegistered: false,
        prices: [
          {
            ...NF_PRICE,
            discountFils: 13_500,
            discountBasisPoints: 1500,
            unitPriceFils: 76_500,
            vatFils: 0,
            grossFils: 76_500,
          },
        ],
      },
    });
    await screen.findByText('Neurofeedback session');
    expect(screen.getByText('15%')).toBeTruthy();
    expect(screen.getAllByText('765.00')).toHaveLength(2);
  });

  it('offers "Add price" to the owner, as the page header\'s secondary action', async () => {
    mount(OWNER, { body: PRICES });
    const button = await screen.findByRole('button', { name: 'Add price' });
    expect(button.className).toContain('button--secondary');
    expect(button.className).not.toContain('button--primary');
  });

  it('hides "Add price" from a lead practitioner, who may read the list but not write to it', async () => {
    mount(LEAD_PRACTITIONER, { body: PRICES });
    await screen.findByText('Neurofeedback session');
    expect(screen.queryByRole('button', { name: 'Add price' })).toBeNull();
  });

  it('says so when no price has been set yet', async () => {
    mount(OWNER, { body: { prices: [], vatRegistered: true } });
    expect(await screen.findByText('No prices are set yet.')).toBeTruthy();
  });

  it('names the problem when the list fails to load', async () => {
    mount(OWNER, { body: { error: 'forbidden' }, status: 403 });
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'The price list could not be loaded. Try again.',
    );
  });

  it('shows a calm confirmation naming the service and the new price once a save succeeds, then dismisses it on the next action', async () => {
    mount(OWNER, { body: PRICES });
    fireEvent.click(await screen.findByRole('button', { name: 'Add price' }));
    await screen.findByRole('option', { name: 'Neurofeedback session' });
    fireEvent.change(screen.getByLabelText('Service'), { target: { value: NF_SESSION_ID } });
    fireEvent.change(screen.getByLabelText('List price (AED, excluding VAT)'), {
      target: { value: '900' },
    });
    fireEvent.change(screen.getByLabelText('Why this price changes'), {
      target: { value: 'Adjusting for the new season.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save price' }));

    expect(
      await screen.findByText("Neurofeedback session's price is now AED 900.00."),
    ).toBeTruthy();
    // The drawer closed, not merely emptied.
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Add price' }));
    await waitFor(() =>
      expect(screen.queryByText("Neurofeedback session's price is now AED 900.00.")).toBeNull(),
    );
  });
});

describe('the money screen’s four sections', () => {
  it('opens on Prices, and asks for nothing else until another section is opened', async () => {
    const { fetchImpl } = mount(OWNER, { body: PRICES });
    await screen.findByText('Neurofeedback session');
    const asked = (fetchImpl as unknown as { mock: { calls: [unknown][] } }).mock.calls.map(
      (call) => String(call[0]),
    );
    expect(asked).toContain('/api/billing/prices');
    // The packages, balances and invoices sections cost nothing until opened.
    expect(asked.some((url) => url.startsWith('/api/billing/packages'))).toBe(false);
    expect(asked.some((url) => url.startsWith('/api/billing/invoices'))).toBe(false);
  });

  it('marks the section the reader is on', async () => {
    mount(OWNER, { body: PRICES });
    const prices = await screen.findByRole('button', { name: 'Prices' });
    expect(prices.getAttribute('aria-current')).toBe('page');
    expect(
      screen.getByRole('button', { name: 'Packages' }).getAttribute('aria-current'),
    ).toBeNull();
  });

  it('puts "Add price" away when the reader moves off the price list', async () => {
    mount(OWNER, { body: PRICES });
    await screen.findByRole('button', { name: 'Add price' });
    fireEvent.click(screen.getByRole('button', { name: 'Balances' }));
    expect(screen.queryByRole('button', { name: 'Add price' })).toBeNull();
    expect(screen.getByText('Find a client to see what they have left.')).toBeTruthy();
  });
});
