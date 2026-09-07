// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PackageDrawer } from '../../app/admin/billing/PackageDrawer';
import { json, mountWith, OWNER } from './harness';

afterEach(cleanup);

/**
 * Building the practice's Silver programme in the "Add package" drawer.
 *
 * The drawer totals the contents at today's prices and offers that figure as
 * the list price. This suite exists because that offer was, until the
 * formatter's parser learned to read its own output, an offer the drawer then
 * refused: a total of AED 12,150 is written "12,150.00", and submitting it
 * unchanged answered "Enter both prices in AED, such as 10325.00."
 */

const CONSULTATION = '00000004-0000-4000-8000-000000000002';
const BRAIN_MAP = '00000004-0000-4000-8000-000000000003';
const NF_SESSION = '00000004-0000-4000-8000-000000000005';

function price(serviceTypeId: string, name: string, unitPriceFils: number, n: number) {
  return {
    id: `00000004-0000-4000-8000-00000000010${n}`,
    serviceTypeId,
    serviceTypeCode: name.toLowerCase().replace(/[^a-z]+/g, '-'),
    serviceTypeName: name,
    serviceTypeNameAr: null,
    unitPriceFils,
    vatRateBasisPoints: 500,
    vatFils: Math.round(unitPriceFils * 0.05),
    grossFils: unitPriceFils + Math.round(unitPriceFils * 0.05),
    validFrom: '2026-09-02',
    supersedesId: null,
    amendmentReason: 'Opening price list.',
  };
}

// The practice's own figures (the founder's decision of 2026-09-03): a
// consultation is bundled and never sold alone, a brain map is AED 825 net
// and a neurofeedback session AED 700 net.
const PRICES = [
  price(CONSULTATION, 'Consultation', 0, 1),
  price(BRAIN_MAP, 'Brain map', 82_500, 2),
  price(NF_SESSION, 'Neurofeedback session', 70_000, 3),
];

/** Silver's contents: one consultation, two brain maps, fifteen sessions. */
function buildSilver() {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Silver' } });
  fireEvent.change(screen.getByLabelText(/Consultation/), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText(/Brain map/), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText(/Neurofeedback session/), { target: { value: '15' } });
  fireEvent.change(screen.getByLabelText(/^Price now/), { target: { value: '10325.00' } });
  fireEvent.change(screen.getByLabelText('Why this is the price'), {
    target: { value: "Launch pricing, ends on the founder's word." },
  });
}

function mount(onCreated: (row: unknown) => void = () => undefined) {
  return mountWith(
    OWNER,
    <PackageDrawer onClose={() => undefined} onCreated={onCreated as never} />,
    (url) => {
      // The fixture's rows carry five per cent, which is a practice that is
      // registered for it: the answer says so beside them.
      if (url === '/api/billing/prices') return json({ prices: PRICES, vatRegistered: true });
      if (url === '/api/billing/packages') return json({ package: null }, 201);
      return null;
    },
  );
}

describe('PackageDrawer', () => {
  it("offers the contents' total as the list price, grouped as money is written", async () => {
    mount();
    await screen.findByLabelText(/Brain map/);
    buildSilver();
    // 1 x 0 + 2 x 82,500 + 15 x 70,000 = 1,215,000 fils.
    expect((screen.getByLabelText(/^List price/) as HTMLInputElement).value).toBe('12,150.00');
  });

  it('saves the list price it offered, without it being retyped', async () => {
    const { requests } = mount();
    await screen.findByLabelText(/Brain map/);
    buildSilver();
    fireEvent.click(screen.getByRole('button', { name: 'Save package' }));

    await waitFor(() => {
      expect(requests.some((request) => request.url === '/api/billing/packages')).toBe(true);
    });
    const sent = requests.find((request) => request.url === '/api/billing/packages')?.body as {
      listPriceFils: number;
      price: { amountFils: number };
      components: { serviceTypeId: string; quantity: number }[];
    };
    expect(sent.listPriceFils).toBe(1_215_000);
    expect(sent.price.amountFils).toBe(1_032_500);
    expect(sent.components).toEqual([
      { serviceTypeId: CONSULTATION, quantity: 1 },
      { serviceTypeId: BRAIN_MAP, quantity: 2 },
      { serviceTypeId: NF_SESSION, quantity: 15 },
    ]);
    expect(screen.queryByText(/Enter both prices in AED/)).toBeNull();
  });

  it('still refuses a price that is not a price', async () => {
    const { requests } = mount();
    await screen.findByLabelText(/Brain map/);
    buildSilver();
    fireEvent.change(screen.getByLabelText(/^Price now/), { target: { value: '10,32' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save package' }));

    expect(await screen.findByText(/Enter both prices in AED/)).toBeTruthy();
    expect(requests.some((request) => request.url === '/api/billing/packages')).toBe(false);
  });
});
