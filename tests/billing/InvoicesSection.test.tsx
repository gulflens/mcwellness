// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { InvoicesSection } from '../../app/admin/billing/InvoicesSection';
import { json, mountWith, OWNER } from './harness';

afterEach(cleanup);

/** The invoice book: numbers that run without gaps, and what each was for. */

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
    mountWith(OWNER, <InvoicesSection />, (url) =>
      url === '/api/billing/invoices' ? json({ invoices: INVOICES }) : null,
    );
    expect(await screen.findByText('INV-000002')).toBeTruthy();
    expect(screen.getByText('INV-000001')).toBeTruthy();
    expect(screen.getByText('Visit')).toBeTruthy();
    expect(screen.getByText('Package')).toBeTruthy();
    expect(screen.getByText('Hazel Harbour')).toBeTruthy();
    expect(screen.getByText('MW-000001')).toBeTruthy();
    // Net, VAT and total, each formatted once by money.ts.
    expect(screen.getByText('10,325.00')).toBeTruthy();
    expect(screen.getByText('516.25')).toBeTruthy();
    expect(screen.getByText('10,841.25')).toBeTruthy();
    // A calendar date read at the practice's midnight, never the raw ISO string.
    expect(screen.getByText('2 Sept 2026')).toBeTruthy();
    expect(screen.queryByText('2026-09-02')).toBeNull();
  });

  it('says so when a page has been cut short', async () => {
    mountWith(OWNER, <InvoicesSection />, (url) =>
      url === '/api/billing/invoices' ? json({ invoices: INVOICES, truncated: true }) : null,
    );
    expect(await screen.findByText('The fifty most recent invoices are shown.')).toBeTruthy();
  });

  it('says so when nothing has been invoiced yet', async () => {
    mountWith(OWNER, <InvoicesSection />, (url) =>
      url === '/api/billing/invoices' ? json({ invoices: [] }) : null,
    );
    expect(await screen.findByText('No invoice has been issued yet.')).toBeTruthy();
  });

  it('names the problem when the book fails to load', async () => {
    mountWith(OWNER, <InvoicesSection />, (url) =>
      url === '/api/billing/invoices' ? json({ error: 'forbidden' }, 403) : null,
    );
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveProperty(
        'textContent',
        'The invoices could not be loaded. Try again.',
      ),
    );
  });
});
