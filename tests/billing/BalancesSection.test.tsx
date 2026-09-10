// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BalancesSection } from '../../app/admin/billing/BalancesSection';
import { expiryOn } from '../../domain/billing';
import { isoDateIn } from '../../domain/shared';
import { json, mountWith, OWNER } from './harness';

afterEach(cleanup);

/**
 * What a person sees when they look up one family's money: the sessions
 * left, what has been charged and paid, and how long the credits last.
 */

const CLIENT_ID = '00000005-0000-4000-8000-000000000001';
const NF_SESSION = '00000004-0000-4000-8000-000000000005';
const BRAIN_MAP = '00000004-0000-4000-8000-000000000003';
const SILVER_PURCHASE_ID = '00000004-0000-4000-8000-000000000401';

/**
 * The fixture's own dates for a programme extended once and twice, derived
 * rather than typed so they stay three months apart exactly as
 * `domain/billing/extension.ts` computes them, whatever the sale's own term
 * happens to be.
 */
const EXPIRES_ON = '2027-09-02';
const FIRST_EXTENSION_TO = expiryOn(EXPIRES_ON, 3);
const SECOND_EXTENSION_TO = expiryOn(FIRST_EXTENSION_TO, 3);

/**
 * A programme that ran out long ago: far enough behind that three more months
 * are still behind today whenever this suite runs. Taken from the day the
 * screen itself is on, because that is the day it judges an extension
 * against.
 */
const LONG_LAPSED_ON = isoDateIn(new Date(Date.now() - 400 * 86_400_000), 'Asia/Dubai');

const CLIENT = {
  id: CLIENT_ID,
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

function balance(over: Record<string, unknown> = {}) {
  return {
    clientId: CLIENT_ID,
    services: [
      {
        serviceTypeId: NF_SESSION,
        serviceTypeCode: 'nf-session',
        serviceTypeName: 'Neurofeedback session',
        serviceTypeNameAr: 'جلسة التغذية الراجعة العصبية',
        purchased: 15,
        delivered: 2,
        forfeited: 1,
        remaining: 12,
        lapsed: 0,
        remainingValueNetFils: 713_832,
        recognisedNetFils: 178_458,
        deferredNetFils: 713_832,
        nextExpiryOn: '2027-09-02',
        expiryWarning: 'none' as const,
      },
      {
        serviceTypeId: BRAIN_MAP,
        serviceTypeCode: 'brain-map',
        serviceTypeName: 'Brain map (QEEG)',
        serviceTypeNameAr: null,
        purchased: 2,
        delivered: 1,
        forfeited: 0,
        remaining: 1,
        lapsed: 0,
        remainingValueNetFils: 70_108,
        recognisedNetFils: 70_108,
        deferredNetFils: 70_108,
        nextExpiryOn: '2027-09-02',
        expiryWarning: 'none' as const,
      },
    ],
    delivered: 3,
    remaining: 13,
    remainingValueNetFils: 783_940,
    recognisedNetFils: 248_566,
    deferredNetFils: 783_940,
    nextExpiryOn: '2027-09-02',
    expiryWarning: 'none' as const,
    outstandingFils: 73_500,
    chargedFils: 1_157_625,
    paidFils: 1_084_125,
    purchases: [
      {
        id: SILVER_PURCHASE_ID,
        clientId: CLIENT_ID,
        packageId: '00000004-0000-4000-8000-000000000201',
        packageName: 'Silver',
        packageNameAr: 'الفضية',
        purchasedOn: '2026-09-02',
        netFils: 1_032_500,
        vatFils: 51_625,
        grossFils: 1_084_125,
        listPriceFils: 1_215_000,
        discountFils: 182_500,
        discountBasisPoints: null,
        discountReason: null,
        expiresOn: EXPIRES_ON,
        extendedTo: null,
        extensionReason: null,
        extensionsUsed: 0,
        extensionsAllowed: 2 as const,
        extendsTo: FIRST_EXTENSION_TO,
        status: 'active' as const,
        invoiceId: '00000004-0000-4000-8000-000000000501',
      },
    ],
    ...over,
  };
}

function mount(body: Record<string, unknown>, canWrite = true) {
  return mountWith(OWNER, <BalancesSection canWrite={canWrite} />, (url, init) => {
    if (url.startsWith('/api/clients?q=')) return json({ clients: [CLIENT], note: null });
    if (url === `/api/billing/clients/${CLIENT_ID}/balance`) return json(body);
    if (url.endsWith('/extension') && init?.method === 'POST') {
      return json(
        {
          purchase: {
            ...(body.purchases as Record<string, unknown>[])[0],
            extendedTo: '2028-03-01',
            extensionReason: 'A long hospital stay over the winter.',
          },
        },
        201,
      );
    }
    if (url === '/api/billing/payments' && init?.method === 'POST') {
      return json(
        {
          payment: {
            id: '00000004-0000-4000-8000-000000000601',
            clientId: CLIENT_ID,
            method: 'cash',
            amountFils: 73_500,
            receivedAt: '2026-09-02T08:00:00.000Z',
            reference: null,
            invoiceId: null,
            receiptReference: 'RCP-000004',
          },
        },
        201,
      );
    }
    return null;
  });
}

async function findClient() {
  fireEvent.change(screen.getByLabelText('Client'), { target: { value: 'Harbour' } });
  fireEvent.click(await screen.findByRole('button', { name: /Hazel Harbour/ }));
}

describe('giving a family longer', () => {
  it('offers it against a package the practice sold', async () => {
    mount(balance());
    await findClient();
    expect(await screen.findByRole('button', { name: 'Extend' })).toBeTruthy();
  });

  it('offers it to nobody who may not record money', async () => {
    mount(balance(), false);
    await findClient();
    await screen.findByText('Silver');
    expect(screen.queryByRole('button', { name: 'Extend' })).toBeNull();
  });

  it('will not take an extension without a reason', async () => {
    mount(balance());
    await findClient();
    fireEvent.click(await screen.findByRole('button', { name: 'Extend' }));
    fireEvent.click(screen.getByRole('button', { name: 'Extend by three months' }));
    expect(
      await screen.findByText(
        'Say why this programme is being extended, in at least 8 characters.',
      ),
    ).toBeTruthy();
  });

  it('offers an extension of three months, says how many are left, and sends the reason alone', async () => {
    const { requests } = mount(balance());
    await findClient();
    fireEvent.click(await screen.findByRole('button', { name: 'Extend' }));
    expect(
      screen.getByText(
        'It runs to 2 Sept 2027 today. An extension adds three months, to 2 Dec 2027. None of the two used yet.',
      ),
    ).toBeTruthy();
    expect(screen.queryByLabelText('Runs to')).toBeNull();
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'Travelling for a month' } });
    fireEvent.click(screen.getByRole('button', { name: 'Extend by three months' }));
    expect(await screen.findByText('Extended to 1 Mar 2028.')).toBeTruthy();
    expect(requests.filter((r) => r.url.endsWith('/extension'))).toEqual([
      {
        url: `/api/billing/package-purchases/${SILVER_PURCHASE_ID}/extension`,
        body: { reason: 'Travelling for a month' },
      },
    ]);
  });

  it('says one of the two is used after the first', async () => {
    const purchases = [
      {
        ...(balance().purchases[0] as Record<string, unknown>),
        extendedTo: FIRST_EXTENSION_TO,
        extensionReason: 'Travelling.',
        extensionsUsed: 1,
        extendsTo: SECOND_EXTENSION_TO,
      },
    ];
    mount(balance({ purchases }));
    await findClient();
    fireEvent.click(await screen.findByRole('button', { name: 'Extend' }));
    expect(screen.getByText(/1 of the two used\./)).toBeTruthy();
  });

  it('offers nothing once the programme has had its two, and says so', async () => {
    const purchases = [
      {
        ...(balance().purchases[0] as Record<string, unknown>),
        extendedTo: SECOND_EXTENSION_TO,
        extensionReason: 'Still away.',
        extensionsUsed: 2,
        extendsTo: null,
      },
    ];
    mount(balance({ purchases }));
    await findClient();
    expect(await screen.findByText('This programme has had its two extensions.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Extend' })).toBeNull();
  });

  it('says so when the route refuses a third', async () => {
    const purchases = [
      {
        ...(balance().purchases[0] as Record<string, unknown>),
        extendedTo: FIRST_EXTENSION_TO,
        extensionReason: 'Travelling.',
        extensionsUsed: 1,
        extendsTo: SECOND_EXTENSION_TO,
      },
    ];
    const body = balance({ purchases });
    const { requests } = mountWith(OWNER, <BalancesSection canWrite={true} />, (url, init) => {
      if (url.startsWith('/api/clients?q=')) return json({ clients: [CLIENT], note: null });
      if (url === `/api/billing/clients/${CLIENT_ID}/balance`) return json(body);
      if (url.endsWith('/extension') && init?.method === 'POST') {
        return json({ error: 'conflict', code: 'extension_limit_reached' }, 409);
      }
      return null;
    });
    await findClient();
    fireEvent.click(await screen.findByRole('button', { name: 'Extend' }));
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'One more, as a favour.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Extend by three months' }));
    expect(
      await screen.findByText(
        'This programme has had its two extensions. A programme that needs longer is a refund and a new sale.',
      ),
    ).toBeTruthy();
    expect(requests.filter((r) => r.url.endsWith('/extension'))).toHaveLength(1);
  });

  it('offers nothing to a programme whose three more months would still be in the past', async () => {
    // The screen must not offer what the route refuses: a programme more than
    // three months past its end cannot be extended into a date the family can
    // use, and pressing the button would spend one of their two for nothing.
    const purchases = [
      {
        ...(balance().purchases[0] as Record<string, unknown>),
        expiresOn: LONG_LAPSED_ON,
        extendsTo: expiryOn(LONG_LAPSED_ON, 3),
      },
    ];
    mount(balance({ purchases }));
    await findClient();
    await screen.findByText('Silver');
    expect(screen.queryByRole('button', { name: 'Extend' })).toBeNull();
  });

  it('says so when the route refuses a programme that ended too long ago', async () => {
    const body = balance();
    mountWith(OWNER, <BalancesSection canWrite={true} />, (url, init) => {
      if (url.startsWith('/api/clients?q=')) return json({ clients: [CLIENT], note: null });
      if (url === `/api/billing/clients/${CLIENT_ID}/balance`) return json(body);
      if (url.endsWith('/extension') && init?.method === 'POST') {
        return json({ error: 'conflict', code: 'ended_too_long_ago' }, 409);
      }
      return null;
    });
    await findClient();
    fireEvent.click(await screen.findByRole('button', { name: 'Extend' }));
    fireEvent.change(screen.getByLabelText('Why'), {
      target: { value: 'The family asked, long after it ran out.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Extend by three months' }));
    expect(
      await screen.findByText(
        'This programme ended more than three months ago, so three more months would still be in the past. A programme that needs longer is a refund and a new sale.',
      ),
    ).toBeTruthy();
  });

  it('says what was given away on a sale, and why', async () => {
    // The operator's purpose for the discount round (docs/SPEC/billing.md
    // section 2.4): the books show what was given away and why. The share is
    // the combined one the purchase carries; the reason is the extra
    // discount's own.
    const purchases = [
      {
        ...(balance().purchases[0] as Record<string, unknown>),
        netFils: 972_000,
        vatFils: 48_600,
        grossFils: 1_020_600,
        discountFils: 243_000,
        discountBasisPoints: 2000,
        discountReason: 'Two siblings on the same programme.',
      },
    ];
    mount(balance({ purchases }));
    await findClient();
    expect(
      await screen.findByText('Discount 20%. Two siblings on the same programme.'),
    ).toBeTruthy();
  });

  it('says nothing about a discount on a sale that had no extra one', async () => {
    mount(balance());
    await findClient();
    await screen.findByText('Silver');
    expect(screen.queryByText(/^Discount /)).toBeNull();
  });

  it('shows the date first agreed, and why it moved, once it has', async () => {
    const purchases = [
      {
        ...(balance().purchases[0] as Record<string, unknown>),
        extendedTo: '2028-03-01',
        extensionReason: 'A long hospital stay over the winter.',
      },
    ];
    mount(balance({ purchases }));
    await findClient();
    expect(await screen.findByText(/Extended from 2 Sept 2027/)).toBeTruthy();
    expect(screen.getByText(/A long hospital stay over the winter/)).toBeTruthy();
  });
});

describe('BalancesSection', () => {
  it('asks for a client before it shows anything', () => {
    mount(balance());
    expect(screen.getByText('Find a client to see what they have left.')).toBeTruthy();
  });

  it('reads "2 of 15" for the sessions a family has had', async () => {
    mount(balance());
    await findClient();
    expect(await screen.findByText('2 of 15')).toBeTruthy();
    expect(screen.getByText('1 of 2')).toBeTruthy();
  });

  it('shows what has been charged, what has been paid and what is left owing', async () => {
    mount(balance());
    await findClient();
    expect(await screen.findByText('11,576.25')).toBeTruthy();
    // The package's gross figure appears twice: once as what has been paid,
    // once beside the package the family bought.
    expect(screen.getAllByText('10,841.25').length).toBe(2);
    expect(screen.getByText('735.00')).toBeTruthy();
    expect(screen.getByText('Outstanding')).toBeTruthy();
  });

  it('calls it credit rather than a negative figure when the practice holds money', async () => {
    mount(balance({ outstandingFils: -50_000, chargedFils: 0, paidFils: 50_000 }));
    await findClient();
    expect(await screen.findByText('In credit')).toBeTruthy();
    expect(screen.queryByText('-500.00')).toBeNull();
  });

  it('counts a forfeited credit apart from a delivered one', async () => {
    mount(balance());
    await findClient();
    await screen.findByText('2 of 15');
    expect(screen.getByText('Forfeited')).toBeTruthy();
  });

  it('marks a sixty-day warning as something to notice, not as another loading line', async () => {
    mount(balance({ expiryWarning: 'sixty_days' }));
    await findClient();
    const note = await screen.findByText(/under two months away/);
    // The tone is the assertion: rendered muted this read exactly like
    // "Loading the balance", which is the one thing an expiry must not do.
    expect(note.className).toContain('note--attention');
    expect(note.getAttribute('role')).toBe('status');
  });

  it('marks a thirty-day warning the same way', async () => {
    mount(balance({ expiryWarning: 'thirty_days' }));
    await findClient();
    const note = await screen.findByText(/under a month away/);
    expect(note.className).toContain('note--attention');
    expect(note.getAttribute('role')).toBe('status');
  });

  it('says a programme has run out, and says it as something wrong now', async () => {
    mount(balance({ expiryWarning: 'expired' }));
    await findClient();
    const note = await screen.findByText('Ran out on 2 Sept 2027.');
    expect(note.className).toContain('note--critical');
    expect(note.getAttribute('role')).toBe('alert');
  });

  it('counts a mixed holding in credits, and says what they are', async () => {
    // Thirteen credits is twelve sessions and a brain map. Calling the total
    // "sessions" was wrong on the one screen where a family's own count is
    // the thing being read.
    mount(balance());
    await findClient();
    expect(await screen.findByText('Credits left')).toBeTruthy();
    expect(screen.getByText('12 × Neurofeedback session, 1 × Brain map (QEEG)')).toBeTruthy();
  });

  it('says which figures carry VAT and which do not', async () => {
    mount(balance());
    await findClient();
    expect(await screen.findByText('Charged, with VAT (AED)')).toBeTruthy();
    expect(screen.getByText('Value left, before VAT (AED)')).toBeTruthy();
  });

  it('says in words how long the credits have left, at sixty days', async () => {
    mount(balance({ nextExpiryOn: '2026-10-20', expiryWarning: 'sixty_days' }));
    await findClient();
    expect(await screen.findByText('Runs out on 20 Oct 2026, under two months away.')).toBeTruthy();
  });

  it('says it more plainly at thirty days', async () => {
    mount(balance({ nextExpiryOn: '2026-09-20', expiryWarning: 'thirty_days' }));
    await findClient();
    expect(await screen.findByText('Runs out on 20 Sept 2026, under a month away.')).toBeTruthy();
  });

  it('lists the packages the family has bought, with the date they run to', async () => {
    mount(balance());
    await findClient();
    expect(await screen.findByText('Packages bought')).toBeTruthy();
    expect(screen.getByText('Bought 2 Sept 2026, runs to 2 Sept 2027')).toBeTruthy();
  });

  it('offers the outstanding amount when a payment is recorded, and says it cannot be edited', async () => {
    mount(balance());
    await findClient();
    fireEvent.click(await screen.findByRole('button', { name: 'Record a payment' }));
    const amount = (await screen.findByLabelText('Amount (AED)')) as HTMLInputElement;
    expect(amount.value).toBe('735.00');
    expect(screen.getByText('AED 735.00 is outstanding.')).toBeTruthy();
    expect(
      screen.getByText(
        'A payment is written down once. Correcting one is a credit note, not an edit.',
      ),
    ).toBeTruthy();
  });

  it('confirms a recorded payment by naming the amount and the family', async () => {
    mount(balance());
    await findClient();
    fireEvent.click(await screen.findByRole('button', { name: 'Record a payment' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Record the payment' }));
    expect(
      await screen.findByText('AED 735.00 recorded from Hazel Harbour, receipt RCP-000004.'),
    ).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers no payment door to somebody who may not record one', async () => {
    mount(balance(), false);
    await findClient();
    await screen.findByText('2 of 15');
    expect(screen.queryByRole('button', { name: 'Record a payment' })).toBeNull();
  });

  it('names the problem when a balance fails to load', async () => {
    mountWith(OWNER, <BalancesSection canWrite />, (url) => {
      if (url.startsWith('/api/clients?q=')) return json({ clients: [CLIENT], note: null });
      if (url === `/api/billing/clients/${CLIENT_ID}/balance`)
        return json({ error: 'forbidden' }, 403);
      return null;
    });
    await findClient();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveProperty(
        'textContent',
        'This balance could not be loaded. Try again.',
      ),
    );
  });
});
