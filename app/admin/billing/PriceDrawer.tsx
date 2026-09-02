import { useEffect, useRef, useState, type FormEvent } from 'react';
import { isoDateIn } from '@domain/shared/actor';
import {
  CreatePriceResponse,
  ServiceTypeOptionsResponse,
  VatRateResponse,
  type PriceRow,
  type ServiceTypeOption,
} from '../../api/billing/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note, Select } from '../../shell/components/Controls';
import { CloseIcon } from '../../shell/components/Icons';
import { AED_MAX_FILS, formatFils, isAedAmountTooLarge, parseAedToFils, previewVat } from './money';

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
  validFrom?: string;
  reason?: string;
};

/** Fixed sentences for every answer the server can give a save attempt, keyed
 * by a stable code — never the server's own reason text (security review,
 * this round: a domain string must not reach the screen unmediated). */
const FORBIDDEN_MESSAGE = "You don't have permission to add a price.";
const CONFLICT_MESSAGE =
  'A price for this service already starts on that date. Choose a different date.';
const NOT_FOUND_MESSAGE = 'This service is no longer part of the practice. Refresh and try again.';
const NO_VAT_SETTING_MESSAGE = "There isn't a VAT rate on record for that date yet.";
const GENERIC_MESSAGE = 'The price could not be saved. Try again.';

type BadRequestCode = 'date_not_future' | 'date_not_after_current' | 'invalid_request';
const BAD_REQUEST_MESSAGES: Record<BadRequestCode, string> = {
  date_not_future: 'A new price cannot take effect before today. Choose today or a later date.',
  date_not_after_current:
    'A new price must take effect after the price it supersedes. Choose a later date.',
  invalid_request: 'Check the price, date and reason, then try again.',
};

/** Maps a 400's `code` to its fixed sentence; an unknown or missing code is
 * still "invalid_request" — never the server's own reason text. */
function badRequestMessage(code: string | undefined): string {
  return code === 'date_not_future' ||
    code === 'date_not_after_current' ||
    code === 'invalid_request'
    ? BAD_REQUEST_MESSAGES[code]
    : BAD_REQUEST_MESSAGES.invalid_request;
}

/**
 * "Add a price" (docs/DESIGN-BRIEF.md section 6.2: a right-side drawer, not
 * a modal, in the shape ClientDrawer.tsx set).
 */
export function PriceDrawer({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (price: PriceRow) => void;
}) {
  const { apiFetch } = useAuth();
  const closeRef = useRef<HTMLButtonElement>(null);

  const [serviceTypes, setServiceTypes] = useState<ServiceTypesState>({ kind: 'loading' });
  const [serviceTypeId, setServiceTypeId] = useState('');
  const [price, setPrice] = useState('');
  const [validFrom, setValidFrom] = useState(() => isoDateIn(new Date(), PRACTICE_TIME_ZONE));
  const [reason, setReason] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [vatRate, setVatRate] = useState<VatRateState>({ kind: 'loading' });

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

  const vatRateBasisPoints = vatRate.kind === 'ready' ? vatRate.rateBasisPoints : null;
  const parsedFils = parseAedToFils(price);
  const preview =
    parsedFils !== null && vatRateBasisPoints !== null
      ? previewVat(parsedFils, vatRateBasisPoints)
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
    if (!validFrom) {
      errors.validFrom = 'Choose the date this price takes effect.';
    }
    const trimmedReason = reason.trim();
    if (trimmedReason.length < 1) {
      errors.reason = 'Say why this price is changing.';
    } else if (trimmedReason.length > 200) {
      errors.reason = 'Keep the reason to 200 characters or fewer.';
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0 || parsedFils === null) {
      return;
    }

    setBusy(true);
    try {
      const res = await apiFetch('/api/billing/prices', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          serviceTypeId,
          unitPriceFils: parsedFils,
          validFrom,
          amendmentReason: trimmedReason,
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
    <aside className="drawer" role="dialog" aria-labelledby="price-drawer-title">
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
                clearFieldError('service');
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
            label="Price (AED, excluding VAT)"
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

          <div className="price-preview">
            <div className="price-preview__row">
              <span className="small muted">Unit price</span>
              <span className="numeric">{parsedFils !== null ? formatFils(parsedFils) : '—'}</span>
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
