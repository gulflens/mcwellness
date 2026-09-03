import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  PAYMENT_METHODS,
  RecordPaymentResponse,
  type PaymentMethod,
} from '../../api/billing/ledger-schema';
import type { ClientRow } from '../../api/clients/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note, Select } from '../../shell/components/Controls';
import { CloseIcon } from '../../shell/components/Icons';
import { AED_MAX_FILS, formatFils, isAedAmountTooLarge, parseAedToFils } from './money';

/**
 * "Record a payment" — money that arrived, written down once and never
 * edited. A payment recorded in error is corrected by a credit note, not by
 * changing what the practice said it received: `payment` grants no update and
 * no delete at all (402_billing_document.sql), so the drawer says as much
 * before it saves rather than offering an undo that does not exist.
 *
 * The amount is offered as whatever is outstanding, because that is what is
 * usually handed over, and it is a field rather than a fixed figure because
 * families pay in parts.
 */

const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  transfer: 'Bank transfer',
  link: 'Payment link',
};

const FORBIDDEN_MESSAGE = "You don't have permission to record a payment.";
const NOT_FOUND_MESSAGE = 'This client is no longer available. Refresh and try again.';
const GENERIC_MESSAGE = 'The payment could not be recorded. Try again.';

export function PaymentDrawer({
  client,
  outstandingFils,
  onClose,
  onRecorded,
}: {
  client: ClientRow;
  outstandingFils: number;
  onClose: () => void;
  onRecorded: (summary: string) => void;
}) {
  const { apiFetch } = useAuth();
  const closeRef = useRef<HTMLButtonElement>(null);

  const [amount, setAmount] = useState(() =>
    outstandingFils > 0 ? formatFils(outstandingFils).replace(/,/g, '') : '',
  );
  const [method, setMethod] = useState<PaymentMethod>('transfer');
  const [reference, setReference] = useState('');
  const [amountError, setAmountError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [onClose]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const amountFils = parseAedToFils(amount);
    if (amountFils === null || amountFils === 0) {
      setAmountError(
        isAedAmountTooLarge(amount)
          ? `Enter an amount of AED ${formatFils(AED_MAX_FILS)} or less.`
          : 'Enter the amount in AED, such as 1084.13.',
      );
      return;
    }
    setAmountError(undefined);

    setBusy(true);
    try {
      const res = await apiFetch('/api/billing/payments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId: client.id,
          method,
          amountFils,
          reference: reference.trim() || null,
        }),
      });
      if (res.status === 201) {
        const body = RecordPaymentResponse.parse(await res.json());
        onRecorded(
          `AED ${formatFils(body.payment.amountFils)} recorded from ${client.givenName} ` +
            `${client.familyName}.`,
        );
        return;
      }
      if (res.status === 403) {
        setFormError(FORBIDDEN_MESSAGE);
        return;
      }
      if (res.status === 404) {
        setFormError(NOT_FOUND_MESSAGE);
        return;
      }
      setFormError(GENERIC_MESSAGE);
    } catch {
      setFormError(GENERIC_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="drawer" role="dialog" aria-labelledby="payment-drawer-title">
      <header className="drawer__header">
        <div className="drawer__title">
          <h2 id="payment-drawer-title">Record a payment</h2>
          <p className="small muted">
            {client.givenName} {client.familyName}, {client.mrn}
          </p>
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
          <Field
            id="payment-amount"
            label="Amount (AED)"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setAmountError(undefined);
            }}
            hint={
              outstandingFils > 0
                ? `AED ${formatFils(outstandingFils)} is outstanding.`
                : 'Nothing is outstanding on this account.'
            }
            error={amountError}
          />
          <Select
            id="payment-method"
            label="How it was paid"
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod)}
          >
            {PAYMENT_METHODS.map((value) => (
              <option key={value} value={value}>
                {METHOD_LABELS[value]}
              </option>
            ))}
          </Select>
          <Field
            id="payment-reference"
            label="Reference"
            type="text"
            maxLength={120}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            hint="A transfer reference or the note taken at the door. Optional, and never a card number."
          />

          <p className="small muted">
            A payment is written down once. Correcting one is a credit note, not an edit.
          </p>

          {formError ? <Note tone="critical">{formError}</Note> : null}

          <div className="drawer__actions">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? 'Recording…' : 'Record the payment'}
            </Button>
          </div>
        </form>
      </div>
    </aside>
  );
}
