// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReversePaymentDrawer } from '../../app/admin/billing/ReversePaymentDrawer';
import type { ReceiptRow } from '../../app/api/billing/document-schema';
import { json, mountWith, OWNER } from './harness';

afterEach(cleanup);

/** Reversing a payment recorded in error: the reason, the refusals, the key. */

const PAYMENT: ReceiptRow = {
  id: '00000007-0000-4000-8000-000000000002',
  receiptReference: 'RCP-000002',
  method: 'transfer',
  amountFils: 15_000,
  reference: null,
  receivedOn: '2026-10-20',
  clientId: '00000005-0000-4000-8000-000000000002',
  clientMrn: 'MW-000002',
  clientName: 'Rowan Meadow',
  invoiceReference: null,
  documentId: null,
  reversedOn: null,
  reversalId: null,
};

const REVERSAL = {
  reversal: { id: '00000008-0000-4000-8000-000000000001', reversedOn: '2026-10-23' },
};

function mount(post: Response = json(REVERSAL, 201)) {
  const onClose = vi.fn();
  const onReversed = vi.fn();
  const mounted = mountWith(
    OWNER,
    <ReversePaymentDrawer payment={PAYMENT} onClose={onClose} onReversed={onReversed} />,
    (url, init) =>
      url === `/api/billing/payments/${PAYMENT.id}/reversal` && init?.method === 'POST'
        ? post
        : null,
  );
  return { ...mounted, onClose, onReversed };
}

async function type(reason: string) {
  fireEvent.change(await screen.findByLabelText('Why is it being reversed?'), {
    target: { value: reason },
  });
}

const confirm = () => screen.getByRole('button', { name: 'Reverse payment' });

describe('ReversePaymentDrawer', () => {
  it('says what reversing does, and asks for no names or health details', async () => {
    mount();
    expect(
      await screen.findByText('This cancels the whole payment. Record the right one afterwards.'),
    ).toBeTruthy();
    expect(screen.getByText("Don't include names or health details.")).toBeTruthy();
    expect(screen.getByText('150.00')).toBeTruthy();
  });

  it('keeps the button disabled until the reason is real text', async () => {
    mount();
    await type('short');
    expect(confirm()).toHaveProperty('disabled', true);
    await type('........');
    expect(confirm()).toHaveProperty('disabled', true);
    await type('a b c d e f g');
    expect(confirm()).toHaveProperty('disabled', true);
    await type('entered twice');
    expect(confirm()).toHaveProperty('disabled', false);
  });

  it('sends the reason with one idempotency key and reports the reversal', async () => {
    const { requests, onReversed } = mount();
    await type('entered twice');
    fireEvent.click(confirm());
    await waitFor(() => expect(onReversed).toHaveBeenCalledWith(REVERSAL.reversal));
    const post = requests.find((r) => r.method === 'POST');
    expect(post?.body).toMatchObject({ reason: 'entered twice' });
    expect((post?.body as { idempotencyKey: string }).idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it.each([
    ['already_reversed', 'This payment has already been reversed.'],
    ['client_erased', "This client's record has been erased; ask the owner."],
  ])('says in plain words why a 409 (%s) refused', async (refusal, words) => {
    mount(json({ error: 'reversal_refused', refusal }, 409));
    await type('entered twice');
    fireEvent.click(confirm());
    expect((await screen.findByRole('alert')).textContent).toBe(words);
  });

  it('asks for a reason in a few words on a 400', async () => {
    mount(json({ error: 'bad_request' }, 400));
    await type('entered twice');
    fireEvent.click(confirm());
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Say why it is being reversed, in a few words.',
    );
  });

  it('falls back to a plain message for anything else', async () => {
    mount(json({ error: 'unavailable' }, 503));
    await type('entered twice');
    fireEvent.click(confirm());
    expect((await screen.findByRole('alert')).textContent).toBe(
      'The payment could not be reversed. Try again.',
    );
  });
});
