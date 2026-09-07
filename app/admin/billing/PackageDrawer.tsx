import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { isoDateIn } from '@domain/shared/actor';
import { PackageResponse, type PackageRow } from '../../api/billing/ledger-schema';
import {
  isRealText,
  MINIMUM_REASON,
  PricesResponse,
  type PriceRow,
} from '../../api/billing/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note } from '../../shell/components/Controls';
import { CloseIcon } from '../../shell/components/Icons';
import { DiscountFields } from './DiscountFields';
import { focusFirstInvalid } from './refusal';
import { useDrawer } from './useDrawer';
import {
  AED_MAX_FILS,
  discountBody,
  formatFils,
  isAedAmountTooLarge,
  parseAedToFils,
  previewDiscount,
  type DiscountKind,
} from './money';

/**
 * "Add package" — the drawer that puts a programme on the price list
 * (docs/DESIGN-BRIEF.md section 6.2: a right-side drawer, not a modal).
 *
 * The form asks for how many of each service the bundle contains, and it
 * offers only services that already have a price, because a credit with no
 * standalone value cannot be given its share of the package price
 * (domain/billing/allocation.ts). It then totals those services at today's
 * prices and offers that figure as the list price — a starting point the
 * founder may overwrite, never a figure the app decides.
 *
 * What it sells for is said either way round: a discount off the list, or the
 * price now. Typing one works out the other, and the request carries the
 * discount (docs/SPEC/billing.md section 2.4 — the operator's decision of
 * 7 September 2026, which amends the founder's decision of 2026-09-03 that no
 * discount percentage is kept anywhere; a percentage is kept now, when that is
 * how the figure was set). The list price is the ceiling: a price now above it
 * is refused here rather than at the server.
 *
 * Because the request carries the discount, the price now follows the list
 * figure whenever that moves afterwards — the founder retypes it, or the
 * contents change and the offered total with them — and a price now that no
 * longer agrees with the discount is refused here rather than written as a
 * figure nobody saw.
 */

const PRACTICE_TIME_ZONE = 'Asia/Dubai';

const FORBIDDEN_MESSAGE = "You don't have permission to add a package.";
const CODE_TAKEN_MESSAGE = 'A package already uses that code. Choose another.';
const GENERIC_MESSAGE = 'The package could not be saved. Try again.';
const DISCOUNT_TOO_LARGE_MESSAGE = 'The discount is larger than the list price.';
const ABOVE_LIST_MESSAGE =
  'The price now is above the list price. Raise the list price or lower the price now.';
const DISAGREE_MESSAGE = 'The price now and the discount no longer agree. Retype one of them.';
const BAD_REQUEST_MESSAGES: Record<string, string> = {
  duplicate_component: 'Each service may appear once. Change the quantity instead.',
  discount_too_large: DISCOUNT_TOO_LARGE_MESSAGE,
  date_not_future: 'A price cannot take effect before today. Choose today or a later date.',
  date_not_after_current:
    'A price must take effect after the one it replaces. Choose a later date.',
  invalid_request: 'Check the name, code, quantities, price and reason, then try again.',
};

type PricesState =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; prices: readonly PriceRow[] };

type FieldErrors = {
  name?: string;
  code?: string;
  contents?: string;
  price?: string;
  reason?: string;
};

/** Lower case, digits and hyphens: the shape the database's own check allows. */
function codeFrom(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function PackageDrawer({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (created: PackageRow) => void;
}) {
  const { apiFetch } = useAuth();
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const [prices, setPrices] = useState<PricesState>({ kind: 'loading' });
  const [name, setName] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);
  const [code, setCode] = useState('');
  const [expiryMonths, setExpiryMonths] = useState('12');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [listPrice, setListPrice] = useState('');
  const [listPriceTouched, setListPriceTouched] = useState(false);
  // The price now as it was last set — by a discount, or by the founder
  // typing it — beside the list figure it was set against. When the list
  // moves afterwards the stored text is stale, and a discount is what
  // determines the price now, so the field is derived from the discount
  // rather than left showing a figure the server will not write.
  const [salePrice, setSalePrice] = useState<{ text: string; listFils: number | null }>({
    text: '',
    listFils: null,
  });
  const [discountKind, setDiscountKind] = useState<DiscountKind>('none');
  const [discountValue, setDiscountValue] = useState('');
  const [validFrom, setValidFrom] = useState(() => isoDateIn(new Date(), PRACTICE_TIME_ZONE));
  const [reason, setReason] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useDrawer(drawerRef, closeRef, onClose);

  useEffect(() => {
    let live = true;
    void apiFetch('/api/billing/prices')
      .then(async (res) => {
        if (!live) return;
        if (!res.ok) {
          setPrices({ kind: 'error' });
          return;
        }
        setPrices({ kind: 'ready', prices: PricesResponse.parse(await res.json()).prices });
      })
      .catch(() => {
        if (live) setPrices({ kind: 'error' });
      });
    return () => {
      live = false;
    };
  }, [apiFetch]);

  const chosen = useMemo(() => {
    if (prices.kind !== 'ready') return [];
    return prices.prices
      .map((price) => ({ price, quantity: Number(quantities[price.serviceTypeId] ?? '0') }))
      .filter((entry) => Number.isSafeInteger(entry.quantity) && entry.quantity > 0);
  }, [prices, quantities]);

  // What the contents come to bought one at a time, at today's prices. Offered
  // as the list price until the founder types one of her own.
  const contentsTotalFils = chosen.reduce(
    (total, entry) => total + entry.quantity * entry.price.unitPriceFils,
    0,
  );
  const effectiveListPrice = listPriceTouched ? listPrice : formatFils(contentsTotalFils);
  const effectiveCode = codeTouched ? code : codeFrom(name);
  const listFils = parseAedToFils(effectiveListPrice);
  const applied = listFils === null ? null : previewDiscount(listFils, discountKind, discountValue);

  /**
   * What the price now field shows: the figure that was typed, unless the
   * list price has moved under it while a discount is chosen — the founder
   * retypes the list, or the offered total changes because the contents did.
   * Then the discount is the authority, because the discount is what the
   * request carries, and the screen must say what the server will write.
   *
   * Derived rather than written back by an effect: a synchronous `setState`
   * in an effect is refused by `react-hooks/set-state-in-effect`, and the
   * stale text is only ever displayed, never a second source of truth.
   */
  const priceNow =
    discountKind !== 'none' && applied !== null && salePrice.listFils !== listFils
      ? formatFils(applied.netFils)
      : salePrice.text;

  /**
   * The two halves of one figure, kept together. A discount sets the price
   * now; a price now sets the discount, as an amount, because that is what
   * the founder just named. Neither is derived at submit time — both are on
   * screen, and a person must be able to see the other move.
   */
  function chooseDiscount(next: { kind: DiscountKind; value: string }): void {
    setDiscountKind(next.kind);
    setDiscountValue(next.value);
    clearFieldError('price');
    if (listFils === null) return;
    const preview = previewDiscount(listFils, next.kind, next.value);
    if (preview) setSalePrice({ text: formatFils(preview.netFils), listFils });
  }

  function choosePriceNow(typed: string): void {
    setSalePrice({ text: typed, listFils });
    clearFieldError('price');
    const now = parseAedToFils(typed);
    if (listFils === null || now === null || now > listFils) return;
    setDiscountKind(now === listFils ? 'none' : 'amount');
    setDiscountValue(now === listFils ? '' : formatFils(listFils - now));
  }

  function clearFieldError(key: keyof FieldErrors) {
    setFieldErrors((prev) => (prev[key] === undefined ? prev : { ...prev, [key]: undefined }));
    setFormError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const errors: FieldErrors = {};
    if (name.trim().length < 1) errors.name = 'Give the package a name.';
    if (!/^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/.test(effectiveCode)) {
      errors.code = 'A code is lower case letters, digits and hyphens, at least two characters.';
    }
    if (chosen.length === 0) errors.contents = 'Say how many of at least one service it contains.';
    const saleFils = parseAedToFils(priceNow);
    if (listFils === null || saleFils === null) {
      errors.price =
        isAedAmountTooLarge(effectiveListPrice) || isAedAmountTooLarge(priceNow)
          ? `Enter a price of AED ${formatFils(AED_MAX_FILS)} or less.`
          : 'Enter both prices in AED, such as 10325.00.';
    } else if (saleFils > listFils) {
      errors.price = ABOVE_LIST_MESSAGE;
    } else if (applied === null) {
      errors.price =
        discountKind === 'percent'
          ? 'Enter a percentage between 0 and 100, such as 15.'
          : DISCOUNT_TOO_LARGE_MESSAGE;
    } else if (saleFils !== applied.netFils) {
      // The request carries the discount. If the two halves of the one figure
      // have come apart — a price now typed before the list price was — the
      // person retypes one of them rather than the server writing the other.
      errors.price = DISAGREE_MESSAGE;
    }
    const trimmedReason = reason.trim();
    if (!isRealText(trimmedReason)) {
      errors.reason = `Say why in at least ${MINIMUM_REASON} characters.`;
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0 || listFils === null || applied === null) {
      // In the order the fields sit on screen, so focus moves to the first
      // thing wrong rather than the first thing checked.
      focusFirstInvalid(
        [
          errors.name ? 'package-name' : null,
          errors.code ? 'package-code' : null,
          errors.contents ? 'quantity-first' : null,
          errors.price ? 'package-sale-price' : null,
          errors.reason ? 'package-reason' : null,
        ].filter((id): id is string => id !== null),
      );
      return;
    }

    setBusy(true);
    try {
      const res = await apiFetch('/api/billing/packages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // No nameAr: the console is English only (operator's decision of
        // 7 September 2026, docs/DESIGN-BRIEF.md section 10 item 4), and
        // CreatePackageInput's nameAr is nullable and optional
        // (app/api/billing/ledger-schema.ts), so the key is simply left out.
        // The column, and the Arabic names already on production's packages,
        // are untouched.
        body: JSON.stringify({
          code: effectiveCode,
          name: name.trim(),
          listPriceFils: listFils,
          expiryMonths: Number(expiryMonths),
          components: chosen.map((entry) => ({
            serviceTypeId: entry.price.serviceTypeId,
            quantity: entry.quantity,
          })),
          price: {
            discount: discountBody(discountKind, discountValue),
            validFrom,
            amendmentReason: trimmedReason,
          },
        }),
      });
      if (res.status === 201) {
        onCreated(PackageResponse.parse(await res.json()).package);
        return;
      }
      if (res.status === 403) {
        setFormError(FORBIDDEN_MESSAGE);
        return;
      }
      if (res.status === 409) {
        setFormError(CODE_TAKEN_MESSAGE);
        return;
      }
      if (res.status === 400 || res.status === 422) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        setFormError(
          BAD_REQUEST_MESSAGES[body?.code ?? ''] ??
            BAD_REQUEST_MESSAGES.invalid_request ??
            GENERIC_MESSAGE,
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
      aria-labelledby="package-drawer-title"
    >
      <header className="drawer__header">
        <div className="drawer__title">
          <h2 id="package-drawer-title">Add package</h2>
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
            id="package-name"
            label="Name"
            type="text"
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={fieldErrors.name}
          />
          <Field
            id="package-code"
            label="Code"
            type="text"
            maxLength={40}
            value={effectiveCode}
            onChange={(e) => {
              setCodeTouched(true);
              setCode(e.target.value);
            }}
            hint="Used in exports and never shown to a family."
            error={fieldErrors.code}
          />

          <fieldset className="contents">
            <legend className="field__label">What it contains</legend>
            {prices.kind === 'loading' ? (
              <p className="small muted">Loading the services.</p>
            ) : null}
            {prices.kind === 'error' ? (
              <Note tone="critical">The price list could not be loaded. Try again.</Note>
            ) : null}
            {prices.kind === 'ready' && prices.prices.length === 0 ? (
              <p className="small muted">
                Set a price for at least one service before building a package.
              </p>
            ) : null}
            {prices.kind === 'ready'
              ? prices.prices.map((price) => (
                  <div className="contents__row" key={price.serviceTypeId}>
                    <label className="contents__label" htmlFor={`quantity-${price.serviceTypeId}`}>
                      <span>{price.serviceTypeName}</span>
                      <span className="small muted numeric">
                        {formatFils(price.unitPriceFils)} each
                      </span>
                    </label>
                    <input
                      id={`quantity-${price.serviceTypeId}`}
                      className="field__input contents__quantity"
                      type="number"
                      min={0}
                      max={1000}
                      step={1}
                      value={quantities[price.serviceTypeId] ?? ''}
                      placeholder="0"
                      onChange={(e) =>
                        setQuantities((prev) => ({
                          ...prev,
                          [price.serviceTypeId]: e.target.value,
                        }))
                      }
                    />
                  </div>
                ))
              : null}
            {fieldErrors.contents ? (
              <div className="field__hint small field__hint--error">{fieldErrors.contents}</div>
            ) : null}
          </fieldset>

          <Field
            id="package-list-price"
            label="List price (AED, excluding VAT)"
            type="text"
            inputMode="decimal"
            value={effectiveListPrice}
            onChange={(e) => {
              setListPriceTouched(true);
              setListPrice(e.target.value);
            }}
            hint="What the contents come to bought one at a time. Offered from the price list; change it if the practice publishes a different figure."
          />
          <DiscountFields
            id="package-discount"
            label="Discount off the list price"
            kind={discountKind}
            value={discountValue}
            onChange={chooseDiscount}
          />
          <Field
            id="package-sale-price"
            label="Price now (AED, excluding VAT)"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={priceNow}
            onChange={(e) => choosePriceNow(e.target.value)}
            error={fieldErrors.price}
          />
          <Field
            id="package-valid-from"
            label="On sale from"
            type="date"
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
          />
          <Field
            id="package-reason"
            label="Why this is the price"
            type="text"
            maxLength={200}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            error={fieldErrors.reason}
          />
          <Field
            id="package-expiry"
            label="Runs for (months)"
            type="number"
            min={1}
            max={60}
            value={expiryMonths}
            onChange={(e) => setExpiryMonths(e.target.value)}
            hint="How long a family has to use it. Twelve months unless the practice decides otherwise."
          />

          {formError ? <Note tone="critical">{formError}</Note> : null}

          <div className="drawer__actions">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save package'}
            </Button>
          </div>
        </form>
      </div>
    </aside>
  );
}
