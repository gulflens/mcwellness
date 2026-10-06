import { useRef, useState, type FormEvent } from 'react';
import { termWords } from '@domain/billing';
import { displayFromIso } from '@domain/shared';
import { isoDateIn } from '@domain/shared/actor';
import {
  PAYMENT_METHODS,
  SellPackageResponse,
  type PackageRow,
  type PaymentMethod,
} from '../../api/billing/ledger-schema';
import type { ClientRow } from '../../api/clients/schema';
import { isRealText, MINIMUM_REASON } from '../../api/billing/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note, Select } from '../../shell/components/Controls';
import { DateField } from '../../shell/components/DateField';
import { CloseIcon } from '../../shell/components/Icons';
import { ClientPicker } from './ClientPicker';
import { DiscountFields } from './DiscountFields';
import { useAttemptKey } from './attempt';
import { useDrawer } from './useDrawer';
import {
  formatFils,
  previewSaleDiscount,
  saleDiscountTooLargeWords,
  saleDiscountBody,
  saleRoomWords,
  previewVat,
  type SaleDiscountKind,
} from './money';

/**
 * "Sell a package" — one family, one bundle, and the money if it changed
 * hands there and then.
 *
 * The price is not a field. It is the figure on the price list on the day of
 * the sale, shown here so the coordinator can read it out, and the server
 * takes it from the same place rather than from anything typed here. Selling
 * at a different *figure* means changing the price list first, which leaves a
 * reason behind it (the founder's decision, 2026-09-03).
 *
 * What may be given here is an **extra discount** off the same list figure,
 * with a reason, by the owner, an admin or finance (docs/SPEC/billing.md
 * section 2.4). The preview combines it with the price list's own discount
 * through `domain/billing/discount.ts` — the arithmetic the server runs — so
 * what the coordinator reads out is what the invoice will say.
 *
 * **The term is the bundle's own, and a bundle may have none.** Where it
 * carries one the drawer says how long the credits last, in the rule's own
 * words (`domain/billing/term.ts`, the same function the invoice line uses);
 * where it carries none the credits never expire and the drawer says nothing
 * at all rather than a sentence about not having a term (the operator's
 * ruling of 12 September 2026).
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
const NOT_ALLOCATABLE_MESSAGE =
  'Every service in this package is priced at nothing, so its price cannot be shared between them. Give at least one service a price first.';
const GENERIC_MESSAGE = 'The sale could not be recorded. Try again.';
const IN_FUTURE_MESSAGE = 'A sale cannot be dated in the future. Choose today or an earlier date.';
const DISCOUNT_TOO_LARGE_MESSAGE = 'The discount is larger than the list price.';
const NO_DISCOUNT_PERMISSION_MESSAGE = "You don't have permission to give an extra discount.";

/**
 * A sale dated before the prices it needs had started. Every price exists,
 * only later than the date chosen, so the words are about the date — never
 * "set the missing price", which sent the owner looking for a price that was
 * already there (a sale dated 18/08 against prices from September).
 */
function noPriceOnDateMessage(purchasedOn: string, earliestOn: string): string {
  return (
    `No price was in force on ${displayFromIso(purchasedOn)}. Prices for this package start ` +
    `on ${displayFromIso(earliestOn)} — choose that date or later.`
  );
}

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
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const [client, setClient] = useState<ClientRow | null>(null);
  const [purchasedOn, setPurchasedOn] = useState(() => isoDateIn(new Date(), PRACTICE_TIME_ZONE));
  const [takingPayment, setTakingPayment] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>('transfer');
  const [reference, setReference] = useState('');
  const [discountKind, setDiscountKind] = useState<SaleDiscountKind>('none');
  const [discountValue, setDiscountValue] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const [discountError, setDiscountError] = useState<string | undefined>();
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [clientError, setClientError] = useState<string | undefined>();
  const [dateError, setDateError] = useState<string | undefined>();
  /**
   * The first date the sale route will sell this package on, once it has
   * said so. Not known before: the catalogue carries only the price in force
   * today, and an earlier price may well cover an earlier date, so guessing
   * from it would refuse a backdated sale that would have gone through.
   */
  const [earliestOn, setEarliestOn] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * The key for the request about to be sent. It stays the same while the
   * request does, so a straight retry replays the first answer; it changes
   * the moment the amount, the family or anything else does, so a corrected
   * attempt is a new one (app/admin/billing/attempt.ts).
   */
  const keyFor = useAttemptKey();

  useDrawer(drawerRef, closeRef, onClose);

  const price = bundle.currentPrice;
  // The price list's own discount and this sale's extra, combined once against
  // the list figure — the same call the sale route makes.
  const applied = price
    ? previewSaleDiscount(
        price.listPriceFils,
        { discountFils: price.discountFils, basisPoints: price.discountBasisPoints },
        discountKind,
        discountValue,
      )
    : null;
  // The rate is charged only while the row itself carries VAT: an unregistered
  // practice's gross is its net (migration 406), and what the family hands over
  // must equal the invoice's gross.
  const charged =
    applied === null || price === null
      ? null
      : price.vatFils > 0
        ? previewVat(applied.netFils, price.vatRateBasisPoints)
        : { vatFils: 0, grossFils: applied.netFils };
  // A sale given away free: nothing changes hands, so no payment is asked
  // for (the route refuses a payment of nothing).
  const nothingToPay = charged !== null && charged.grossFils === 0;
  // Whatever the price list still leaves to give; null when it already gives
  // the whole price, and then Free is not offered.
  const room = price
    ? saleRoomWords(price.listPriceFils, {
        discountFils: price.discountFils,
        basisPoints: price.discountBasisPoints,
      })
    : null;
  const credits = bundle.components.reduce((total, component) => total + component.quantity, 0);
  /**
   * "15 sessions, 2 brain maps, 1 consultation".
   *
   * The total on its own said "18 sessions", which is not what a family is
   * buying: eighteen credits, fifteen of which are sessions. A credit is the
   * ledger's word and belongs to the mixed total; a session is the family's
   * word and belongs to the sessions.
   */
  const contents = bundle.components
    .map((component) => `${component.quantity} × ${component.serviceTypeName}`)
    .join(', ');
  // Null for a bundle with no term: the credits never expire, and nothing is
  // printed. The drawer words nothing itself.
  const term = termWords(bundle.term);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!client) {
      setClientError('Choose which family is buying it.');
      return;
    }
    setClientError(undefined);
    if (!purchasedOn) {
      // DateField empties the value for a date below its minimum.
      setDateError(
        earliestOn
          ? `Choose ${displayFromIso(earliestOn)} or later.`
          : 'Enter the date it was bought.',
      );
      return;
    }
    setDateError(undefined);
    if (!price) {
      setFormError(NOT_SELLABLE_MESSAGE);
      return;
    }
    if (discountKind !== 'none' && applied === null) {
      setDiscountError(
        saleDiscountTooLargeWords(
          price.listPriceFils,
          { discountFils: price.discountFils, basisPoints: price.discountBasisPoints },
          discountKind,
          discountValue,
        ) ??
          (discountKind === 'percent'
            ? 'Enter a percentage between 0 and 100, such as 5.'
            : DISCOUNT_TOO_LARGE_MESSAGE),
      );
      return;
    }
    setDiscountError(undefined);
    const trimmedReason = discountReason.trim();
    if (discountKind !== 'none' && !isRealText(trimmedReason)) {
      setReasonError(`Say why in at least ${MINIMUM_REASON} characters.`);
      return;
    }
    setReasonError(undefined);
    const extra = saleDiscountBody(discountKind, discountValue);

    setBusy(true);
    try {
      const payload = {
        packageId: bundle.id,
        clientId: client.id,
        purchasedOn,
        ...(extra ? { extraDiscount: { discount: extra, reason: trimmedReason } } : {}),
        ...(takingPayment && !nothingToPay
          ? {
              payment: {
                method,
                // The gross figure: what the family actually hands over. The
                // API's gross is what the practice charges today — the price
                // plus VAT while it is registered for VAT, and the price
                // itself while it is not (migration 406) — so this is the
                // same figure as the invoice the same request creates, and a
                // sale leaves nothing owed and nothing overpaid — including
                // when an extra discount has just moved it.
                amountFils: charged?.grossFils ?? price.grossFils,
                reference: reference.trim() || null,
              },
            }
          : {}),
      };
      const res = await apiFetch('/api/billing/package-purchases', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': keyFor(JSON.stringify(payload)),
        },
        body: JSON.stringify(payload),
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
        setFormError(extra ? NO_DISCOUNT_PERMISSION_MESSAGE : FORBIDDEN_MESSAGE);
        return;
      }
      if (res.status === 404) {
        setFormError(NOT_FOUND_MESSAGE);
        return;
      }
      if (res.status === 422) {
        const body = (await res.json().catch(() => null)) as {
          code?: string;
          earliestOn?: string;
        } | null;
        if (body?.code === 'no_price_on_date' && body.earliestOn) {
          setEarliestOn(body.earliestOn);
          setFormError(noPriceOnDateMessage(purchasedOn, body.earliestOn));
        } else {
          setFormError(
            body?.code === 'not_allocatable' ? NOT_ALLOCATABLE_MESSAGE : NOT_SELLABLE_MESSAGE,
          );
        }
        return;
      }
      if (res.status === 400) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        setFormError(
          body?.code === 'purchase_in_future'
            ? IN_FUTURE_MESSAGE
            : body?.code === 'discount_too_large'
              ? DISCOUNT_TOO_LARGE_MESSAGE
              : GENERIC_MESSAGE,
        );
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
    <aside
      ref={drawerRef}
      className="drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sell-drawer-title"
    >
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

          <DateField
            id="sell-purchased-on"
            label="Bought on"
            value={purchasedOn}
            onChange={(next) => {
              setPurchasedOn(next);
              setDateError(undefined);
            }}
            min={earliestOn ?? undefined}
            error={dateError}
          />

          <div className="price-preview">
            <div className="price-preview__row">
              <span className="small muted">Credits</span>
              <span className="numeric">{credits}</span>
            </div>
            <div className="price-preview__row price-preview__row--contents">
              <span className="small muted">{contents}</span>
            </div>
            <div className="price-preview__row">
              <span className="small muted">List price</span>
              <span className="numeric">{price ? formatFils(price.listPriceFils) : '—'}</span>
            </div>
            {price && price.discountFils > 0 ? (
              <div className="price-preview__row">
                <span className="small muted">
                  {price.discountBasisPoints === null
                    ? 'Discount on the list'
                    : `Discount on the list (${price.discountBasisPoints / 100}%)`}
                </span>
                <span className="numeric">{formatFils(price.discountFils)}</span>
              </div>
            ) : null}
            <div className="price-preview__row">
              <span className="small muted">Price after discount</span>
              <span className="numeric">{applied ? formatFils(applied.netFils) : '—'}</span>
            </div>
            <div className="price-preview__row">
              <span className="small muted">
                {/* The percentage is the row's stamped rate; it is named only while
                    something is charged at it (migration 406). */}
                {price && price.vatFils > 0 ? `VAT (${price.vatRateBasisPoints / 100}%)` : 'VAT'}
              </span>
              <span className="numeric">{charged ? formatFils(charged.vatFils) : '—'}</span>
            </div>
            <div className="price-preview__row price-preview__row--total">
              <span>Total (AED)</span>
              <span className="numeric">{charged ? formatFils(charged.grossFils) : '—'}</span>
            </div>
            <p className="small muted">
              The price on the list. To sell at a different figure, add a package price first.
            </p>
          </div>

          <DiscountFields
            id="sell-discount"
            label="Extra discount for this sale"
            kind={discountKind}
            value={discountValue}
            error={discountError}
            offerFree={room !== null}
            hint={room}
            onChange={(next) => {
              setDiscountKind(next.kind);
              setDiscountValue(next.value);
              setDiscountError(undefined);
              setFormError(null);
            }}
          />
          {discountKind === 'none' ? null : (
            <Field
              id="sell-discount-reason"
              label="Why"
              type="text"
              maxLength={200}
              value={discountReason}
              onChange={(e) => {
                setDiscountReason(e.target.value);
                setReasonError(undefined);
              }}
              error={reasonError}
              hint="Only the owner, an admin or finance may give an extra discount."
            />
          )}

          {nothingToPay ? null : (
            <label className="checkbox" htmlFor="sell-taking-payment">
              <input
                id="sell-taking-payment"
                type="checkbox"
                checked={takingPayment}
                onChange={(e) => setTakingPayment(e.target.checked)}
              />
              <span>Money has changed hands</span>
            </label>
          )}

          {takingPayment && !nothingToPay ? (
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

          {term ? <p className="sell__term">Runs {term.en} from today.</p> : null}

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
