import { useEffect, useRef, useState, type FormEvent } from 'react';
import { isoDateIn } from '@domain/shared/actor';
import {
  CreatePriceResponse,
  ServiceTypeOptionsResponse,
  VatRateResponse,
  type PriceRow,
  type ServiceTypeOption,
  isRealText,
  MINIMUM_REASON,
} from '../../api/billing/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note, Select } from '../../shell/components/Controls';
import { CloseIcon } from '../../shell/components/Icons';
import { DiscountFields } from './DiscountFields';
import { focusFirstInvalid } from './refusal';
import { draftFrom, readTerm, TermFields, type TermDraft, type TermRefusal } from './TermFields';
import { useDrawer } from './useDrawer';
import {
  AED_MAX_FILS,
  discountBody,
  formatFils,
  isAedAmountTooLarge,
  parseAedToFils,
  previewDiscount,
  previewVat,
  type DiscountKind,
} from './money';

/**
 * The practice runs in one time zone; today's date on this form is that
 * day's, the same one `app/api/billing/prices.ts` judges "today" against,
 * not the browser's local date.
 */
const PRACTICE_TIME_ZONE = 'Asia/Dubai';

type ServiceTypesState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; options: readonly ServiceTypeOption[] };

/**
 * The rate in force on the chosen effective-from date (GET
 * /api/billing/vat-rate), fetched fresh every time that date changes — never
 * read off an existing price row, which may have been stamped under an
 * earlier rate (docs/SPEC/billing.md section 5.1).
 */
type VatRateState =
  | { kind: 'loading' }
  | { kind: 'ready'; rateBasisPoints: number }
  | { kind: 'none' }
  | { kind: 'error' };

type FieldErrors = {
  service?: string;
  price?: string;
  discount?: string;
  validFrom?: string;
  reason?: string;
  term?: TermRefusal;
};

/** Fixed sentences for every answer the server can give a save attempt, keyed
 * by a stable code — never the server's own reason text (security review,
 * this round: a domain string must not reach the screen unmediated). */
const FORBIDDEN_MESSAGE = "You don't have permission to add a price.";
const CONFLICT_MESSAGE =
  'A price for this service already starts on that date. Choose a different date.';
const NOT_FOUND_MESSAGE = 'This service is no longer part of the practice. Refresh and try again.';
const NO_VAT_SETTING_MESSAGE = "There isn't a VAT rate on record for that date yet.";
const DISCOUNT_TOO_LARGE_MESSAGE = 'The discount is larger than the list price.';
const GENERIC_MESSAGE = 'The price could not be saved. Try again.';

type BadRequestCode =
  'date_not_future' | 'date_not_after_current' | 'discount_too_large' | 'invalid_request';
const BAD_REQUEST_MESSAGES: Record<BadRequestCode, string> = {
  date_not_future: 'A new price cannot take effect before today. Choose today or a later date.',
  date_not_after_current:
    'A new price must take effect after the price it supersedes. Choose a later date.',
  discount_too_large: DISCOUNT_TOO_LARGE_MESSAGE,
  invalid_request: 'Check the price, date and reason, then try again.',
};

/** Maps a 400's `code` to its fixed sentence; an unknown or missing code is
 * still "invalid_request" — never the server's own reason text. */
function badRequestMessage(code: string | undefined): string {
  return code === 'date_not_future' ||
    code === 'date_not_after_current' ||
    code === 'discount_too_large' ||
    code === 'invalid_request'
    ? BAD_REQUEST_MESSAGES[code]
    : BAD_REQUEST_MESSAGES.invalid_request;
}

/**
 * "Add a price" (docs/DESIGN-BRIEF.md section 6.2: a right-side drawer, not
 * a modal, in the shape ClientDrawer.tsx set).
 *
 * **The term is prefilled from the price this one will supersede**, and sent
 * only when somebody touches it (the controller's ruling of 12 September
 * 2026). A price amendment is a new row, so a drawer that sent a blank term
 * with every change of figure would wipe a term the practice set on purpose;
 * a body with no `term` at all tells the server to carry the superseded row's
 * forward, which is the safe default living where it cannot be forgotten.
 * Taking a term away is then what it should be: clearing both boxes.
 *
 * `currentPrices` is the list the page already has open behind the drawer —
 * the prices in force today — so the prefill costs no second request.
 */
export function PriceDrawer({
  onClose,
  onCreated,
  currentPrices,
}: {
  onClose: () => void;
  onCreated: (price: PriceRow) => void;
  currentPrices: readonly PriceRow[];
}) {
  const { apiFetch } = useAuth();
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const [serviceTypes, setServiceTypes] = useState<ServiceTypesState>({ kind: 'loading' });
  const [serviceTypeId, setServiceTypeId] = useState('');
  const [price, setPrice] = useState('');
  const [discountKind, setDiscountKind] = useState<DiscountKind>('none');
  const [discountValue, setDiscountValue] = useState('');
  const [validFrom, setValidFrom] = useState(() => isoDateIn(new Date(), PRACTICE_TIME_ZONE));
  // The term as typed, and null while nobody has typed anything: untouched is
  // what tells the server to leave the superseded row's term alone, so it is
  // a state of its own rather than a blank draft that looks the same.
  const [typedTerm, setTypedTerm] = useState<TermDraft | null>(null);
  const [reason, setReason] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [vatRate, setVatRate] = useState<VatRateState>({ kind: 'loading' });

  useDrawer(drawerRef, closeRef, onClose);

  useEffect(() => {
    let live = true;
    void apiFetch('/api/billing/service-types')
      .then(async (res) => {
        if (!live) return;
        if (!res.ok) {
          setServiceTypes({ kind: 'error' });
          return;
        }
        const body = ServiceTypeOptionsResponse.parse(await res.json());
        setServiceTypes({ kind: 'ready', options: body.serviceTypes });
      })
      .catch(() => {
        if (live) setServiceTypes({ kind: 'error' });
      });
    return () => {
      live = false;
    };
  }, [apiFetch]);

  // Refetched on every change to the chosen effective-from date: the
  // compliance review's finding this round was that a stale or "today's"
  // rate can silently misprice a future date once the practice schedules a
  // change (tests/billing/db/prices.test.ts proves the server resolves the
  // same way at save time). No synchronous setState at the top
  // (react-hooks/set-state-in-effect, the same constraint BillingPage.tsx's
  // own load effect notes): the previous rate stays on screen, exactly as
  // ClientsPage.tsx's filtered list does mid-query, until the new answer
  // replaces it.
  useEffect(() => {
    if (!validFrom) return;
    let live = true;
    void apiFetch(`/api/billing/vat-rate?date=${encodeURIComponent(validFrom)}`)
      .then(async (res) => {
        if (!live) return;
        if (res.status === 404) {
          setVatRate({ kind: 'none' });
          return;
        }
        if (!res.ok) {
          setVatRate({ kind: 'error' });
          return;
        }
        const body = VatRateResponse.parse(await res.json());
        setVatRate({ kind: 'ready', rateBasisPoints: body.rateBasisPoints });
      })
      .catch(() => {
        if (live) setVatRate({ kind: 'error' });
      });
    return () => {
      live = false;
    };
  }, [apiFetch, validFrom]);

  /**
   * The term the superseded row carries, as the two boxes show it — the
   * screen saying what the server will do if nobody touches it. Derived
   * rather than written back by an effect, the same arrangement
   * `PackageDrawer`'s price-now field uses: a synchronous `setState` in an
   * effect is refused by `react-hooks/set-state-in-effect`, and the prefill
   * is only ever displayed.
   */
  const supersedes = currentPrices.find((row) => row.serviceTypeId === serviceTypeId) ?? null;
  const termDraft = typedTerm ?? draftFrom(supersedes?.term ?? null);

  const vatRateBasisPoints = vatRate.kind === 'ready' ? vatRate.rateBasisPoints : null;
  const parsedFils = parseAedToFils(price);
  // The same arithmetic the server writes the row with: the list figure, what
  // comes off it, and what a family pays.
  const applied =
    parsedFils === null ? null : previewDiscount(parsedFils, discountKind, discountValue);
  const preview =
    applied !== null && vatRateBasisPoints !== null
      ? previewVat(applied.netFils, vatRateBasisPoints)
      : null;

  function clearFieldError(key: keyof FieldErrors) {
    setFieldErrors((prev) => (prev[key] === undefined ? prev : { ...prev, [key]: undefined }));
    setFormError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const errors: FieldErrors = {};
    if (!serviceTypeId) {
      errors.service = 'Choose which service this price is for.';
    }
    if (parsedFils === null) {
      errors.price = isAedAmountTooLarge(price)
        ? `Enter a price of AED ${formatFils(AED_MAX_FILS)} or less.`
        : 'Enter a price in AED, such as 120.00.';
    }
    if (parsedFils !== null && applied === null) {
      errors.discount =
        discountKind === 'percent'
          ? 'Enter a percentage between 0 and 100, such as 15.'
          : DISCOUNT_TOO_LARGE_MESSAGE;
    }
    if (!validFrom) {
      errors.validFrom = 'Choose the date this price takes effect.';
    }
    const trimmedReason = reason.trim();
    if (!isRealText(trimmedReason)) {
      // The server refuses a reason that says nothing (app/api/billing/schema.ts);
      // saying so here means the person is told which field, not handed a
      // generic failure after the round trip.
      errors.reason = `Say why in at least ${MINIMUM_REASON} characters.`;
    } else if (trimmedReason.length > 200) {
      errors.reason = 'Keep the reason to 200 characters or fewer.';
    }
    // Half a term never reaches the server: migration 412's constraint would
    // refuse it, but a coordinator should not meet that as a 400.
    const reading = readTerm(termDraft);
    if (!reading.ok) {
      errors.term = { message: reading.message, focus: reading.focus };
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0 || parsedFils === null || !reading.ok) {
      focusFirstInvalid(
        [
          errors.service ? 'price-service' : null,
          errors.price ? 'price-amount' : null,
          errors.discount ? 'price-discount-value' : null,
          errors.validFrom ? 'price-valid-from' : null,
          errors.reason ? 'price-reason' : null,
          errors.term ? `price-term-${errors.term.focus}` : null,
        ].filter((id): id is string => id !== null),
      );
      return;
    }

    setBusy(true);
    try {
      const res = await apiFetch('/api/billing/prices', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          serviceTypeId,
          listPriceFils: parsedFils,
          discount: discountBody(discountKind, discountValue),
          validFrom,
          amendmentReason: trimmedReason,
          // Absent while nobody has touched the term, which is how the server
          // is told to carry the superseded row's forward; `null` only when
          // somebody has cleared both boxes on purpose.
          ...(typedTerm === null ? {} : { term: reading.term }),
        }),
      });
      if (res.status === 201) {
        const body = CreatePriceResponse.parse(await res.json());
        onCreated(body.price);
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
      if (res.status === 409) {
        setFormError(CONFLICT_MESSAGE);
        return;
      }
      if (res.status === 422) {
        setFormError(NO_VAT_SETTING_MESSAGE);
        return;
      }
      if (res.status === 400) {
        // A code, never the body's own reason text (fix 7, this round).
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        setFormError(badRequestMessage(body?.code));
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
      aria-labelledby="price-drawer-title"
    >
      <header className="drawer__header">
        <div className="drawer__title">
          <h2 id="price-drawer-title">Add price</h2>
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
          {serviceTypes.kind === 'error' ? (
            <Note tone="critical">The list of services could not be loaded. Try again.</Note>
          ) : (
            <Select
              id="price-service"
              label="Service"
              value={serviceTypeId}
              onChange={(e) => {
                setServiceTypeId(e.target.value);
                // The term belongs to the service's own price, so choosing a
                // different service goes back to that price's term rather
                // than carrying the last one across.
                setTypedTerm(null);
                clearFieldError('service');
                clearFieldError('term');
              }}
              disabled={serviceTypes.kind === 'loading'}
              error={fieldErrors.service}
            >
              <option value="">
                {serviceTypes.kind === 'loading' ? 'Loading services…' : 'Choose a service'}
              </option>
              {serviceTypes.kind === 'ready'
                ? serviceTypes.options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))
                : null}
            </Select>
          )}

          <Field
            id="price-amount"
            label="List price (AED, excluding VAT)"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={price}
            onChange={(e) => {
              setPrice(e.target.value);
              clearFieldError('price');
            }}
            error={fieldErrors.price}
          />

          <DiscountFields
            id="price-discount"
            label="Discount"
            kind={discountKind}
            value={discountValue}
            error={fieldErrors.discount}
            onChange={(next) => {
              setDiscountKind(next.kind);
              setDiscountValue(next.value);
              clearFieldError('discount');
            }}
          />

          <Field
            id="price-valid-from"
            label="Effective from"
            type="date"
            value={validFrom}
            onChange={(e) => {
              setValidFrom(e.target.value);
              clearFieldError('validFrom');
            }}
            error={fieldErrors.validFrom}
          />

          <Field
            id="price-reason"
            label="Why this price changes"
            type="text"
            maxLength={200}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              clearFieldError('reason');
            }}
            error={fieldErrors.reason}
          />

          <TermFields
            id="price-term"
            draft={termDraft}
            error={fieldErrors.term}
            onChange={(next) => {
              setTypedTerm(next);
              clearFieldError('term');
            }}
          />

          <div className="price-preview">
            <div className="price-preview__row">
              <span className="small muted">List price</span>
              <span className="numeric">{parsedFils !== null ? formatFils(parsedFils) : '—'}</span>
            </div>
            {applied && applied.discountFils > 0 ? (
              <div className="price-preview__row">
                <span className="small muted">Discount</span>
                <span className="numeric">{formatFils(applied.discountFils)}</span>
              </div>
            ) : null}
            <div className="price-preview__row">
              <span className="small muted">Price</span>
              <span className="numeric">{applied ? formatFils(applied.netFils) : '—'}</span>
            </div>
            <div className="price-preview__row">
              <span className="small muted">
                {vatRateBasisPoints !== null ? `VAT (${vatRateBasisPoints / 100}%)` : 'VAT'}
              </span>
              <span className="numeric">{preview ? formatFils(preview.vatFils) : '—'}</span>
            </div>
            <div className="price-preview__row price-preview__row--total">
              <span>Total</span>
              <span className="numeric">{preview ? formatFils(preview.grossFils) : '—'}</span>
            </div>
            {vatRate.kind === 'none' ? (
              <p className="small muted">{NO_VAT_SETTING_MESSAGE}</p>
            ) : null}
            {vatRate.kind === 'error' ? (
              <p className="small muted">The VAT rate could not be checked just now.</p>
            ) : null}
          </div>

          {formError ? <Note tone="critical">{formError}</Note> : null}

          <div className="drawer__actions">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save price'}
            </Button>
          </div>
        </form>
      </div>
    </aside>
  );
}
