// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PriceDrawer } from '../../app/admin/billing/PriceDrawer';
import type { PriceRow } from '../../app/api/billing/schema';
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
const BRAIN_MAP_ID = '00000004-0000-4000-8000-000000000003';
const SERVICE_TYPES = {
  serviceTypes: [
    {
      id: NF_SESSION_ID,
      code: 'nf-session',
      name: 'Neurofeedback session',
      nameAr: 'جلسة التغذية الراجعة العصبية',
    },
    { id: BRAIN_MAP_ID, code: 'brain-map', name: 'Brain map', nameAr: null },
  ],
};

const CREATED_PRICE: PriceRow = {
  id: '00000004-0000-4000-8000-000000000102',
  serviceTypeId: NF_SESSION_ID,
  serviceTypeCode: 'nf-session',
  serviceTypeName: 'Neurofeedback session',
  serviceTypeNameAr: 'جلسة التغذية الراجعة العصبية',
  listPriceFils: 1_234,
  discountFils: 0,
  discountBasisPoints: null,
  unitPriceFils: 1_234,
  vatRateBasisPoints: 500,
  vatFils: 62,
  grossFils: 1_296,
  validFrom: '2026-12-01',
  supersedesId: '00000004-0000-4000-8000-000000000101',
  amendmentReason: 'Testing conversion.',
  term: null,
};

/**
 * The price this drawer's next row will supersede: the one in force for the
 * neurofeedback session today, carrying a term the practice set on purpose.
 * It is what the term fields prefill from — an amendment that forgot to would
 * wipe that term without anybody typing anything.
 */
const CURRENT_PRICE: PriceRow = {
  ...CREATED_PRICE,
  id: '00000004-0000-4000-8000-000000000101',
  validFrom: '2026-09-02',
  supersedesId: null,
  amendmentReason: 'Opening price list.',
  term: { amount: 30, unit: 'day' as const },
};

const STANDARD_VAT_RATE = { rateBasisPoints: 500, effectiveFrom: '2018-01-01' };

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
  listPriceFils: number;
  discount: { kind: 'percent'; basisPoints: number } | { kind: 'amount'; fils: number } | null;
  validFrom: string;
  amendmentReason: string;
  /**
   * Absent when the term was not touched, which is how the drawer says
   * "leave whatever the superseded row carries alone"; `null` only when
   * somebody cleared it deliberately (the controller's ruling of
   * 12 September 2026).
   */
  term?: { amount: number; unit: 'day' | 'month' } | null;
};

/** Every GET /api/billing/vat-rate?date=... call this mount received. */
type VatRateCall = { date: string };

/** A static answer for every date, or a function answering by the requested date. */
type VatRateAnswer =
  { body: unknown; status?: number } | ((date: string) => { body: unknown; status?: number });

function mount(
  postResponse: { body: unknown; status: number },
  vatRateResponse: VatRateAnswer = { body: STANDARD_VAT_RATE, status: 200 },
  // The prices in force, which the page already has open behind the drawer.
  currentPrices: readonly PriceRow[] = [],
) {
  const posted: Posted[] = [];
  const vatRateCalls: VatRateCall[] = [];
  const onClose = vi.fn();
  const onCreated = vi.fn();
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/me') return json(ME);
    if (url === '/api/billing/service-types') return json(SERVICE_TYPES);
    if (url.startsWith('/api/billing/vat-rate')) {
      const date = new URL(url, 'http://localhost').searchParams.get('date') ?? '';
      vatRateCalls.push({ date });
      const answer =
        typeof vatRateResponse === 'function' ? vatRateResponse(date) : vatRateResponse;
      return json(answer.body, answer.status ?? 200);
    }
    if (url === '/api/billing/prices' && init?.method === 'POST') {
      posted.push(JSON.parse(String(init.body)) as Posted);
      return json(postResponse.body, postResponse.status);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as unknown as typeof fetch;
  render(
    <AuthProviderBoundary provider={provider} fetchImpl={fetchImpl}>
      <PriceDrawer onClose={onClose} onCreated={onCreated} currentPrices={currentPrices} />
    </AuthProviderBoundary>,
  );
  return { posted, vatRateCalls, onClose, onCreated };
}

/** Fills every field except the reason, which callers set (or leave blank) themselves. */
async function fillPriceAndDate(price: string) {
  // The service select starts disabled with a "Loading services…" placeholder
  // until GET /api/billing/service-types resolves; wait for the real option
  // before choosing it, or the value never takes.
  await screen.findByRole('option', { name: 'Neurofeedback session' });
  fireEvent.change(screen.getByLabelText('Service'), { target: { value: NF_SESSION_ID } });
  fireEvent.change(screen.getByLabelText('List price (AED, excluding VAT)'), {
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
        listPriceFils: 1234,
        discount: null,
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
    expect(posted[0]?.listPriceFils).toBe(30);
  });

  it("requires a reason worth reading, through the field's own error slot, and sends nothing until it has one", async () => {
    const { posted, onCreated } = mount({ body: { price: CREATED_PRICE }, status: 201 });
    await fillPriceAndDate('120');
    fireEvent.click(screen.getByRole('button', { name: 'Save price' }));
    const reasonField = screen.getByLabelText('Why this price changes');
    expect(await screen.findByText('Say why in at least 8 characters.')).toBeTruthy();
    expect(reasonField.getAttribute('aria-invalid')).toBe('true');
    expect(posted).toHaveLength(0);
    expect(onCreated).not.toHaveBeenCalled();

    // Eight characters of one letter is a required field being filled in
    // rather than answered, and it is refused the same way an empty one is.
    fireEvent.change(reasonField, { target: { value: 'xxxxxxxxxx' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save price' }));
    expect(await screen.findByText('Say why in at least 8 characters.')).toBeTruthy();
    expect(posted).toHaveLength(0);

    fireEvent.change(reasonField, { target: { value: 'Repricing for the new year. '.repeat(10) } });
    fireEvent.click(screen.getByRole('button', { name: 'Save price' }));
    expect(await screen.findByText('Keep the reason to 200 characters or fewer.')).toBeTruthy();
    expect(posted).toHaveLength(0);
  });

  it('moves focus to the field that is wrong, so a refusal is noticed without looking', async () => {
    mount({ body: { price: CREATED_PRICE }, status: 201 });
    await fillPriceAndDate('120');
    fireEvent.click(screen.getByRole('button', { name: 'Save price' }));
    await screen.findByText('Say why in at least 8 characters.');
    // The message is bound to the field through aria-describedby, so moving
    // here says the field and then says the reason.
    expect(document.activeElement).toBe(screen.getByLabelText('Why this price changes'));
  });

  it('clears a field error as soon as the field changes, before it is corrected', async () => {
    mount({ body: { price: CREATED_PRICE }, status: 201 });
    await fillPriceAndDate('120');
    fireEvent.click(screen.getByRole('button', { name: 'Save price' }));
    const reasonField = screen.getByLabelText('Why this price changes');
    await screen.findByText('Say why in at least 8 characters.');

    fireEvent.change(reasonField, { target: { value: 'x' } });
    await waitFor(() => expect(screen.queryByText('Say why in at least 8 characters.')).toBeNull());
    expect(reasonField.getAttribute('aria-invalid')).toBeNull();
  });

  it("maps a 400 refusal to its fixed sentence by code, never the server's own reason text", async () => {
    mount({
      body: {
        error: 'bad_request',
        code: 'date_not_after_current',
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
      await screen.findByText(
        'A new price must take effect after the price it supersedes. Choose a later date.',
      ),
    ).toBeTruthy();
  });

  it('falls back to the generic 400 sentence for an unrecognised or missing code', async () => {
    mount({ body: { error: 'bad_request' }, status: 400 });
    await fillPriceAndDate('120');
    fireEvent.change(screen.getByLabelText('Why this price changes'), {
      target: { value: 'Submitting something malformed.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save price' }));
    expect(
      await screen.findByText('Check the price, date and reason, then try again.'),
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

  it('names a 404 (the service is not in the practice) in plain words', async () => {
    mount({ body: { error: 'not_found' }, status: 404 });
    await fillPriceAndDate('120');
    fireEvent.change(screen.getByLabelText('Why this price changes'), {
      target: { value: 'Pricing a service that no longer exists.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save price' }));
    expect(
      await screen.findByText(
        'This service is no longer part of the practice. Refresh and try again.',
      ),
    ).toBeTruthy();
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

  it('names a 422 (no VAT rate for that date) in plain words', async () => {
    mount({ body: { error: 'no_vat_setting' }, status: 422 });
    await fillPriceAndDate('120');
    fireEvent.change(screen.getByLabelText('Why this price changes'), {
      target: { value: 'Backdating before any VAT setting existed.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save price' }));
    expect(
      await screen.findByText("There isn't a VAT rate on record for that date yet."),
    ).toBeTruthy();
  });

  it('refuses a price above the int4 column maximum with a plain message, and sends nothing', async () => {
    const { posted } = mount({ body: { price: CREATED_PRICE }, status: 201 });
    await fillPriceAndDate('21474836.48');
    fireEvent.change(screen.getByLabelText('Why this price changes'), {
      target: { value: 'Testing an oversized price.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save price' }));
    expect(await screen.findByText('Enter a price of AED 21,474,836.47 or less.')).toBeTruthy();
    expect(posted).toHaveLength(0);
  });

  it("fetches the VAT rate in force on today's date as soon as it mounts, and previews with it", async () => {
    const { vatRateCalls } = mount(
      { body: { price: CREATED_PRICE }, status: 201 },
      { body: { rateBasisPoints: 500, effectiveFrom: '2018-01-01' } },
    );
    fireEvent.change(screen.getByLabelText('List price (AED, excluding VAT)'), {
      target: { value: '900' },
    });
    // The list price and, with nothing off it, the price charged: the same
    // figure on two rows of the preview.
    expect(await screen.findAllByText('900.00')).toHaveLength(2);
    expect(screen.getByText('45.00')).toBeTruthy(); // VAT at 5%
    expect(screen.getByText('945.00')).toBeTruthy(); // total
    expect(vatRateCalls.length).toBeGreaterThan(0);
  });

  it('re-fetches the VAT rate, and re-previews with the newly fetched rate, when the effective-from date changes', async () => {
    // A rate that differs by the date requested — proving the preview tracks
    // whichever answer the *current* date's fetch returned, not a value
    // cached from the mount-time request for an earlier date.
    const { vatRateCalls } = mount({ body: { price: CREATED_PRICE }, status: 201 }, (date) => ({
      body:
        date === '2027-02-01'
          ? { rateBasisPoints: 700, effectiveFrom: '2027-01-01' }
          : STANDARD_VAT_RATE,
    }));
    fireEvent.change(screen.getByLabelText('List price (AED, excluding VAT)'), {
      target: { value: '900' },
    });
    // At today's default date (the standard 5% rate): 45.00 VAT, 945.00 total.
    expect(await screen.findByText('45.00')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Effective from'), { target: { value: '2027-02-01' } });
    // 900 AED at 7%: 63.00 VAT, 963.00 total — the newly fetched rate, not the mount-time one.
    expect(await screen.findByText('63.00')).toBeTruthy();
    expect(screen.getByText('963.00')).toBeTruthy();
    expect(vatRateCalls.some((call) => call.date === '2027-02-01')).toBe(true);
  });

  it('shows the percentage from the vat-rate answer itself, never from a price row', async () => {
    mount(
      { body: { price: CREATED_PRICE }, status: 201 },
      { body: { rateBasisPoints: 700, effectiveFrom: '2027-01-01' } },
    );
    expect(await screen.findByText('VAT (7%)')).toBeTruthy();
  });

  it('has no VAT rate to preview with when none is in force on the chosen date, and says so', async () => {
    mount(
      { body: { price: CREATED_PRICE }, status: 201 },
      { body: { error: 'not_found' }, status: 404 },
    );
    fireEvent.change(screen.getByLabelText('List price (AED, excluding VAT)'), {
      target: { value: '900' },
    });
    expect(
      await screen.findByText("There isn't a VAT rate on record for that date yet."),
    ).toBeTruthy();
  });
});

describe('a discount on a price', () => {
  it('previews the list price, the discount and the price charged, and sends the discount', async () => {
    const { posted, onCreated } = mount({ body: { price: CREATED_PRICE }, status: 201 });
    await fillPriceAndDate('700');
    fireEvent.change(screen.getByLabelText('Discount'), { target: { value: 'percent' } });
    fireEvent.change(screen.getByLabelText('Discount (%)'), { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText('Why this price changes'), {
      target: { value: 'Launch discount of fifteen per cent.' },
    });
    // The same arithmetic the server writes the row with: 700.00 less 105.00.
    expect(await screen.findByText('105.00')).toBeTruthy();
    expect(screen.getByText('595.00')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save price' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(posted[0]).toMatchObject({
      listPriceFils: 70_000,
      discount: { kind: 'percent', basisPoints: 1500 },
    });
  });

  it('refuses a discount larger than the list price before anything is sent', async () => {
    const { posted } = mount({ body: { price: CREATED_PRICE }, status: 201 });
    await fillPriceAndDate('700');
    fireEvent.change(screen.getByLabelText('Discount'), { target: { value: 'amount' } });
    fireEvent.change(screen.getByLabelText('Discount (AED)'), { target: { value: '900' } });
    fireEvent.change(screen.getByLabelText('Why this price changes'), {
      target: { value: 'A discount larger than the price.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save price' }));
    expect(await screen.findByText('The discount is larger than the list price.')).toBeTruthy();
    expect(posted).toHaveLength(0);
  });

  it('says so in a fixed sentence when the server refuses the discount', async () => {
    const { onCreated } = mount({
      body: { error: 'bad_request', code: 'discount_too_large' },
      status: 400,
    });
    await fillPriceAndDate('700');
    fireEvent.change(screen.getByLabelText('Why this price changes'), {
      target: { value: 'A discount the server refuses.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save price' }));
    expect(await screen.findByText('The discount is larger than the list price.')).toBeTruthy();
    expect(onCreated).not.toHaveBeenCalled();
  });
});

/**
 * The term on a price: how long a single session bought ahead stays usable
 * (migration 412; the operator's ruling of 12 September 2026). A price has
 * never carried one before, and most never will — blank means the credit
 * never expires.
 *
 * The shape on the wire is **optional**, and the two halves of that are what
 * these cases hold apart: a term the coordinator never touched is not sent at
 * all, so the server carries the superseded row's forward, and a term is only
 * taken away when somebody clears it on purpose.
 */
describe('the term a price sells its credits with', () => {
  it('prefills from the price it supersedes, and says the term in words', async () => {
    mount({ body: { price: CREATED_PRICE }, status: 201 }, undefined, [CURRENT_PRICE]);
    await fillPriceAndDate('700');
    expect((screen.getByLabelText('Runs for') as HTMLInputElement).value).toBe('30');
    expect((screen.getByLabelText('Counted in') as HTMLSelectElement).value).toBe('day');
    expect(
      screen.getByText('These credits last 30 days from the day they are bought.'),
    ).toBeTruthy();
  });

  it('leaves the term alone when the figure is amended and the term is not touched', async () => {
    // The screen half of the trap task 3 closed in SQL: no `term` key at all,
    // so the server carries forward rather than being told "none".
    const { posted, onCreated } = mount(
      { body: { price: CREATED_PRICE }, status: 201 },
      undefined,
      [CURRENT_PRICE],
    );
    await fillPriceAndDate('750');
    fireEvent.change(screen.getByLabelText('Why this price changes'), {
      target: { value: 'A figure changes; the term does not.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save price' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(posted[0] && 'term' in posted[0]).toBe(false);
  });

  it('takes the term away only when it is cleared deliberately, and then says so', async () => {
    const { posted, onCreated } = mount(
      { body: { price: CREATED_PRICE }, status: 201 },
      undefined,
      [CURRENT_PRICE],
    );
    await fillPriceAndDate('700');
    fireEvent.change(screen.getByLabelText('Runs for'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Counted in'), { target: { value: '' } });
    expect(screen.getByText('Leave blank and these credits never expire.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Why this price changes'), {
      target: { value: 'These credits stop expiring.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save price' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(posted[0]?.term).toBeNull();
  });

  it('sets a term on a price that never had one, number and unit together', async () => {
    const { posted, onCreated } = mount({ body: { price: CREATED_PRICE }, status: 201 });
    await fillPriceAndDate('700');
    fireEvent.change(screen.getByLabelText('Runs for'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Counted in'), { target: { value: 'month' } });
    fireEvent.change(screen.getByLabelText('Why this price changes'), {
      target: { value: 'A session bought ahead runs for a quarter.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save price' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(posted[0]?.term).toEqual({ amount: 3, unit: 'month' });
  });

  it('goes back to the chosen service\u2019s own term when the service changes', async () => {
    // The term belongs to the price, not to the form: a term typed against
    // one service must not follow the coordinator to another.
    mount({ body: { price: CREATED_PRICE }, status: 201 }, undefined, [CURRENT_PRICE]);
    await fillPriceAndDate('700');
    expect((screen.getByLabelText('Runs for') as HTMLInputElement).value).toBe('30');
    fireEvent.change(screen.getByLabelText('Runs for'), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText('Counted in'), { target: { value: 'month' } });

    fireEvent.change(screen.getByLabelText('Service'), { target: { value: BRAIN_MAP_ID } });
    expect((screen.getByLabelText('Runs for') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Counted in') as HTMLSelectElement).value).toBe('');
    expect(screen.getByText('Leave blank and these credits never expire.')).toBeTruthy();
  });

  it('refuses a number with no unit, and a unit with no number, before anything is sent', async () => {
    const { posted } = mount({ body: { price: CREATED_PRICE }, status: 201 });
    await fillPriceAndDate('700');
    fireEvent.change(screen.getByLabelText('Why this price changes'), {
      target: { value: 'Half a term, twice over.' },
    });

    fireEvent.change(screen.getByLabelText('Runs for'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save price' }));
    expect(await screen.findByText('Choose days or months.')).toBeTruthy();
    expect(posted).toHaveLength(0);

    fireEvent.change(screen.getByLabelText('Runs for'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Counted in'), { target: { value: 'day' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save price' }));
    expect(await screen.findByText('Say how many, or leave both blank.')).toBeTruthy();
    expect(posted).toHaveLength(0);
  });
});
