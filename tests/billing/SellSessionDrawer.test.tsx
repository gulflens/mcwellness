// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SellSessionDrawer } from '../../app/admin/billing/SellSessionDrawer';
import { json, mountWith, OWNER } from './harness';

afterEach(cleanup);

/**
 * "Sell a session" — the package drawer's shape for a package of one: a
 * family buying a single visit ahead of time, at the price in force on the
 * day, with the practice's own discount and an optional extra combined once.
 */

const NF_SESSION = '00000004-0000-4000-8000-000000000005';

const NF_SESSION_PRICE = {
  id: '00000004-0000-4000-8000-000000000301',
  serviceTypeId: NF_SESSION,
  serviceTypeCode: 'nf-session',
  serviceTypeName: 'Neurofeedback session',
  serviceTypeNameAr: null,
  listPriceFils: 70_000,
  discountFils: 0,
  discountBasisPoints: null as number | null,
  unitPriceFils: 70_000,
  vatRateBasisPoints: 500,
  vatFils: 0,
  grossFils: 70_000,
  validFrom: '2026-09-02',
  supersedesId: null,
  amendmentReason: 'Launch pricing, ends on the founder’s word.',
  // No term, which is what every seeded price carries: the credits a family
  // buys never expire unless the practice sets a term on this row
  // (migration 412, the operator's ruling of 12 September 2026).
  term: null as { amount: number; unit: 'day' | 'month' } | null,
};

/** The same row with a term the practice set on it deliberately. */
const NF_SESSION_PRICE_WITH_TERM = {
  ...NF_SESSION_PRICE,
  term: { amount: 30, unit: 'day' as const },
};

/** The same row with the price list's own discount on it. */
const NF_SESSION_PRICE_DISCOUNTED = {
  ...NF_SESSION_PRICE,
  discountFils: 5_000,
  unitPriceFils: 65_000,
  grossFils: 65_000,
};

/** The same row, as a practice registered for VAT would be answered it. */
const NF_SESSION_PRICE_REGISTERED = {
  ...NF_SESSION_PRICE,
  vatFils: 3_500,
  grossFils: 73_500,
};

const CLIENT = {
  id: '00000005-0000-4000-8000-000000000002',
  mrn: 'MW-000002',
  givenName: 'Sage',
  familyName: 'Dune',
  givenNameAr: null,
  familyNameAr: null,
  age: 29,
  status: 'active' as const,
  contact: null,
  emirate: 'DXB',
};

function mount(
  onSold: (summary: string) => void = () => undefined,
  price: typeof NF_SESSION_PRICE = NF_SESSION_PRICE,
  vatRegistered = false,
) {
  return mountWith(
    OWNER,
    <SellSessionDrawer onClose={() => undefined} onSold={onSold} />,
    (url, init) => {
      if (url === '/api/billing/prices') return json({ prices: [price], vatRegistered });
      if (url.startsWith('/api/clients?q=')) return json({ clients: [CLIENT], note: null });
      if (url === '/api/billing/session-purchases' && init?.method === 'POST') {
        return json(
          {
            invoiceId: '00000004-0000-4000-8000-000000000501',
            invoiceReference: 'INV-000004',
            entitlementId: '00000004-0000-4000-8000-000000000601',
            serviceTypeName: price.serviceTypeName,
            netFils: price.listPriceFils - price.discountFils,
            vatFils: price.vatFils,
            grossFils: price.grossFils,
            expiresOn: '2027-09-10',
          },
          201,
        );
      }
      return null;
    },
  );
}

async function chooseService() {
  // Waits for the priced service to actually appear in the list, rather than
  // the label alone, since the options load asynchronously from
  // `GET /api/billing/prices`.
  await screen.findByRole('option', { name: 'Neurofeedback session' });
  fireEvent.change(screen.getByLabelText('Service'), { target: { value: NF_SESSION } });
}

async function findClient() {
  fireEvent.change(screen.getByLabelText('Client'), { target: { value: 'Dune' } });
  fireEvent.click(await screen.findByRole('button', { name: /Sage Dune/ }));
}

/** Every idempotency key sent to the sale route, in order. */
function keysSent(fetchImpl: unknown): string[] {
  const calls = (fetchImpl as { mock: { calls: [string, RequestInit | undefined][] } }).mock.calls;
  return calls
    .filter(([url]) => url === '/api/billing/session-purchases')
    .map(([, init]) => new Headers(init?.headers).get('idempotency-key') ?? '');
}

describe('SellSessionDrawer', () => {
  it('lists every priced service', async () => {
    mount();
    expect(await screen.findByRole('option', { name: 'Neurofeedback session' })).toBeTruthy();
  });

  it('sells the chosen service at the price in force and says so', async () => {
    let summary = '';
    const { requests, fetchImpl } = mount((text) => {
      summary = text;
    });
    await chooseService();
    await findClient();
    fireEvent.click(screen.getByLabelText('Money has changed hands'));
    fireEvent.click(screen.getByRole('button', { name: 'Record the sale' }));

    await waitFor(() =>
      expect(requests.some((r) => r.url === '/api/billing/session-purchases')).toBe(true),
    );
    const sent = requests.find((r) => r.url === '/api/billing/session-purchases');
    expect(sent?.body).toMatchObject({
      serviceTypeId: NF_SESSION,
      clientId: CLIENT.id,
      payment: { method: 'transfer', amountFils: 70_000 },
    });
    expect(keysSent(fetchImpl)[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(summary).toBe(
      'Neurofeedback session sold to Sage Dune for AED 700.00, invoice INV-000004.',
    );
  });

  it('shows the figures before the sale: list, discount, price, VAT, total', async () => {
    mount(() => undefined, NF_SESSION_PRICE_DISCOUNTED);
    await chooseService();
    expect(screen.getByText('List price')).toBeTruthy();
    expect(screen.getByText('Discount on the list')).toBeTruthy();
    expect(screen.getByText('50.00')).toBeTruthy();
    expect(screen.getByText('Price after discount')).toBeTruthy();
    expect(screen.getAllByText('650.00')).toHaveLength(2); // price after discount, and the total
    expect(screen.getByText('Total (AED)').nextSibling?.textContent).toBe('650.00');
  });

  it('names the rate only while VAT is actually charged at it', async () => {
    mount(() => undefined, NF_SESSION_PRICE_REGISTERED, true);
    await chooseService();
    expect(screen.getByText('VAT (5%)')).toBeTruthy();
    expect(screen.getByText('35.00')).toBeTruthy();
    expect(screen.getByText('735.00')).toBeTruthy();
  });

  it('will not sell until a family has been chosen, and says which field is wrong', async () => {
    const { requests } = mount();
    await chooseService();
    fireEvent.click(screen.getByRole('button', { name: 'Record the sale' }));
    expect(await screen.findByText('Choose which family is buying it.')).toBeTruthy();
    expect(requests.some((r) => r.url === '/api/billing/session-purchases')).toBe(false);
  });

  it('says a service has no price on that day when the server refuses to sell one', async () => {
    mountWith(
      OWNER,
      <SellSessionDrawer onClose={() => undefined} onSold={() => undefined} />,
      (url, init) => {
        if (url === '/api/billing/prices')
          return json({ prices: [NF_SESSION_PRICE], vatRegistered: false });
        if (url.startsWith('/api/clients?q=')) return json({ clients: [CLIENT], note: null });
        if (url === '/api/billing/session-purchases' && init?.method === 'POST') {
          return json({ error: 'unprocessable', code: 'not_priced' }, 422);
        }
        return null;
      },
    );
    await chooseService();
    await findClient();
    fireEvent.click(screen.getByRole('button', { name: 'Record the sale' }));
    expect(
      await screen.findByText('This service has no price on that day. Set a price first.'),
    ).toBeTruthy();
  });

  it('combines the price list’s own discount with an extra one and sends it with its reason', async () => {
    const { requests } = mount(() => undefined, NF_SESSION_PRICE_DISCOUNTED);
    await chooseService();
    await findClient();
    fireEvent.change(screen.getByLabelText('Extra discount for this sale'), {
      target: { value: 'amount' },
    });
    fireEvent.change(screen.getByLabelText('Discount (AED)'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Why'), {
      target: { value: 'A returning family, at the coordinator’s discretion.' },
    });
    // AED 700 list, less 50 on the list, less 10 extra.
    expect(screen.getAllByText('640.00')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Record the sale' }));
    await waitFor(() =>
      expect(requests.some((r) => r.url === '/api/billing/session-purchases')).toBe(true),
    );
    const sent = requests.find((r) => r.url === '/api/billing/session-purchases')?.body as {
      extraDiscount: { discount: { kind: string; fils: number }; reason: string };
    };
    expect(sent.extraDiscount).toEqual({
      discount: { kind: 'amount', fils: 1_000 },
      reason: 'A returning family, at the coordinator’s discretion.',
    });
  });

  it('says the term the price carries, and nothing about an extension', async () => {
    // The term is read off the price being sold, not from a constant in the
    // code — which is what retired `SINGLE_SESSION_MONTHS`.
    mount(() => undefined, NF_SESSION_PRICE_WITH_TERM);
    await chooseService();
    expect(screen.getByText('Runs 30 days from today.')).toBeTruthy();
    expect(screen.queryByText(/extension/i)).toBeNull();
  });

  it('says nothing at all where the price carries no term', async () => {
    mount();
    await chooseService();
    expect(screen.queryByText(/^Runs /)).toBeNull();
  });
});
