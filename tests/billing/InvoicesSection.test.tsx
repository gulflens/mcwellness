// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InvoicesSection } from '../../app/admin/billing/InvoicesSection';
import { json, mountWith, OWNER } from './harness';

afterEach(cleanup);

/**
 * The invoice book: numbers that run without gaps, what each was for, and the
 * two actions on every row.
 */

const FIGURES = {
  month: '2026-09',
  cashCollectedFils: 1_032_500,
  revenueRecognisedFils: 68_833,
  deferredNetFils: 963_667,
};

/**
 * The routes this section reads. `registered` says what the practice is today,
 * which is what the sentence above the table reports — not a fact about any
 * invoice in it.
 */
function routes(body: Record<string, unknown>, registered = false) {
  return (url: string) => {
    if (url === '/api/billing/invoices') {
      return json({ practiceVatRegistered: registered, ...body });
    }
    if (url === '/api/billing/summary') return json(FIGURES);
    return null;
  };
}

const INVOICES = [
  {
    id: '00000004-0000-4000-8000-000000000502',
    reference: 'INV-000002',
    number: 2,
    kind: 'session' as const,
    issuedOn: '2026-09-03',
    clientId: '00000005-0000-4000-8000-000000000002',
    clientMrn: 'MW-000002',
    clientName: 'Rowan Meadow',
    netFils: 70_000,
    vatFils: 3_500,
    grossFils: 73_500,
    documentId: null,
  },
  {
    id: '00000004-0000-4000-8000-000000000501',
    reference: 'INV-000001',
    number: 1,
    kind: 'package' as const,
    issuedOn: '2026-09-02',
    clientId: '00000005-0000-4000-8000-000000000001',
    clientMrn: 'MW-000001',
    clientName: 'Hazel Harbour',
    netFils: 1_032_500,
    vatFils: 51_625,
    grossFils: 1_084_125,
    documentId: null,
  },
];

describe('InvoicesSection', () => {
  it('lists the invoice numbers, newest first, and what each was for', async () => {
    mountWith(OWNER, <InvoicesSection />, routes({ invoices: INVOICES }, true));
    expect(await screen.findByText('INV-000002')).toBeTruthy();
    expect(screen.getByText('INV-000001')).toBeTruthy();
    expect(screen.getByText('Visit')).toBeTruthy();
    expect(screen.getByText('Package')).toBeTruthy();
    expect(screen.getByText('Hazel Harbour')).toBeTruthy();
    expect(screen.getByText('MW-000001')).toBeTruthy();
    // Net, VAT and total, each formatted once by money.ts. The net also
    // appears among the month's figures above the table, so this asks for the
    // cell rather than for the only one on the screen.
    expect(screen.getAllByText('10,325.00').length).toBeGreaterThan(0);
    expect(screen.getByText('516.25')).toBeTruthy();
    expect(screen.getByText('10,841.25')).toBeTruthy();
    // A calendar date read at the practice's midnight, never the raw ISO string.
    expect(screen.getByText('2 Sept 2026')).toBeTruthy();
    expect(screen.queryByText('2026-09-02')).toBeNull();
  });

  it('says so when a page has been cut short', async () => {
    mountWith(OWNER, <InvoicesSection />, routes({ invoices: INVOICES, truncated: true }));
    expect(await screen.findByText('The fifty most recent invoices are shown.')).toBeTruthy();
  });

  it('says so when nothing has been invoiced yet', async () => {
    mountWith(OWNER, <InvoicesSection />, routes({ invoices: [] }));
    expect(await screen.findByText('No invoice has been issued yet.')).toBeTruthy();
  });

  it('names the problem when the book fails to load', async () => {
    mountWith(OWNER, <InvoicesSection />, (url) => {
      if (url === '/api/billing/invoices') return json({ error: 'forbidden' }, 403);
      if (url === '/api/billing/summary') return json(FIGURES);
      return null;
    });
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveProperty(
        'textContent',
        'The invoices could not be loaded. Try again.',
      ),
    );
  });
});

describe('what the invoice book says about VAT', () => {
  it('says plainly that the practice is not registered, rather than showing zeroes', async () => {
    // The practice is not registered today. An owner reading a VAT column of
    // nothing should be told why, not left to wonder whether it is missing.
    mountWith(OWNER, <InvoicesSection />, routes({ invoices: INVOICES }, false));
    expect(
      await screen.findByText('The practice is not registered for VAT: invoices carry no VAT.'),
    ).toBeTruthy();
    expect(screen.queryByText('VAT')).toBeNull();
  });

  it('shows the VAT column and says so once the practice is registered', async () => {
    mountWith(OWNER, <InvoicesSection />, routes({ invoices: INVOICES }, true));
    expect(
      await screen.findByText(
        'The practice is registered for VAT: invoices carry VAT at the standard rate.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('VAT')).toBeTruthy();
  });
});

describe('the three figures above the book', () => {
  it('shows what came in, what was earned, and what is still owed', async () => {
    mountWith(OWNER, <InvoicesSection />, routes({ invoices: INVOICES }));
    const cash = await screen.findByText('Cash collected this month (AED)');
    expect(screen.getByText('Revenue recognised (AED)')).toBeTruthy();
    expect(screen.getByText('Owed in sessions (AED)')).toBeTruthy();
    // Read off the figure beside its own label, not off the page: the same
    // amount appears in a row of the book below.
    expect(cash.nextElementSibling?.textContent).toBe('10,325.00');
    expect(screen.getByText('688.33')).toBeTruthy();
    expect(screen.getByText('9,636.67')).toBeTruthy();
    // Two of the three are net and one is gross: set side by side without
    // saying which, the arithmetic a reader would do between them is wrong.
    expect(screen.getByText('What arrived, including any VAT')).toBeTruthy();
    expect(screen.getByText('Earned by delivering, net of VAT')).toBeTruthy();
    expect(screen.getByText('Paid for, not yet delivered, net of VAT')).toBeTruthy();
  });

  it('still shows the book when the figures cannot be had', async () => {
    // They are a courtesy beside the book, not the reason to be on the screen.
    mountWith(OWNER, <InvoicesSection />, (url) => {
      if (url === '/api/billing/invoices') {
        return json({ practiceVatRegistered: false, invoices: INVOICES });
      }
      if (url === '/api/billing/summary') return json({ error: 'internal' }, 500);
      return null;
    });
    expect(await screen.findByText('INV-000002')).toBeTruthy();
    expect(screen.queryByText('Cash collected this month (AED)')).toBeNull();
  });
});

describe('opening a document from a row', () => {
  it('makes the document, asks for a link, and opens that link', async () => {
    // Not a blank tab pointed at it afterwards: `noopener` is what makes
    // window.open hand back nothing to point, so the first version opened a
    // tab and left it blank on every row. Here the real URL is what is opened,
    // and the spy records what the browser was actually asked for.
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);

    const { requests } = mountWith(OWNER, <InvoicesSection />, (url, init) => {
      if (url === '/api/billing/invoices') {
        return json({ practiceVatRegistered: false, invoices: INVOICES });
      }
      if (url === '/api/billing/summary') return json(FIGURES);
      if (url === '/api/billing/documents' && init?.method === 'POST') {
        return json(
          {
            document: {
              id: '00000006-0000-4000-8000-000000000001',
              kind: 'invoice',
              reference: 'INV-000002',
              clientId: '00000005-0000-4000-8000-000000000002',
            },
          },
          201,
        );
      }
      if (url === '/api/billing/documents/00000006-0000-4000-8000-000000000001/link') {
        return json({ url: 'https://example.com/signed', expiresInSeconds: 300 });
      }
      return null;
    });

    const buttons = await screen.findAllByRole('button', { name: 'Open PDF' });
    const first = buttons[0];
    if (!first) throw new Error('There is no Open PDF button.');
    fireEvent.click(first);

    await waitFor(() =>
      expect(opened).toHaveBeenCalledWith('https://example.com/signed', '_blank', 'noopener'),
    );
    expect(requests.some((r) => r.url === '/api/billing/documents')).toBe(true);
    opened.mockRestore();
  });

  it('says what went wrong and opens nothing', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);

    mountWith(OWNER, <InvoicesSection />, (url, init) => {
      if (url === '/api/billing/invoices') {
        return json({ practiceVatRegistered: false, invoices: INVOICES });
      }
      if (url === '/api/billing/summary') return json(FIGURES);
      if (url === '/api/billing/documents' && init?.method === 'POST') {
        return json({ error: 'storage_unavailable' }, 503);
      }
      return null;
    });

    const buttons = await screen.findAllByRole('button', { name: 'Open PDF' });
    const first = buttons[0];
    if (!first) throw new Error('There is no Open PDF button.');
    fireEvent.click(first);

    expect(
      await screen.findByText('The document store cannot be reached. Try again shortly.'),
    ).toBeTruthy();
    expect(opened).not.toHaveBeenCalled();
    opened.mockRestore();
  });

  it('says so when the filed document and a re-render no longer agree', async () => {
    const opened = vi.spyOn(window, 'open').mockReturnValue(null);
    mountWith(OWNER, <InvoicesSection />, (url, init) => {
      if (url === '/api/billing/invoices') {
        return json({ practiceVatRegistered: false, invoices: INVOICES });
      }
      if (url === '/api/billing/summary') return json(FIGURES);
      if (url === '/api/billing/documents' && init?.method === 'POST') {
        return json(
          {
            document: {
              id: '00000006-0000-4000-8000-000000000001',
              kind: 'invoice',
              reference: 'INV-000002',
              clientId: '00000005-0000-4000-8000-000000000002',
            },
          },
          201,
        );
      }
      if (url.endsWith('/link')) {
        return json({ error: 'conflict', code: 'document_bytes_differ' }, 409);
      }
      return null;
    });

    const buttons = await screen.findAllByRole('button', { name: 'Open PDF' });
    const first = buttons[0];
    if (!first) throw new Error('There is no Open PDF button.');
    fireEvent.click(first);

    expect(
      await screen.findByText(
        'This document no longer matches what was filed. Ask for it to be looked at.',
      ),
    ).toBeTruthy();
    opened.mockRestore();
  });
});

describe('sending a document from a row', () => {
  it('opens the drawer on the document, having made it first', async () => {
    mountWith(OWNER, <InvoicesSection />, (url, init) => {
      if (url === '/api/billing/invoices') {
        return json({ practiceVatRegistered: false, invoices: INVOICES });
      }
      if (url === '/api/billing/summary') return json(FIGURES);
      if (url === '/api/billing/documents' && init?.method === 'POST') {
        return json(
          {
            document: {
              id: '00000006-0000-4000-8000-000000000001',
              kind: 'invoice',
              reference: 'INV-000002',
              clientId: '00000005-0000-4000-8000-000000000002',
            },
          },
          201,
        );
      }
      if (url.endsWith('/send-options')) {
        return json({
          contacts: [
            {
              id: '00000009-0000-4000-8000-000000000001',
              name: 'Rowan Meadow',
              relationship: 'self',
              hasPhone: true,
              hasEmail: true,
              whatsappOptIn: true,
            },
          ],
        });
      }
      return null;
    });

    const buttons = await screen.findAllByRole('button', { name: 'Send' });
    const first = buttons[0];
    if (!first) throw new Error('There is no Send button.');
    fireEvent.click(first);

    expect(await screen.findByRole('dialog', { name: 'Send it' })).toBeTruthy();
    expect(await screen.findByRole('option', { name: 'Rowan Meadow' })).toBeTruthy();
  });
});
