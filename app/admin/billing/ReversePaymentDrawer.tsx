import { useRef, useState, type FormEvent } from 'react';
import { ReversalRefusal, ReversePaymentResponse } from '../../api/billing/ledger-schema';
import type { ReceiptRow } from '../../api/billing/document-schema';
import { isRealText } from '../../api/billing/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note } from '../../shell/components/Controls';
import { CloseIcon } from '../../shell/components/Icons';
import { formatFils } from './money';
import { useDrawer } from './useDrawer';

/**
 * Reversing a payment recorded in error (payment reversal, Task 4).
 *
 * A payment cannot be edited once recorded, so a wrong one is cancelled whole
 * and the right one recorded afterwards. The drawer says that in one sentence
 * rather than offering a half-way. The reason is kept on the reversal and out
 * of every list.
 *
 * As CreditNoteDrawer: the idempotency key is made once when the drawer opens,
 * so a double tap or a lost response replays the first answer, while a drawer
 * opened again is a new decision and gets a new key.
 */

const REFUSALS: Record<ReversalRefusal, string> = {
  already_reversed: 'This payment has already been reversed.',
  client_erased: "This client's record has been erased; ask the owner.",
};

const FORBIDDEN_MESSAGE = "You don't have permission to reverse a payment.";
const NOT_FOUND_MESSAGE = 'This payment is no longer there. Reload the list to see what changed.';
const GENERIC_MESSAGE = 'The payment could not be reversed. Try again.';
const REASON_MESSAGE = 'Say why it is being reversed, in a few words.';
const REASON_HINT = "Don't include names or health details.";

export function ReversePaymentDrawer({
  payment,
  onClose,
  onReversed,
}: {
  payment: ReceiptRow;
  onClose: () => void;
  onReversed: (reversal: ReversePaymentResponse['reversal']) => void;
}) {
  const { apiFetch } = useAuth();
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useDrawer(drawerRef, closeRef, onClose);

  const trimmed = reason.trim();
  // The server's own test: eight characters that are not all spaces and not
  // all the same one.
  const longEnough = isRealText(trimmed);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!longEnough) return;
    setFormError(null);
    setBusy(true);
    try {
      const res = await apiFetch(`/api/billing/payments/${payment.id}/reversal`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: trimmed, idempotencyKey }),
      });
      if (res.ok) {
        onReversed(ReversePaymentResponse.parse(await res.json()).reversal);
        return;
      }
      if (res.status === 409) {
        const body = (await res.json().catch(() => null)) as { refusal?: string } | null;
        const refusal = ReversalRefusal.safeParse(body?.refusal);
        setFormError(refusal.success ? REFUSALS[refusal.data] : GENERIC_MESSAGE);
        return;
      }
      if (res.status === 400) setFormError(REASON_MESSAGE);
      else if (res.status === 403) setFormError(FORBIDDEN_MESSAGE);
      else if (res.status === 404) setFormError(NOT_FOUND_MESSAGE);
      else setFormError(GENERIC_MESSAGE);
    } catch {
      setFormError(GENERIC_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside
      ref={drawerRef}
      className="drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reverse-payment-title"
    >
      <header className="drawer__header">
        <div className="drawer__title">
          <h2 id="reverse-payment-title">Reverse {payment.receiptReference ?? 'this payment'}</h2>
        </div>
        <button
          ref={closeRef}
          type="button"
          className="drawer__close"
          aria-label="Close"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </header>
      <div className="drawer__body">
        <form className="drawer__form" onSubmit={(e) => void submit(e)}>
          <p>This cancels the whole payment. Record the right one afterwards.</p>
          <dl className="figures">
            <div>
              <dt>Payment (AED)</dt>
              <dd className="numeric">{formatFils(payment.amountFils)}</dd>
            </div>
            <div>
              <dt>From</dt>
              <dd>{payment.clientName}</dd>
            </div>
          </dl>
          <Field
            id="reverse-payment-reason"
            label="Why is it being reversed?"
            type="text"
            maxLength={200}
            hint={REASON_HINT}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {formError ? <Note tone="critical">{formError}</Note> : null}
          <div className="drawer__actions">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy || !longEnough}>
              Reverse payment
            </Button>
          </div>
        </form>
      </div>
    </aside>
  );
}
