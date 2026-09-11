import { useEffect, useRef, useState, type FormEvent } from 'react';
import { termWords } from '@domain/billing';
import { isoDateIn } from '@domain/shared/actor';
import {
  PAYMENT_METHODS,
  SellSessionResponse,
  type PaymentMethod,
} from '../../api/billing/ledger-schema';
import {
  isRealText,
  MINIMUM_REASON,
  PricesResponse,
  type PriceRow,
} from '../../api/billing/schema';
import type { ClientRow } from '../../api/clients/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note, Select } from '../../shell/components/Controls';
import { CloseIcon } from '../../shell/components/Icons';
import { ClientPicker } from './ClientPicker';
import { DiscountFields } from './DiscountFields';
import { useAttemptKey } from './attempt';
import { useDrawer } from './useDrawer';
import {
  discountBody,
  formatFils,
  previewSaleDiscount,
  previewVat,
  type DiscountKind,
} from './money';

/**
 * "Sell a session" — one family, one visit, sold and paid for before it
 * happens.
 *
 * Until now a single visit outside a package could only be charged after
 * the practitioner closed it (`app.charge_single_visit`, migration 404). This
 * is the "package of one": the same shape as `SellPackageDrawer`, for
 * exactly one credit of one priced service, chosen here rather than passed
 * in as a prop, because a single sale has no bundle to be opened against.
 *
 * The price is not a field, for the same reason it is not one on the package
 * drawer: it is the figure on the price list on the day of the sale, read out
 * here rather than typed, and the server takes it from the same place.
 * Selling at a different figure means changing the price list first, which
 * leaves a reason behind it. What may be given here is an **extra discount**
 * off the same list figure, with a reason, by the owner, an admin or finance
 * (docs/SPEC/billing.md section 2.4). The preview combines it with the price
 * list's own discount through `domain/billing/discount.ts` — the arithmetic
 * the server runs — so what the coordinator reads out is what the invoice
 * will say.
 *
 * **How long the credit lasts is the price row's own business.** A price may
 * carry a term — a number with its unit beside it — and where it carries none
 * the credit never expires, which is what every price carries until the
 * practice sets one (migration 412, the operator's ruling of 12 September
 * 2026). The drawer reads the term off the row it is selling at and says it in
 * the rule's own words, or says nothing at all; it is no longer twelve months
 * from a constant in the code.
 *
 * Nothing about `app.charge_single_visit` changes: a visit with no credit
 * against it is still charged when it closes. This drawer only gives a
 * family the choice to buy the credit first.
 */

const PRACTICE_TIME_ZONE = 'Asia/Dubai';

const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  transfer: 'Bank transfer',
  link: 'Payment link',
};

const FORBIDDEN_MESSAGE = "You don't have permission to sell a session.";
const NOT_FOUND_MESSAGE = 'That client is no longer available. Refresh and try again.';
const NOT_PRICED_MESSAGE = 'This service has no price on that day. Set a price first.';
const CHOOSE_SERVICE_MESSAGE = 'Choose which service is being sold.';
const GENERIC_MESSAGE = 'The sale could not be recorded. Try again.';
const IN_FUTURE_MESSAGE = 'A sale cannot be dated in the future. Choose today or an earlier date.';
const DISCOUNT_TOO_LARGE_MESSAGE = 'The discount is larger than the list price.';
const NO_DISCOUNT_PERMISSION_MESSAGE = "You don't have permission to give an extra discount.";
const PRICES_ERROR_MESSAGE = 'The list of services could not be loaded. Try again.';

export function SellSessionDrawer({
  onClose,
  onSold,
}: {
  onClose: () => void;
  onSold: (summary: string) => void;
}) {
  const { apiFetch } = useAuth();
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const [prices, setPrices] = useState<PriceRow[] | null>(null);
  const [pricesFailed, setPricesFailed] = useState(false);
  const [serviceTypeId, setServiceTypeId] = useState('');
  const [client, setClient] = useState<ClientRow | null>(null);
  const [purchasedOn, setPurchasedOn] = useState(() => isoDateIn(new Date(), PRACTICE_TIME_ZONE));
  const [takingPayment, setTakingPayment] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>('transfer');
  const [reference, setReference] = useState('');
  const [discountKind, setDiscountKind] = useState<DiscountKind>('none');
  const [discountValue, setDiscountValue] = useState('');
  const [discountReason, setDiscountReason] = useState('');
  const [discountError, setDiscountError] = useState<string | undefined>();
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [clientError, setClientError] = useState<string | undefined>();
  const [serviceError, setServiceError] = useState<string | undefined>();
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

  useEffect(() => {
    let live = true;
    void apiFetch('/api/billing/prices')
      .then(async (res) => {
        if (!live) return;
        if (!res.ok) {
          setPricesFailed(true);
          return;
        }
        setPrices(PricesResponse.parse(await res.json()).prices);
      })
      .catch(() => {
        if (live) setPricesFailed(true);
      });
    return () => {
      live = false;
    };
  }, [apiFetch]);

  const price = prices?.find((row) => row.serviceTypeId === serviceTypeId) ?? null;
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
  // Always exactly one credit: this is the package drawer's shape for a
  // package of one, not a quantity a person chooses.
  const credits = 1;
  const contents = price ? `1 × ${price.serviceTypeName}` : '—';
  // Null before a service is chosen, and null for a price with no term at all.
  // Either way the sentence below is simply absent.
  const term = price ? termWords(price.term) : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!client) {
      setClientError('Choose which family is buying it.');
      return;
    }
    setClientError(undefined);
    if (!price) {
      setServiceError(CHOOSE_SERVICE_MESSAGE);
      setFormError(CHOOSE_SERVICE_MESSAGE);
      return;
    }
    setServiceError(undefined);
    if (discountKind !== 'none' && applied === null) {
      setDiscountError(
        discountKind === 'percent'
          ? 'Enter a percentage between 0 and 100, such as 5.'
          : DISCOUNT_TOO_LARGE_MESSAGE,
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
    const extra = discountBody(discountKind, discountValue);

    setBusy(true);
    try {
      const payload = {
        serviceTypeId,
        clientId: client.id,
        purchasedOn,
        ...(extra ? { extraDiscount: { discount: extra, reason: trimmedReason } } : {}),
        ...(takingPayment
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
      const res = await apiFetch('/api/billing/session-purchases', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': keyFor(JSON.stringify(payload)),
        },
        body: JSON.stringify(payload),
      });
      if (res.status === 201) {
        const body = SellSessionResponse.parse(await res.json());
        onSold(
          `${body.serviceTypeName} sold to ${client.givenName} ${client.familyName} for AED ` +
            `${formatFils(body.grossFils)}, invoice ${body.invoiceReference}.`,
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
        setFormError(NOT_PRICED_MESSAGE);
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
      aria-labelledby="sell-session-drawer-title"
    >
      <header className="drawer__header">
        <div className="drawer__title">
          <h2 id="sell-session-drawer-title">Sell a session</h2>
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
          {pricesFailed ? (
            <Note tone="critical">{PRICES_ERROR_MESSAGE}</Note>
          ) : (
            <Select
              id="sell-session-service"
              label="Service"
              value={serviceTypeId}
              onChange={(e) => {
                setServiceTypeId(e.target.value);
                setServiceError(undefined);
                setFormError(null);
              }}
              disabled={prices === null}
              error={serviceError}
            >
              <option value="">{prices === null ? 'Loading services…' : 'Choose a service'}</option>
              {prices?.map((row) => (
                <option key={row.serviceTypeId} value={row.serviceTypeId}>
                  {row.serviceTypeName}
                </option>
              ))}
            </Select>
          )}

          <ClientPicker
            id="sell-session-client"
            label="Client"
            selected={client}
            onSelect={(picked) => {
              setClient(picked);
              setClientError(undefined);
            }}
            error={clientError}
          />

          <Field
            id="sell-session-purchased-on"
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
              The price on the list. To sell at a different figure, add a price for this service
              first.
            </p>
          </div>

          <DiscountFields
            id="sell-session-discount"
            label="Extra discount for this sale"
            kind={discountKind}
            value={discountValue}
            error={discountError}
            onChange={(next) => {
              setDiscountKind(next.kind);
              setDiscountValue(next.value);
              setDiscountError(undefined);
              setFormError(null);
            }}
          />
          {discountKind === 'none' ? null : (
            <Field
              id="sell-session-discount-reason"
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

          <label className="checkbox" htmlFor="sell-session-taking-payment">
            <input
              id="sell-session-taking-payment"
              type="checkbox"
              checked={takingPayment}
              onChange={(e) => setTakingPayment(e.target.checked)}
            />
            <span>Money has changed hands</span>
          </label>

          {takingPayment ? (
            <>
              <Select
                id="sell-session-method"
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
                id="sell-session-reference"
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
