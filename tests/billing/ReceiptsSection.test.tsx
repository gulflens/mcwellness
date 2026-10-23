// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReceiptsSection } from '../../app/admin/billing/ReceiptsSection';
import { json, LEAD_PRACTITIONER, mountWith, narrowTo, OWNER } from './harness';

afterEach(cleanup);

/**
 * The receipt book: money received, with its own numbering.
 *
 * The question this screen answers is the one that had no answer before
 * payments had numbers — a family rings to ask what was received against what.
 */

const RECEIPTS = [
  {
    id: '00000007-0000-4000-8000-000000000002',
    receiptReference: 'RCP-000002',
    method: 'transfer' as const,
    amountFils: 70_000,
    reference: 'SYN 0001',
    receivedOn: '2026-09-03',
    clientId: '00000005-0000-4000-8000-000000000002',
    clientMrn: 'MW-000002',
    clientName: 'Rowan Meadow',
    invoiceReference: 'INV-000002',
    documentId: null,
    reversedOn: null,
    reversalId: null,
  },
  {
    id: '00000007-0000-4000-8000-000000000001',
    receiptReference: null,
    method: 'cash' as const,
    amountFils: 25_000,
    reference: null,
    receivedOn: '2026-09-01',
    clientId: '00000005-0000-4000-8000-000000000001',
    clientMrn: 'MW-000001',
    clientName: 'Hazel Harbour',
    invoiceReference: null,
    documentId: null,
    reversedOn: null,
    reversalId: null,
  },
];

const routes = (url: string) =>
  url === '/api/billing/payments/search' ? json({ receipts: RECEIPTS, nextBefore: null }) : null;

describe('ReceiptsSection', () => {
  it('lists what was received, how, and against which invoice', async () => {
    mountWith(OWNER, <ReceiptsSection />, routes);
    expect(await screen.findByText('RCP-000002')).toBeTruthy();
    // In the row; the filter above it carries the same words.
    expect(within(screen.getByRole('table')).getByText('Bank transfer')).toBeTruthy();
    expect(screen.getByText('INV-000002')).toBeTruthy();
    expect(screen.getByText('700.00')).toBeTruthy();
    expect(screen.getByText('Rowan Meadow')).toBeTruthy();
    // A date read at the practice's midnight, never the raw ISO string.
    expect(screen.getByText('3 Sept 2026')).toBeTruthy();
  });

  it('says a payment was on account when it settled no invoice', async () => {
    mountWith(OWNER, <ReceiptsSection />, routes);
    expect(await screen.findByText('On account')).toBeTruthy();
  });

  it('offers no receipt for a payment recorded before payments had numbers', async () => {
    // Nothing invents a number for it, and nothing pretends a document can be
    // made without one (405_billing_receipt.sql).
    mountWith(OWNER, <ReceiptsSection />, routes);
    expect(await screen.findByText('No receipt')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Open PDF' })).toHaveLength(1);
  });

  it('says so when nothing has been received yet', async () => {
    mountWith(OWNER, <ReceiptsSection />, (url) =>
      url === '/api/billing/payments/search' ? json({ receipts: [], nextBefore: null }) : null,
    );
    expect(await screen.findByText('No payment has been recorded yet.')).toBeTruthy();
  });

  it('names the problem when the book fails to load', async () => {
    mountWith(OWNER, <ReceiptsSection />, (url) =>
      url === '/api/billing/payments/search' ? json({ error: 'forbidden' }, 403) : null,
    );
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveProperty(
        'textContent',
        'The receipts could not be loaded. Try again.',
      ),
    );
  });

  it('makes the receipt and opens the link it is given', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);

    const { requests } = mountWith(OWNER, <ReceiptsSection />, (url, init) => {
      if (url === '/api/billing/payments/search') {
        return json({ receipts: RECEIPTS, nextBefore: null });
      }
      if (url === '/api/billing/documents' && init?.method === 'POST') {
        return json(
          {
            document: {
              id: '00000006-0000-4000-8000-000000000009',
              kind: 'receipt',
              reference: 'RCP-000002',
              clientId: '00000005-0000-4000-8000-000000000002',
            },
          },
          201,
        );
      }
      if (url === '/api/billing/documents/00000006-0000-4000-8000-000000000009/link') {
        return json({ url: 'https://example.com/receipt', expiresInSeconds: 300 });
      }
      return null;
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Open PDF' }));
    await waitFor(() =>
      expect(opened).toHaveBeenCalledWith('https://example.com/receipt', '_blank', 'noopener'),
    );
    // It asked for a receipt, naming the payment and not an invoice.
    const made = requests.find((r) => r.url === '/api/billing/documents');
    expect(made?.body).toEqual({ paymentId: '00000007-0000-4000-8000-000000000002' });
    opened.mockRestore();
  });
});

/**
 * Money in, by day (operator, 20 October 2026): the month's receipts, a search
 * and a filter sent in a request's body, fifty at a time, and Record a payment
 * here where money received is read.
 */
describe('finding a payment, the older ones, and recording one', () => {
  afterEach(() => vi.unstubAllGlobals());

  function bodies(requests: { url: string; body: unknown }[]) {
    return requests
      .filter((r) => r.url === '/api/billing/payments/search')
      .map((r) => r.body as Record<string, unknown>);
  }

  const FIGURES = {
    month: '2026-09',
    cashCollectedFils: 95_000,
    revenueRecognisedFils: 0,
    deferredNetFils: 0,
  };

  it("leads with the month's receipts", async () => {
    mountWith(OWNER, <ReceiptsSection />, (url) =>
      url === '/api/billing/summary' ? json(FIGURES) : routes(url),
    );
    const label = await screen.findByText('Received this month (AED)');
    expect(label.nextElementSibling?.textContent).toBe('950.00');
  });

  it('searches and filters in the request body, never the address', async () => {
    const { requests } = mountWith(OWNER, <ReceiptsSection />, routes);
    await screen.findByText('RCP-000002');
    expect(bodies(requests)[0]).toEqual({});
    fireEvent.change(screen.getByLabelText('Find a receipt'), { target: { value: 'Meadow' } });
    await waitFor(() => expect(bodies(requests).at(-1)).toEqual({ search: 'Meadow' }));
    const group = screen.getByRole('group', { name: 'How it was paid' });
    fireEvent.click(within(group).getByRole('button', { name: 'Cash' }));
    await waitFor(() =>
      expect(bodies(requests).at(-1)).toEqual({ search: 'Meadow', methods: ['cash'] }),
    );
    expect(requests.every((r) => !r.url.includes('Meadow'))).toBe(true);
  });

  it('shows the older payments, asking with the cursor the last page gave', async () => {
    const { requests } = mountWith(OWNER, <ReceiptsSection />, (url, init) => {
      if (url !== '/api/billing/payments/search') return null;
      const body = JSON.parse(String(init?.body)) as { before?: string };
      return body.before === 'cursor-1'
        ? json({ receipts: [RECEIPTS[1]], nextBefore: null })
        : json({ receipts: [RECEIPTS[0]], nextBefore: 'cursor-1' });
    });
    await screen.findByText('RCP-000002');
    expect(screen.queryByText('Hazel Harbour')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show older payments' }));
    expect(await screen.findByText('Hazel Harbour')).toBeTruthy();
    expect(bodies(requests).at(-1)).toEqual({ before: 'cursor-1' });
    expect(screen.queryByRole('button', { name: 'Show older payments' })).toBeNull();
  });

  it('bands the book by the day the money came, by the practice’s calendar', async () => {
    mountWith(OWNER, <ReceiptsSection />, routes);
    await screen.findByText('RCP-000002');
    expect(screen.getByText('Thursday, 3 September')).toBeTruthy();
    expect(screen.getByText('Tuesday, 1 September')).toBeTruthy();
  });

  it("lists a phone's payments a day at a time, a tap showing the two actions", async () => {
    narrowTo(360);
    mountWith(OWNER, <ReceiptsSection />, routes);
    const day = await screen.findByRole('region', { name: 'Receipts, Thursday, 3 September' });
    expect(document.querySelector('table')).toBeNull();
    const row = within(day).getByRole('button');
    expect(row.textContent).toContain('Rowan Meadow');
    expect(row.textContent).toContain('RCP-000002, Bank transfer, INV-000002');
    fireEvent.click(row);
    expect(screen.getByRole('button', { name: 'Open PDF' })).toBeTruthy();
  });

  it('records a payment from here: whose it is first, then what they owe, then the book again', async () => {
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
    const { requests } = mountWith(OWNER, <ReceiptsSection canWrite />, (url, init) => {
      if (url === '/api/clients/search') return json({ clients: [CLIENT], note: null });
      if (url === `/api/billing/clients/${CLIENT.id}/balance`) {
        return json({
          clientId: CLIENT.id,
          remaining: 0,
          delivered: 0,
          remainingValueNetFils: 0,
          recognisedNetFils: 0,
          deferredNetFils: 0,
          services: [],
          purchases: [],
          chargedFils: 25_000,
          paidFils: 0,
          creditedFils: 0,
          reversedFils: 0,
          outstandingFils: 25_000,
          nextExpiryOn: null,
          expiryWarning: 'none',
        });
      }
      if (url === '/api/billing/payments' && init?.method === 'POST') {
        return json(
          {
            payment: {
              id: '00000004-0000-4000-8000-000000000602',
              clientId: CLIENT.id,
              method: 'cash',
              amountFils: 25_000,
              receivedAt: '2026-09-04T08:00:00.000Z',
              reference: null,
              invoiceId: null,
              receiptReference: 'RCP-000005',
            },
          },
          201,
        );
      }
      return routes(url);
    });
    await screen.findByText('RCP-000002');
    fireEvent.click(screen.getByRole('button', { name: 'Record a payment' }));
    expect(await screen.findByText('Whose payment is it?')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Client'), { target: { value: 'Harbour' } });
    fireEvent.click(await screen.findByRole('button', { name: /Hazel Harbour/ }));
    const amount = (await screen.findByLabelText('Amount (AED)')) as HTMLInputElement;
    expect(amount.value).toBe('250.00');
    fireEvent.click(screen.getByRole('button', { name: 'Record the payment' }));
    expect(
      await screen.findByText('AED 250.00 recorded from Hazel Harbour, receipt RCP-000005.'),
    ).toBeTruthy();
    // The book is asked for again, so the new receipt is in it.
    await waitFor(() => expect(bodies(requests).length).toBe(2));
  });

  it('offers no Record a payment to someone who may not record one', async () => {
    mountWith(OWNER, <ReceiptsSection canWrite={false} />, routes);
    await screen.findByText('RCP-000002');
    expect(screen.queryByRole('button', { name: 'Record a payment' })).toBeNull();
  });
});

/** Reversing a payment recorded in error (payment reversal, Task 4). */
describe('reversing a payment', () => {
  afterEach(() => vi.unstubAllGlobals());

  const REVERSED = {
    ...RECEIPTS[0]!,
    reversedOn: '2026-09-04',
    reversalId: '00000008-0000-4000-8000-000000000001',
  };
  const FINANCE = { ...OWNER, roles: ['finance'] };

  it('offers Reverse payment to finance, on a payment that stands', async () => {
    mountWith(FINANCE, <ReceiptsSection />, routes);
    await screen.findByText('RCP-000002');
    expect(screen.getAllByRole('button', { name: 'Reverse payment' })).toHaveLength(2);
  });

  it('offers it to no one else', async () => {
    mountWith(LEAD_PRACTITIONER, <ReceiptsSection />, routes);
    await screen.findByText('RCP-000002');
    expect(screen.queryByRole('button', { name: 'Reverse payment' })).toBeNull();
  });

  it('says Reversed and the date on a reversed row, with no action', async () => {
    mountWith(OWNER, <ReceiptsSection />, (url) =>
      url === '/api/billing/payments/search'
        ? json({ receipts: [REVERSED], nextBefore: null })
        : null,
    );
    expect(await screen.findByText('Reversed 4 Sept 2026')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reverse payment' })).toBeNull();
  });

  it('offers it on a phone too, after a tap', async () => {
    narrowTo(360);
    mountWith(OWNER, <ReceiptsSection />, routes);
    const day = await screen.findByRole('region', { name: 'Receipts, Thursday, 3 September' });
    fireEvent.click(within(day).getByRole('button'));
    expect(screen.getByRole('button', { name: 'Reverse payment' })).toBeTruthy();
  });

  it('reads a negative month clearly, with a true minus', async () => {
    mountWith(OWNER, <ReceiptsSection />, (url) =>
      url === '/api/billing/summary'
        ? json({
            month: '2026-09',
            cashCollectedFils: -15_000,
            revenueRecognisedFils: 0,
            deferredNetFils: 0,
          })
        : routes(url),
    );
    const label = await screen.findByText('Received this month (AED)');
    expect(label.nextElementSibling?.textContent).toBe('\u2212150.00');
  });

  it('opens the drawer, and a success marks the row reversed without reloading', async () => {
    const { requests } = mountWith(OWNER, <ReceiptsSection />, (url, init) => {
      if (url === `/api/billing/payments/${RECEIPTS[0]!.id}/reversal` && init?.method === 'POST') {
        return json(
          { reversal: { id: '00000008-0000-4000-8000-000000000001', reversedOn: '2026-09-04' } },
          201,
        );
      }
      return routes(url);
    });
    await screen.findByText('RCP-000002');
    fireEvent.click(screen.getAllByRole('button', { name: 'Reverse payment' })[0]!);
    const reason = await screen.findByLabelText('Why is it being reversed?');
    const confirm = within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Reverse payment',
    });
    expect(confirm).toHaveProperty('disabled', true);
    fireEvent.change(reason, { target: { value: 'entered twice' } });
    fireEvent.click(confirm);
    expect(await screen.findByText('Reversed 4 Sept 2026')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(requests.filter((r) => r.url === '/api/billing/payments/search')).toHaveLength(1);
  });

  it('says why a 409 refused, and keeps the row as it was', async () => {
    mountWith(OWNER, <ReceiptsSection />, (url, init) =>
      init?.method === 'POST' && url.endsWith('/reversal')
        ? json({ error: 'reversal_refused', refusal: 'already_reversed' }, 409)
        : routes(url),
    );
    await screen.findByText('RCP-000002');
    fireEvent.click(screen.getAllByRole('button', { name: 'Reverse payment' })[0]!);
    fireEvent.change(await screen.findByLabelText('Why is it being reversed?'), {
      target: { value: 'entered twice' },
    });
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Reverse payment' }),
    );
    expect((await screen.findByRole('alert')).textContent).toBe(
      'This payment has already been reversed.',
    );
    expect(screen.queryByText(/^Reversed /)).toBeNull();
  });
});
