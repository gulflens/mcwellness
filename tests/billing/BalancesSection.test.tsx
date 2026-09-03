// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BalancesSection } from '../../app/admin/billing/BalancesSection';
import { json, mountWith, OWNER } from './harness';

afterEach(cleanup);

/**
 * What a person sees when they look up one family's money: the sessions
 * left, what has been charged and paid, and how long the credits last.
 */

const CLIENT_ID = '00000005-0000-4000-8000-000000000001';
const NF_SESSION = '00000004-0000-4000-8000-000000000005';
const BRAIN_MAP = '00000004-0000-4000-8000-000000000003';

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
        id: '00000004-0000-4000-8000-000000000401',
        clientId: CLIENT_ID,
        packageId: '00000004-0000-4000-8000-000000000201',
        packageName: 'Silver',
        packageNameAr: 'الفضية',
        purchasedOn: '2026-09-02',
        netFils: 1_032_500,
        vatFils: 51_625,
        grossFils: 1_084_125,
        listPriceFils: 1_215_000,
        expiresOn: '2027-09-02',
        extendedTo: null,
        extensionReason: null,
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
    expect(await screen.findByRole('button', { name: 'Give them longer' })).toBeTruthy();
  });

  it('offers it to nobody who may not record money', async () => {
    mount(balance(), false);
    await findClient();
    await screen.findByText('Silver');
    expect(screen.queryByRole('button', { name: 'Give them longer' })).toBeNull();
  });

  it('asks for a date and a reason, and will not take one without the other', async () => {
    mount(balance());
    await findClient();
    fireEvent.click(await screen.findByRole('button', { name: 'Give them longer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Extend it' }));
    expect(await screen.findByText('Choose the date it should run to.')).toBeTruthy();
    expect(
      screen.getByText('Say why this programme is being extended, in at least 8 characters.'),
    ).toBeTruthy();
  });

  it('refuses a date that gives the family less time than they have', async () => {
    mount(balance());
    await findClient();
    fireEvent.click(await screen.findByRole('button', { name: 'Give them longer' }));
    fireEvent.change(screen.getByLabelText('Runs to'), { target: { value: '2027-01-01' } });
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'A long hospital stay.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Extend it' }));
    expect(await screen.findByText(/Choose a date after 2 Sept 2027/)).toBeTruthy();
  });

  it('says what it did, naming the new date', async () => {
    mount(balance());
    await findClient();
    fireEvent.click(await screen.findByRole('button', { name: 'Give them longer' }));
    fireEvent.change(screen.getByLabelText('Runs to'), { target: { value: '2028-03-01' } });
    fireEvent.change(screen.getByLabelText('Why'), {
      target: { value: 'A long hospital stay over the winter.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Extend it' }));
    expect(await screen.findByText('Silver now runs to 1 Mar 2028.')).toBeTruthy();
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
