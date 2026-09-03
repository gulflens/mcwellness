// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PaymentDrawer } from '../../app/admin/billing/PaymentDrawer';
import { json, mountWith, OWNER } from './harness';

afterEach(cleanup);

/**
 * The idempotency key a coordinator never sees, and the one way it could have
 * cost a family money: a key minted when the drawer opened stayed the same
 * across an edit, so correcting a refused amount and pressing again replayed
 * the first attempt's answer — and recorded the wrong figure for ever, in a
 * table that grants no delete.
 */

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

function mount() {
  return mountWith(
    OWNER,
    <PaymentDrawer
      client={CLIENT}
      outstandingFils={73_500}
      onClose={() => undefined}
      onRecorded={() => undefined}
    />,
    (url, init) =>
      url === '/api/billing/payments' && init?.method === 'POST'
        ? json(
            {
              payment: {
                id: '00000004-0000-4000-8000-000000000601',
                clientId: CLIENT.id,
                method: 'transfer',
                amountFils: 73_500,
                receivedAt: '2026-09-02T08:00:00.000Z',
                reference: null,
                invoiceId: null,
              },
            },
            201,
          )
        : null,
  );
}

/** Every key the drawer has sent, in order. */
function keysSent(fetchImpl: unknown): string[] {
  const calls = (fetchImpl as { mock: { calls: [string, RequestInit | undefined][] } }).mock.calls;
  return (
    calls
      .filter(([url]) => url === '/api/billing/payments')
      // apiFetch rebuilds init.headers as a Headers before it calls fetch
      // (app/shell/auth/AuthContext.tsx), so this reads it the same way.
      .map(([, init]) => new Headers(init?.headers).get('idempotency-key') ?? '')
  );
}

describe('the payment drawer’s idempotency key', () => {
  it('sends one, and sends the same one when the identical request is retried', async () => {
    const { fetchImpl } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Record the payment' }));
    await waitFor(() => expect(keysSent(fetchImpl)).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Record the payment' }));
    await waitFor(() => expect(keysSent(fetchImpl)).toHaveLength(2));

    const [first, second] = keysSent(fetchImpl);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    // A straight retry: the server must replay, not record a second payment.
    expect(second).toBe(first);
  });

  it('mints a fresh one once the amount has been corrected', async () => {
    const { fetchImpl } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Record the payment' }));
    await waitFor(() => expect(keysSent(fetchImpl)).toHaveLength(1));

    fireEvent.change(screen.getByLabelText('Amount (AED)'), { target: { value: '500.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record the payment' }));
    await waitFor(() => expect(keysSent(fetchImpl)).toHaveLength(2));

    const [first, second] = keysSent(fetchImpl);
    // A different figure is a different payment. Sending it under the first
    // key would have replayed the first amount and told the coordinator it
    // had recorded the corrected one.
    expect(second).not.toBe(first);
  });

  it('mints a fresh one when the method or the reference changes', async () => {
    const { fetchImpl } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Record the payment' }));
    await waitFor(() => expect(keysSent(fetchImpl)).toHaveLength(1));

    fireEvent.change(screen.getByLabelText('How it was paid'), { target: { value: 'cash' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record the payment' }));
    await waitFor(() => expect(keysSent(fetchImpl)).toHaveLength(2));

    fireEvent.change(screen.getByLabelText('Reference'), { target: { value: 'FT26090201' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record the payment' }));
    await waitFor(() => expect(keysSent(fetchImpl)).toHaveLength(3));

    expect(new Set(keysSent(fetchImpl)).size).toBe(3);
  });
});
