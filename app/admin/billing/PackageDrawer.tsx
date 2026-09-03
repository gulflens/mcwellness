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
import { focusFirstInvalid } from './refusal';
import { useDrawer } from './useDrawer';
import { AED_MAX_FILS, formatFils, isAedAmountTooLarge, parseAedToFils } from './money';

/**
 * "Add package" — the drawer that puts a programme on the price list
 * (docs/DESIGN-BRIEF.md section 6.2: a right-side drawer, not a modal).
 *
 * The form asks for how many of each service the bundle contains, and it
 * offers only services that already have a price, because a credit with no
 * standalone value cannot be given its share of the package price
 * (domain/billing/allocation.ts). It then totals those services at today's
 * prices and offers that figure as the list price — a starting point the
 * founder may overwrite, never a figure the app decides. The sale price is a
 * second field with its own reason, and the two are stored separately: no
 * discount percentage is kept anywhere.
 */

const PRACTICE_TIME_ZONE = 'Asia/Dubai';

const FORBIDDEN_MESSAGE = "You don't have permission to add a package.";
const CODE_TAKEN_MESSAGE = 'A package already uses that code. Choose another.';
const GENERIC_MESSAGE = 'The package could not be saved. Try again.';
const BAD_REQUEST_MESSAGES: Record<string, string> = {
  duplicate_component: 'Each service may appear once. Change the quantity instead.',
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
  const [nameAr, setNameAr] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);
  const [code, setCode] = useState('');
  const [expiryMonths, setExpiryMonths] = useState('12');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [listPrice, setListPrice] = useState('');
  const [listPriceTouched, setListPriceTouched] = useState(false);
  const [salePrice, setSalePrice] = useState('');
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

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const errors: FieldErrors = {};
    if (name.trim().length < 1) errors.name = 'Give the package a name.';
    if (!/^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/.test(effectiveCode)) {
      errors.code = 'A code is lower case letters, digits and hyphens, at least two characters.';
    }
    if (chosen.length === 0) errors.contents = 'Say how many of at least one service it contains.';
    const saleFils = parseAedToFils(salePrice);
    const listFils = parseAedToFils(effectiveListPrice);
    if (saleFils === null || listFils === null) {
      errors.price = isAedAmountTooLarge(salePrice)
        ? `Enter a price of AED ${formatFils(AED_MAX_FILS)} or less.`
        : 'Enter both prices in AED, such as 10325.00.';
    }
    const trimmedReason = reason.trim();
    if (!isRealText(trimmedReason)) {
      errors.reason = `Say why in at least ${MINIMUM_REASON} characters.`;
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0 || saleFils === null || listFils === null) {
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
        body: JSON.stringify({
          code: effectiveCode,
          name: name.trim(),
          nameAr: nameAr.trim() || null,
          listPriceFils: listFils,
          expiryMonths: Number(expiryMonths),
          components: chosen.map((entry) => ({
            serviceTypeId: entry.price.serviceTypeId,
            quantity: entry.quantity,
          })),
          price: { amountFils: saleFils, validFrom, amendmentReason: trimmedReason },
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
            id="package-name-ar"
            label="Name in Arabic"
            type="text"
            maxLength={120}
            lang="ar"
            dir="rtl"
            value={nameAr}
            onChange={(e) => setNameAr(e.target.value)}
            hint="Optional."
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
          <Field
            id="package-sale-price"
            label="Price now (AED, excluding VAT)"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={salePrice}
            onChange={(e) => setSalePrice(e.target.value)}
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
