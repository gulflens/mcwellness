import { useEffect, useRef, useState, type FormEvent } from 'react';
// Direct submodule import, not the '@domain/shared' barrel: the barrel also
// re-exports domain/shared/identity.ts, which imports node:crypto at module
// scope and crashes a browser bundle the moment anything reaches it (see
// money.ts's previewVat for the same reasoning on the VAT side).
import { isoDateIn } from '@domain/shared/actor';
import {
  CreatePriceResponse,
  ServiceTypeOptionsResponse,
  type PriceRow,
  type ServiceTypeOption,
} from '../../api/billing/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note, Select } from '../../shell/components/Controls';
import { CloseIcon } from '../../shell/components/Icons';
import { formatFils, parseAedToFils, previewVat } from './money';

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

type FieldErrors = {
  service?: string;
  price?: string;
  validFrom?: string;
  reason?: string;
};

/**
 * "Add a price" (docs/DESIGN-BRIEF.md section 6.2: a right-side drawer, not
 * a modal, in the shape ClientDrawer.tsx set). `currentPrices` supplies the
 * VAT rate for the live total below: the rate the price list already shows,
 * not a separate preview call — there is no such route
 * (app/api/billing/schema.ts only defines the list and create shapes).
 */
export function PriceDrawer({
  currentPrices,
  onClose,
  onCreated,
}: {
  currentPrices: readonly PriceRow[];
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

  // The rate the price list already shows (every service is standard-rated
  // at the one tenant-wide setting, docs/SPEC/billing.md section 5.1), not a
  // fresh lookup — so a practice with no prices yet has none to show.
  const vatRateBasisPoints = currentPrices[0]?.vatRateBasisPoints ?? null;
  const parsedFils = parseAedToFils(price);
  const preview =
    parsedFils !== null && vatRateBasisPoints !== null
      ? previewVat(parsedFils, vatRateBasisPoints)
      : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const errors: FieldErrors = {};
    if (!serviceTypeId) {
      errors.service = 'Choose which service this price is for.';
    }
    if (parsedFils === null) {
      errors.price = 'Enter a price in AED, such as 120.00.';
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
        setFormError("You don't have permission to add a price.");
        return;
      }
      if (res.status === 409) {
        setFormError(
          'A price for this service already starts on that date. Choose a different date.',
        );
        return;
      }
      if (res.status === 400) {
        const body = (await res.json().catch(() => null)) as { reason?: string } | null;
        setFormError(body?.reason ?? 'Check the price, date and reason, then try again.');
        return;
      }
      setFormError('The price could not be saved. Try again.');
    } catch {
      setFormError('The price could not be saved. Try again.');
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
              onChange={(e) => setServiceTypeId(e.target.value)}
              disabled={serviceTypes.kind === 'loading'}
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
          {fieldErrors.service ? <p className="field-error">{fieldErrors.service}</p> : null}

          <Field
            id="price-amount"
            label="Price (AED, excluding VAT)"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
          {fieldErrors.price ? <p className="field-error">{fieldErrors.price}</p> : null}

          <Field
            id="price-valid-from"
            label="Effective from"
            type="date"
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
          />
          {fieldErrors.validFrom ? <p className="field-error">{fieldErrors.validFrom}</p> : null}

          <Field
            id="price-reason"
            label="Why this price changes"
            type="text"
            maxLength={200}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {fieldErrors.reason ? <p className="field-error">{fieldErrors.reason}</p> : null}

          <div className="price-preview">
            <div className="price-preview__row">
              <span className="small muted">Net</span>
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
            {vatRateBasisPoints === null ? (
              <p className="small muted">
                VAT will be added at the practice's standard rate when this price is saved.
              </p>
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
