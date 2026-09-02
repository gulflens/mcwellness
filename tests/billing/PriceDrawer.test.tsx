// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PriceDrawer } from '../../app/admin/billing/PriceDrawer';
import { AuthProviderBoundary } from '../../app/shell/auth/AuthContext';
import type { AuthProvider } from '../../app/shell/auth/types';

afterEach(cleanup);

const ME = {
  userId: '00000002-0000-4000-8000-000000000001',
  displayName: 'Hazel Harbour',
  tenantId: '00000001-0000-4000-8000-000000000001',
  roles: ['owner'],
  capabilities: [],
};

const NF_SESSION_ID = '00000004-0000-4000-8000-000000000005';
const SERVICE_TYPES = {
  serviceTypes: [
    {
      id: NF_SESSION_ID,
      code: 'nf-session',
      name: 'Neurofeedback session',
      nameAr: 'جلسة التغذية الراجعة العصبية',
    },
  ],
};

const CURRENT_PRICES = [
  {
    id: '00000004-0000-4000-8000-000000000101',
    serviceTypeId: NF_SESSION_ID,
    serviceTypeCode: 'nf-session',
    serviceTypeName: 'Neurofeedback session',
    serviceTypeNameAr: 'جلسة التغذية الراجعة العصبية',
    unitPriceFils: 90_000,
    vatRateBasisPoints: 500,
    vatFils: 4_500,
    grossFils: 94_500,
    validFrom: '2026-09-02',
    supersedesId: null,
    amendmentReason: 'Setting the launch price.',
  },
];

const CREATED_PRICE = {
  id: '00000004-0000-4000-8000-000000000102',
  serviceTypeId: NF_SESSION_ID,
  serviceTypeCode: 'nf-session',
  serviceTypeName: 'Neurofeedback session',
  serviceTypeNameAr: 'جلسة التغذية الراجعة العصبية',
  unitPriceFils: 1_234,
  vatRateBasisPoints: 500,
  vatFils: 62,
  grossFils: 1_296,
  validFrom: '2026-12-01',
  supersedesId: '00000004-0000-4000-8000-000000000101',
  amendmentReason: 'Testing conversion.',
};

const provider: AuthProvider = {
  kind: 'development',
  signIn: async () => undefined,
  signOut: async () => undefined,
  getAccessToken: async () => 'token',
  onChange: () => () => undefined,
};

function json(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Every POST /api/billing/prices call this mount received, decoded. */
type Posted = {
  serviceTypeId: string;
  unitPriceFils: number;
  validFrom: string;
  amendmentReason: string;
};

function mount(postResponse: { body: unknown; status: number }, currentPrices = CURRENT_PRICES) {
  const posted: Posted[] = [];
  const onClose = vi.fn();
  const onCreated = vi.fn();
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/me') return json(ME);
    if (url === '/api/billing/service-types') return json(SERVICE_TYPES);
    if (url === '/api/billing/prices' && init?.method === 'POST') {
      posted.push(JSON.parse(String(init.body)) as Posted);
      return json(postResponse.body, postResponse.status);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
  render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <PriceDrawer currentPrices={currentPrices} onClose={onClose} onCreated={onCreated} />
    </AuthProviderBoundary>,
  );
  return { posted, onClose, onCreated };
}

/** Fills every field except the reason, which callers set (or leave blank) themselves. */
async function fillPriceAndDate(price: string) {
  // The service select starts disabled with a "Loading services…" placeholder
  // until GET /api/billing/service-types resolves; wait for the real option
  // before choosing it, or the value never takes.
  await screen.findByRole('option', { name: 'Neurofeedback session' });
  fireEvent.change(screen.getByLabelText('Service'), { target: { value: NF_SESSION_ID } });
  fireEvent.change(screen.getByLabelText('Price (AED, excluding VAT)'), {
    target: { value: price },
  });
  fireEvent.change(screen.getByLabelText('Effective from'), { target: { value: '2026-12-01' } });
}

describe('PriceDrawer', () => {
  it('converts a typed AED amount to fils exactly: 12.34 becomes 1234, never a floating-point neighbour', async () => {
    const { posted, onCreated } = mount({ body: { price: CREATED_PRICE }, status: 201 });
    await fillPriceAndDate('12.34');
    fireEvent.change(screen.getByLabelText('Why this price changes'), {
      target: { value: 'Testing conversion.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save price' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(posted).toEqual([
      {
        serviceTypeId: NF_SESSION_ID,
        unitPriceFils: 1234,
        validFrom: '2026-12-01',
        amendmentReason: 'Testing conversion.',
      },
    ]);
  });

  it('converts 0.1 and 0.2 without the drift `0.1 * 100` produces in floating point', async () => {
    // 0.1 + 0.2 is the classic IEEE 754 failure (0.30000000000000004). Typed
    // as an AED amount and converted the way this drawer does, 0.30 must
    // land on exactly 30 fils, not a neighbour of it.
    const { posted, onCreated } = mount({ body: { price: CREATED_PRICE }, status: 201 });
    await fillPriceAndDate('0.30');
    fireEvent.change(screen.getByLabelText('Why this price changes'), {
      target: { value: 'Testing exactness.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save price' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(posted[0]?.unitPriceFils).toBe(30);
  });

  it('requires a reason between 1 and 200 characters, in plain words, and sends nothing until it has one', async () => {
    const { posted, onCreated } = mount({ body: { price: CREATED_PRICE }, status: 201 });
    await fillPriceAndDate('120');
    fireEvent.click(screen.getByRole('button', { name: 'Save price' }));
    expect(await screen.findByText('Say why this price is changing.')).toBeTruthy();
    expect(posted).toHaveLength(0);
    expect(onCreated).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Why this price changes'), {
      target: { value: 'x'.repeat(201) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save price' }));
    expect(await screen.findByText('Keep the reason to 200 characters or fewer.')).toBeTruthy();
    expect(posted).toHaveLength(0);
  });

  it('shows the plain-language reason from a 400 response', async () => {
    mount({
      body: {
        error: 'bad_request',
        reason: 'A new price must take effect after the price it supersedes.',
      },
      status: 400,
    });
    await fillPriceAndDate('120');
    fireEvent.change(screen.getByLabelText('Why this price changes'), {
      target: { value: 'Trying to reprice the same day.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save price' }));
    expect(
      await screen.findByText('A new price must take effect after the price it supersedes.'),
    ).toBeTruthy();
  });

  it('names a 403 in plain words', async () => {
    mount({ body: { error: 'forbidden' }, status: 403 });
    await fillPriceAndDate('120');
    fireEvent.change(screen.getByLabelText('Why this price changes'), {
      target: { value: 'Attempting without permission.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save price' }));
    expect(await screen.findByText("You don't have permission to add a price.")).toBeTruthy();
  });

  it('names a 409 (a price already starting that day) in plain words', async () => {
    mount({ body: { error: 'conflict' }, status: 409 });
    await fillPriceAndDate('120');
    fireEvent.change(screen.getByLabelText('Why this price changes'), {
      target: { value: 'Trying to double up on a date.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save price' }));
    expect(
      await screen.findByText(
        'A price for this service already starts on that date. Choose a different date.',
      ),
    ).toBeTruthy();
  });

  it('shows a live VAT-inclusive total from the rate the price list already carries', async () => {
    mount({ body: { price: CREATED_PRICE }, status: 201 });
    fireEvent.change(screen.getByLabelText('Price (AED, excluding VAT)'), {
      target: { value: '900' },
    });
    expect(await screen.findByText('AED 900.00')).toBeTruthy(); // net
    expect(screen.getByText('AED 45.00')).toBeTruthy(); // VAT at 5%
    expect(screen.getByText('AED 945.00')).toBeTruthy(); // gross
  });

  it('has no VAT rate to preview with when the practice has never set a price, and says so', async () => {
    mount({ body: { price: CREATED_PRICE }, status: 201 }, []);
    fireEvent.change(screen.getByLabelText('Price (AED, excluding VAT)'), {
      target: { value: '900' },
    });
    expect(
      await screen.findByText(
        "VAT will be added at the practice's standard rate when this price is saved.",
      ),
    ).toBeTruthy();
  });
});
