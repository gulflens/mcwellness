// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SellPackageDrawer } from '../../app/admin/billing/SellPackageDrawer';
import { json, mountWith, OWNER } from './harness';

afterEach(cleanup);

/**
 * Selling a programme to a family: what the coordinator is shown before they
 * commit, and what they are told afterwards.
 */

const CONSULTATION = '00000004-0000-4000-8000-000000000002';
const BRAIN_MAP = '00000004-0000-4000-8000-000000000003';
const NF_SESSION = '00000004-0000-4000-8000-000000000005';

const SILVER = {
  id: '00000004-0000-4000-8000-000000000201',
  code: 'silver',
  name: 'Silver',
  nameAr: 'الفضية',
  listPriceFils: 1_215_000,
  expiryMonths: 12,
  status: 'active' as const,
  components: [
    {
      serviceTypeId: CONSULTATION,
      serviceTypeCode: 'consultation',
      serviceTypeName: 'Consultation',
      serviceTypeNameAr: null,
      quantity: 1,
      lineNo: 1,
      standaloneNetFils: 0,
    },
    {
      serviceTypeId: BRAIN_MAP,
      serviceTypeCode: 'brain-map',
      serviceTypeName: 'Brain map (QEEG)',
      serviceTypeNameAr: null,
      quantity: 2,
      lineNo: 2,
      standaloneNetFils: 82_500,
    },
    {
      serviceTypeId: NF_SESSION,
      serviceTypeCode: 'nf-session',
      serviceTypeName: 'Neurofeedback session',
      serviceTypeNameAr: null,
      quantity: 15,
      lineNo: 3,
      standaloneNetFils: 70_000,
    },
  ],
  currentPrice: {
    id: '00000004-0000-4000-8000-000000000301',
    amountFils: 1_032_500,
    // The practice as it actually is: not registered for VAT, so the rate
    // stamped on the price row charges nothing and the gross is the net
    // (migration 406). This is what /api/billing/packages answers today, and
    // it is what the drawer sends as the payment.
    vatRateBasisPoints: 500,
    vatFils: 0,
    grossFils: 1_032_500,
    validFrom: '2026-09-02',
    amendmentReason: "Launch pricing, ends on the founder's word.",
  },
  componentsTotalFils: 1_215_000,
  sellable: true,
};

/** The same bundle, as a practice registered for VAT would be answered it. */
const SILVER_REGISTERED = {
  ...SILVER,
  currentPrice: { ...SILVER.currentPrice, vatFils: 51_625, grossFils: 1_084_125 },
};

const CLIENT = {
  id: '00000005-0000-4000-8000-000000000001',
  mrn: 'MW-000001',
  givenName: 'Hazel',
  familyName: 'Harbour',
  givenNameAr: null,
  familyNameAr: null,
  age: 34,
  status: 'active' as const,
  contact: null,
  emirate: 'DXB',
};

function mount(
  onSold: (summary: string) => void = () => undefined,
  bundle: typeof SILVER = SILVER,
) {
  return mountWith(
    OWNER,
    <SellPackageDrawer bundle={bundle} onClose={() => undefined} onSold={onSold} />,
    (url, init) => {
      if (url.startsWith('/api/clients?q=')) return json({ clients: [CLIENT], note: null });
      if (url === '/api/billing/package-purchases' && init?.method === 'POST') {
        return json(
          {
            purchase: {
              id: '00000004-0000-4000-8000-000000000401',
              clientId: CLIENT.id,
              packageId: bundle.id,
              packageName: 'Silver',
              packageNameAr: 'الفضية',
              purchasedOn: '2026-09-02',
              netFils: bundle.currentPrice.amountFils,
              vatFils: bundle.currentPrice.vatFils,
              grossFils: bundle.currentPrice.grossFils,
              listPriceFils: 1_215_000,
              expiresOn: '2027-09-02',
              extendedTo: null,
              extensionReason: null,
              status: 'active',
              invoiceId: '00000004-0000-4000-8000-000000000501',
            },
            invoiceReference: 'INV-000001',
            entitlements: 18,
          },
          201,
        );
      }
      return null;
    },
  );
}

async function findClient() {
  fireEvent.change(screen.getByLabelText('Client'), { target: { value: 'Harbour' } });
  fireEvent.click(await screen.findByRole('button', { name: /Hazel Harbour/ }));
}

/** The payload the drawer sent to the sale route, if it sent one. */
function saleBody(requests: { url: string; body: unknown }[]): {
  payment?: { amountFils: number };
} {
  const sent = requests.find((request) => request.url === '/api/billing/package-purchases');
  if (!sent) throw new Error('The drawer sent no sale.');
  return sent.body as { payment?: { amountFils: number } };
}

describe('SellPackageDrawer', () => {
  it('shows the price, the VAT on top of it and the total', () => {
    mount(() => undefined, SILVER_REGISTERED);
    expect(screen.getByText('10,325.00')).toBeTruthy();
    expect(screen.getByText('VAT (5%)')).toBeTruthy();
    expect(screen.getByText('10,841.25')).toBeTruthy();
  });

  it("sends the API's gross as the payment: what the family actually hands over", async () => {
    // The practice is not registered for VAT, so the gross is the net and the
    // payment matches the invoice the same request creates. While the
    // catalogue answered the stamped rate applied, this sent AED 10,841.25
    // against an invoice of AED 10,325 and left the difference on the
    // family's balance as an overpayment.
    const { requests } = mount();
    await findClient();
    fireEvent.click(screen.getByLabelText('Money has changed hands'));
    fireEvent.click(screen.getByRole('button', { name: 'Record the sale' }));
    await waitFor(() =>
      expect(requests.some((r) => r.url === '/api/billing/package-purchases')).toBe(true),
    );
    expect(saleBody(requests).payment?.amountFils).toBe(SILVER.currentPrice.grossFils);
    expect(saleBody(requests).payment?.amountFils).toBe(1_032_500);
  });

  it('sends the gross with the VAT in it once the practice is registered', async () => {
    const { requests } = mount(() => undefined, SILVER_REGISTERED);
    await findClient();
    fireEvent.click(screen.getByLabelText('Money has changed hands'));
    fireEvent.click(screen.getByRole('button', { name: 'Record the sale' }));
    await waitFor(() =>
      expect(requests.some((r) => r.url === '/api/billing/package-purchases')).toBe(true),
    );
    expect(saleBody(requests).payment?.amountFils).toBe(SILVER_REGISTERED.currentPrice.grossFils);
    expect(saleBody(requests).payment?.amountFils).toBe(1_084_125);
  });

  it('calls a mixed holding credits, and says what they are', () => {
    // Eighteen "sessions" was wrong: it is fifteen sessions, two brain maps
    // and a consultation, and a family would recognise only the second list.
    mount();
    expect(screen.getByText('Credits')).toBeTruthy();
    expect(screen.getByText('18')).toBeTruthy();
    expect(
      screen.getByText('1 × Consultation, 2 × Brain map (QEEG), 15 × Neurofeedback session'),
    ).toBeTruthy();
  });

  it('will not sell until a family has been chosen, and says which field is wrong', async () => {
    const { requests } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Record the sale' }));
    expect(await screen.findByText('Choose which family is buying it.')).toBeTruthy();
    expect(requests.some((r) => r.url === '/api/billing/package-purchases')).toBe(false);
  });

  it('names the invoice when the sale goes through', async () => {
    let summary = '';
    mount((text) => {
      summary = text;
    });
    await findClient();
    fireEvent.click(screen.getByRole('button', { name: 'Record the sale' }));
    await waitFor(() => expect(summary).toContain('INV-000001'));
    expect(summary).toContain('Hazel Harbour');
  });

  it('holds focus inside itself, and takes the page behind it out of reach', () => {
    // Something on the page behind, of the kind Shift+Tab used to reach: a
    // row in the table the drawer is sitting on top of.
    const behind = document.createElement('button');
    behind.textContent = 'A row behind the drawer';
    document.body.append(behind);
    try {
      mount();
      const drawer = screen.getByRole('dialog');
      // aria-modal alone is a promise; inert is what keeps it.
      expect(drawer.getAttribute('aria-modal')).toBe('true');
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
      expect(behind.inert).toBe(true);
    } finally {
      behind.remove();
    }
  });

  it('gives the page back when it closes', () => {
    const behind = document.createElement('button');
    document.body.append(behind);
    try {
      const { unmount } = mount();
      expect(behind.inert).toBe(true);
      unmount();
      expect(behind.inert).toBe(false);
    } finally {
      behind.remove();
    }
  });
});
