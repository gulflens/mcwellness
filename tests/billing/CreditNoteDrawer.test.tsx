// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreditNoteDrawer } from '../../app/admin/billing/CreditNoteDrawer';
import type { InvoiceRow } from '../../app/api/billing/ledger-schema';
import { json, mountWith, OWNER } from './harness';

afterEach(cleanup);

/** Issuing a credit note from the invoice book: the quote, the reason, the refusals. */

const INVOICE: InvoiceRow = {
  id: '00000004-0000-4000-8000-000000000501',
  reference: 'INV-000001',
  number: 1,
  kind: 'package',
  issuedOn: '2026-09-02',
  clientId: '00000005-0000-4000-8000-000000000001',
  clientMrn: 'MW-000001',
  clientName: 'Hazel Harbour',
  netFils: 1_032_500,
  vatFils: 51_625,
  grossFils: 1_084_125,
  discountFils: 0,
  waivedAt: null,
  documentId: null,
  creditNoteReference: null,
  creditNoteId: null,
};

const QUOTE = {
  ok: true,
  plan: {
    netFils: 1_032_500,
    vatFils: 51_625,
    grossFils: 1_084_125,
    releasedNetFils: 722_750,
    usedCredits: 3,
    unusedCredits: 7,
  },
};
const NOTE = {
  creditNote: {
    id: '00000006-0000-4000-8000-000000000001',
    reference: 'CN-000001',
    grossFils: 1_084_125,
    issuedOn: '2026-10-23',
  },
};

function mount(post: Response = json(NOTE, 201), quote: unknown = QUOTE) {
  const onClose = vi.fn();
  const onIssued = vi.fn();
  const mounted = mountWith(
    OWNER,
    <CreditNoteDrawer invoice={INVOICE} onClose={onClose} onIssued={onIssued} />,
    (url, init) => {
      if (url === `/api/billing/invoices/${INVOICE.id}/credit-quote`) return json(quote);
      if (url === `/api/billing/invoices/${INVOICE.id}/credit-note` && init?.method === 'POST') {
        return post;
      }
      return null;
    },
  );
  return { ...mounted, onClose, onIssued };
}

describe('CreditNoteDrawer', () => {
  it('shows what would be credited and how many sessions are unused', async () => {
    mount();
    expect(await screen.findByText('10,841.25')).toBeTruthy();
    expect(screen.getByText('7 unused of 10')).toBeTruthy();
    expect(
      screen.getByText('This corrects a mistake. It is not how a package is ended early.'),
    ).toBeTruthy();
  });

  it('keeps the confirm button disabled until the reason has 8 characters', async () => {
    mount();
    await screen.findByText('7 unused of 10');
    const confirm = screen.getByRole('button', { name: 'Issue credit note' });
    const reason = screen.getByLabelText('Why is it being credited?');
    expect(confirm).toHaveProperty('disabled', true);
    fireEvent.change(reason, { target: { value: 'seven  ' } });
    expect(confirm).toHaveProperty('disabled', true);
    fireEvent.change(reason, { target: { value: 'sold twice' } });
    expect(confirm).toHaveProperty('disabled', false);
  });

  it('sends the reason with one idempotency key and reports the note', async () => {
    const { requests, onIssued } = mount();
    await screen.findByText('7 unused of 10');
    fireEvent.change(screen.getByLabelText('Why is it being credited?'), {
      target: { value: 'sold twice' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Issue credit note' }));
    await waitFor(() => expect(onIssued).toHaveBeenCalled());
    expect(onIssued.mock.calls[0]?.[0]).toEqual(NOTE.creditNote);
    const post = requests.find((r) => r.method === 'POST');
    expect(post?.body).toMatchObject({ reason: 'sold twice' });
    expect((post?.body as { idempotencyKey: string }).idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('says in plain words why a 409 refused', async () => {
    mount(json({ error: 'credit_note_refused', refusal: 'already_credited' }, 409));
    await screen.findByText('7 unused of 10');
    fireEvent.change(screen.getByLabelText('Why is it being credited?'), {
      target: { value: 'sold twice' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Issue credit note' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'This invoice already has a credit note.',
    );
  });

  it('says the refusal up front when the quote is a refusal', async () => {
    mount(json(NOTE), { ok: false, refusal: 'statement' });
    expect(
      await screen.findByText('A statement is a summary, not a sale, so it cannot be credited.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Issue credit note' })).toBeNull();
  });
});
