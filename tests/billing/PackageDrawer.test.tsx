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
    listPriceFils: unitPriceFils,
    discountFils: 0,
    discountBasisPoints: null,
    unitPriceFils,
    vatRateBasisPoints: 500,
    vatFils: Math.round(unitPriceFils * 0.05),
    grossFils: unitPriceFils + Math.round(unitPriceFils * 0.05),
    validFrom: '2026-09-02',
    supersedesId: null,
    amendmentReason: 'Opening price list.',
    // What a single one of these sells with: nothing, until the practice sets
    // a term on the price itself (migration 412).
    term: null,
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
      price: { discount: { kind: 'amount'; fils: number } | null };
      components: { serviceTypeId: string; quantity: number }[];
    };
    expect(sent.listPriceFils).toBe(1_215_000);
    // The gap between the two figures, which is what the founder just named
    // by typing the price now (docs/SPEC/billing.md section 2.4).
    expect(sent.price.discount).toEqual({ kind: 'amount', fils: 182_500 });
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

describe('the discount and the price now', () => {
  it('works out the price now from a percentage off the list', async () => {
    const { requests } = mount();
    await screen.findByLabelText(/Brain map/);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Silver' } });
    fireEvent.change(screen.getByLabelText(/Consultation/), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/Brain map/), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/Neurofeedback session/), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText('Discount off the list price'), {
      target: { value: 'percent' },
    });
    fireEvent.change(screen.getByLabelText('Discount (%)'), { target: { value: '15' } });
    // Fifteen per cent off AED 12,150 is AED 10,327.50.
    expect((screen.getByLabelText(/^Price now/) as HTMLInputElement).value).toBe('10,327.50');

    fireEvent.change(screen.getByLabelText('Why this is the price'), {
      target: { value: 'Fifteen per cent off for the launch.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save package' }));
    await waitFor(() => {
      expect(requests.some((request) => request.url === '/api/billing/packages')).toBe(true);
    });
    const sent = requests.find((request) => request.url === '/api/billing/packages')?.body as {
      price: { discount: { kind: string; basisPoints: number } };
    };
    expect(sent.price.discount).toEqual({ kind: 'percent', basisPoints: 1500 });
  });

  it('works the discount out from a price now typed directly', async () => {
    mount();
    await screen.findByLabelText(/Brain map/);
    buildSilver();
    expect((screen.getByLabelText('Discount off the list price') as HTMLSelectElement).value).toBe(
      'amount',
    );
    expect((screen.getByLabelText('Discount (AED)') as HTMLInputElement).value).toBe('1,825.00');
  });

  it('keeps the price now in step when the list price changes after a discount', async () => {
    // The founder chooses a share off the list, then moves the list figure —
    // by retyping it, or by adding one more service to the contents. The
    // request carries the discount, not the price now, so a price now left
    // behind is a figure nobody agreed to (docs/SPEC/billing.md section 2.4).
    const { requests } = mount();
    await screen.findByLabelText(/Brain map/);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Silver' } });
    fireEvent.change(screen.getByLabelText(/Consultation/), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/Brain map/), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/Neurofeedback session/), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText('Discount off the list price'), {
      target: { value: 'percent' },
    });
    fireEvent.change(screen.getByLabelText('Discount (%)'), { target: { value: '15' } });
    expect((screen.getByLabelText(/^Price now/) as HTMLInputElement).value).toBe('10,327.50');

    // AED 12,850 less fifteen per cent is AED 10,922.50.
    fireEvent.change(screen.getByLabelText(/^List price/), { target: { value: '12,850.00' } });
    expect((screen.getByLabelText(/^Price now/) as HTMLInputElement).value).toBe('10,922.50');

    fireEvent.change(screen.getByLabelText('Why this is the price'), {
      target: { value: 'Fifteen per cent off for the launch.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save package' }));
    await waitFor(() => {
      expect(requests.some((request) => request.url === '/api/billing/packages')).toBe(true);
    });
    const sent = requests.find((request) => request.url === '/api/billing/packages')?.body as {
      listPriceFils: number;
      price: { discount: { kind: string; basisPoints: number } };
    };
    expect(sent.listPriceFils).toBe(1_285_000);
    expect(sent.price.discount).toEqual({ kind: 'percent', basisPoints: 1500 });
  });

  it('refuses a price now above the list price on the screen', async () => {
    const { requests } = mount();
    await screen.findByLabelText(/Brain map/);
    buildSilver();
    fireEvent.change(screen.getByLabelText(/^Price now/), { target: { value: '13000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save package' }));
    expect(
      await screen.findByText(
        'The price now is above the list price. Raise the list price or lower the price now.',
      ),
    ).toBeTruthy();
    expect(requests.some((request) => request.url === '/api/billing/packages')).toBe(false);
  });
});

/**
 * How long a programme's credits last, and the plain fact that they may last
 * for ever (the operator's ruling of 12 September 2026,
 * docs/superpowers/plans/2026-09-12-optional-terms.md).
 *
 * A new programme starts with **no term at all** — there is no default, and
 * no default unit either, because a field pre-set to days is how somebody
 * types 6 meaning months and sells a week's credits by accident. Both halves
 * are typed on purpose or neither is.
 */
describe('the term a new programme runs for', () => {
  /** Every term the drawer sent, in order. */
  function sentTerms(requests: { url: string; body: unknown }[]) {
    return requests
      .filter((request) => request.url === '/api/billing/packages')
      .map((request) => (request.body as { term: unknown }).term);
  }

  it('starts blank, with no unit chosen, and says on screen what blank means', async () => {
    mount();
    await screen.findByLabelText(/Brain map/);
    expect((screen.getByLabelText('Runs for') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Counted in') as HTMLSelectElement).value).toBe('');
    expect(screen.getByText('Leave blank and these credits never expire.')).toBeTruthy();
  });

  it('sends no term for a programme left blank, and the sentence still says so', async () => {
    const { requests } = mount();
    await screen.findByLabelText(/Brain map/);
    buildSilver();
    fireEvent.click(screen.getByRole('button', { name: 'Save package' }));
    await waitFor(() => expect(sentTerms(requests)).toHaveLength(1));
    expect(sentTerms(requests)[0]).toBeNull();
    expect(screen.getByText('Leave blank and these credits never expire.')).toBeTruthy();
  });

  it('sends the number and the unit together, and says the term in words', async () => {
    const { requests } = mount();
    await screen.findByLabelText(/Brain map/);
    buildSilver();
    fireEvent.change(screen.getByLabelText('Runs for'), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText('Counted in'), { target: { value: 'month' } });
    // The wording is domain/billing/term.ts's, not the drawer's own.
    expect(
      screen.getByText('These credits last 6 months from the day they are bought.'),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save package' }));
    await waitFor(() => expect(sentTerms(requests)).toHaveLength(1));
    expect(sentTerms(requests)[0]).toEqual({ amount: 6, unit: 'month' });
  });

  it('counts a short term in days, and sends the unit that was chosen', async () => {
    const { requests } = mount();
    await screen.findByLabelText(/Brain map/);
    buildSilver();
    fireEvent.change(screen.getByLabelText('Runs for'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Counted in'), { target: { value: 'day' } });
    expect(
      screen.getByText('These credits last 30 days from the day they are bought.'),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save package' }));
    await waitFor(() => expect(sentTerms(requests)).toHaveLength(1));
    expect(sentTerms(requests)[0]).toEqual({ amount: 30, unit: 'day' });
  });

  it('refuses a number with no unit beside it, before anything is sent', async () => {
    // The database refuses half a term too (migration 412's wholeness
    // constraint), but a coordinator should not have to learn that from a 400.
    const { requests } = mount();
    await screen.findByLabelText(/Brain map/);
    buildSilver();
    fireEvent.change(screen.getByLabelText('Runs for'), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save package' }));

    expect(await screen.findByText('Choose days or months.')).toBeTruthy();
    expect(sentTerms(requests)).toHaveLength(0);
    expect(document.activeElement).toBe(screen.getByLabelText('Counted in'));
  });

  it('refuses a unit with no number beside it, before anything is sent', async () => {
    const { requests } = mount();
    await screen.findByLabelText(/Brain map/);
    buildSilver();
    fireEvent.change(screen.getByLabelText('Counted in'), { target: { value: 'month' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save package' }));

    expect(await screen.findByText('Say how many, or leave both blank.')).toBeTruthy();
    expect(sentTerms(requests)).toHaveLength(0);
    expect(document.activeElement).toBe(screen.getByLabelText('Runs for'));
  });

  it('refuses a term longer than the five years the wire allows', async () => {
    const { requests } = mount();
    await screen.findByLabelText(/Brain map/);
    buildSilver();
    fireEvent.change(screen.getByLabelText('Runs for'), { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText('Counted in'), { target: { value: 'month' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save package' }));

    expect(await screen.findByText('A term is at most five years, in either unit.')).toBeTruthy();
    expect(sentTerms(requests)).toHaveLength(0);
  });
});
