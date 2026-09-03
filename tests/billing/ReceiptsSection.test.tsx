// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReceiptsSection } from '../../app/admin/billing/ReceiptsSection';
import { json, mountWith, OWNER } from './harness';

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
  },
];

const routes = (url: string) =>
  url === '/api/billing/payments' ? json({ receipts: RECEIPTS }) : null;

describe('ReceiptsSection', () => {
  it('lists what was received, how, and against which invoice', async () => {
    mountWith(OWNER, <ReceiptsSection />, routes);
    expect(await screen.findByText('RCP-000002')).toBeTruthy();
    expect(screen.getByText('Bank transfer')).toBeTruthy();
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
      url === '/api/billing/payments' ? json({ receipts: [] }) : null,
    );
    expect(await screen.findByText('No payment has been recorded yet.')).toBeTruthy();
  });

  it('names the problem when the book fails to load', async () => {
    mountWith(OWNER, <ReceiptsSection />, (url) =>
      url === '/api/billing/payments' ? json({ error: 'forbidden' }, 403) : null,
    );
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveProperty(
        'textContent',
        'The receipts could not be loaded. Try again.',
      ),
    );
  });

  it('makes the receipt and opens it', async () => {
    const tab = { location: { href: '' }, close: () => undefined };
    vi.stubGlobal('open', () => tab);

    const { requests } = mountWith(OWNER, <ReceiptsSection />, (url, init) => {
      if (url === '/api/billing/payments') return json({ receipts: RECEIPTS });
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
    await waitFor(() => expect(tab.location.href).toBe('https://example.com/receipt'));
    // It asked for a receipt, naming the payment and not an invoice.
    const made = requests.find((r) => r.url === '/api/billing/documents');
    expect(made?.body).toEqual({ paymentId: '00000007-0000-4000-8000-000000000002' });
    vi.unstubAllGlobals();
  });
});
