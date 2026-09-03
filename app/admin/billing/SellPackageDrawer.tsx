import { useEffect, useRef, useState, type FormEvent } from 'react';
import { isoDateIn } from '@domain/shared/actor';
import {
  PAYMENT_METHODS,
  SellPackageResponse,
  type PackageRow,
  type PaymentMethod,
} from '../../api/billing/ledger-schema';
import type { ClientRow } from '../../api/clients/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note, Select } from '../../shell/components/Controls';
import { CloseIcon } from '../../shell/components/Icons';
import { ClientPicker } from './ClientPicker';
import { formatFils } from './money';

/**
 * "Sell a package" — one family, one bundle, and the money if it changed
 * hands there and then.
 *
 * The price is not a field. It is the figure on the price list on the day of
 * the sale, shown here so the coordinator can read it out, and the server
 * takes it from the same place rather than from anything typed here. Selling
 * at a different figure means changing the price list first, which leaves a
 * reason behind it (the founder's decision, 2026-09-03).
 */

const PRACTICE_TIME_ZONE = 'Asia/Dubai';

const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  transfer: 'Bank transfer',
  link: 'Payment link',
};

const FORBIDDEN_MESSAGE = "You don't have permission to sell a package.";
const NOT_FOUND_MESSAGE = 'That package or client is no longer available. Refresh and try again.';
const NOT_SELLABLE_MESSAGE =
  'This package cannot be sold until every service in it has a price. Set the missing price first.';
const GENERIC_MESSAGE = 'The sale could not be recorded. Try again.';
const IN_FUTURE_MESSAGE = 'A sale cannot be dated in the future. Choose today or an earlier date.';

export function SellPackageDrawer({
  bundle,
  onClose,
  onSold,
}: {
  bundle: PackageRow;
  onClose: () => void;
  onSold: (summary: string) => void;
}) {
  const { apiFetch } = useAuth();
  const closeRef = useRef<HTMLButtonElement>(null);

  const [client, setClient] = useState<ClientRow | null>(null);
  const [purchasedOn, setPurchasedOn] = useState(() => isoDateIn(new Date(), PRACTICE_TIME_ZONE));
  const [takingPayment, setTakingPayment] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>('transfer');
  const [reference, setReference] = useState('');
  const [clientError, setClientError] = useState<string | undefined>();
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

  const price = bundle.currentPrice;
  const credits = bundle.components.reduce((total, component) => total + component.quantity, 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!client) {
      setClientError('Choose which family is buying it.');
      return;
    }
    setClientError(undefined);
    if (!price) {
      setFormError(NOT_SELLABLE_MESSAGE);
      return;
    }

    setBusy(true);
    try {
      const res = await apiFetch('/api/billing/package-purchases', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          packageId: bundle.id,
          clientId: client.id,
          purchasedOn,
          ...(takingPayment
            ? {
                payment: {
                  method,
                  // The gross figure: what the family actually hands over.
                  amountFils: price.grossFils,
                  reference: reference.trim() || null,
                },
              }
            : {}),
        }),
      });
      if (res.status === 201) {
        const body = SellPackageResponse.parse(await res.json());
        onSold(
          `${bundle.name} sold to ${client.givenName} ${client.familyName} for AED ` +
            `${formatFils(body.purchase.grossFils)}, invoice ${body.invoiceReference}.`,
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
      if (res.status === 422) {
        setFormError(NOT_SELLABLE_MESSAGE);
        return;
      }
      if (res.status === 400) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        setFormError(body?.code === 'purchase_in_future' ? IN_FUTURE_MESSAGE : GENERIC_MESSAGE);
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
    <aside className="drawer" role="dialog" aria-labelledby="sell-drawer-title">
      <header className="drawer__header">
        <div className="drawer__title">
          <h2 id="sell-drawer-title">Sell {bundle.name}</h2>
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
          <ClientPicker
            id="sell-client"
            label="Client"
            selected={client}
            onSelect={(picked) => {
              setClient(picked);
              setClientError(undefined);
            }}
            error={clientError}
          />

          <Field
            id="sell-purchased-on"
            label="Bought on"
            type="date"
            value={purchasedOn}
            onChange={(e) => setPurchasedOn(e.target.value)}
          />

          <div className="price-preview">
            <div className="price-preview__row">
              <span className="small muted">Credits</span>
              <span className="numeric">{credits}</span>
            </div>
            <div className="price-preview__row">
              <span className="small muted">Price</span>
              <span className="numeric">{price ? formatFils(price.amountFils) : '—'}</span>
            </div>
            <div className="price-preview__row">
              <span className="small muted">
                {price ? `VAT (${price.vatRateBasisPoints / 100}%)` : 'VAT'}
              </span>
              <span className="numeric">{price ? formatFils(price.vatFils) : '—'}</span>
            </div>
            <div className="price-preview__row price-preview__row--total">
              <span>Total (AED)</span>
              <span className="numeric">{price ? formatFils(price.grossFils) : '—'}</span>
            </div>
            <p className="small muted">
              The price on the list. To sell at a different figure, add a package price first.
            </p>
          </div>

          <label className="checkbox" htmlFor="sell-taking-payment">
            <input
              id="sell-taking-payment"
              type="checkbox"
              checked={takingPayment}
              onChange={(e) => setTakingPayment(e.target.checked)}
            />
            <span>Money has changed hands</span>
          </label>

          {takingPayment ? (
            <>
              <Select
                id="sell-method"
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
                id="sell-reference"
                label="Reference"
                type="text"
                maxLength={120}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                hint="A transfer reference or the note taken at the door. Optional, and never a card number."
              />
            </>
          ) : null}

          {formError ? <Note tone="critical">{formError}</Note> : null}

          <div className="drawer__actions">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? 'Recording…' : 'Record the sale'}
            </Button>
          </div>
        </form>
      </div>
    </aside>
  );
}
