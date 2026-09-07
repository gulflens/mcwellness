import { useRef, useState, type FormEvent } from 'react';
import {
  EMIRATES,
  PracticeResponse,
  VAT_TRN_DIGITS,
  WHATSAPP_MESSAGE,
  type Emirate,
  type Practice,
} from '../../api/practice/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note, Select } from '../../shell/components/Controls';
import { CloseIcon } from '../../shell/components/Icons';
import { useDrawer } from '../../shell/components/useDrawer';
import { EMIRATE_LABELS } from './emirates';

/**
 * Editing what the practice says it is (migration 905): the legal name in
 * both languages, the trade licence, the registered address, the tax
 * registration and the VAT switch.
 *
 * The whole form saves at once, because the VAT switch and the number printed
 * beside it are one fact and must never be recorded by halves. Every refusal
 * the server can give has a fixed sentence here, keyed by a status and a
 * code, never the server's own words.
 */

const FORBIDDEN_MESSAGE = "You don't have permission to change the practice's details.";
const REASON_MESSAGE = 'Say why this is changing before saving.';
const COORDINATES_MESSAGE =
  'The first address recorded needs its map coordinates, so a practitioner can be sent to it.';
const GENERIC_MESSAGE = 'The practice details could not be saved. Try again.';
const CHECK_MESSAGE = 'Check the details above, then try again.';
const VAT_TRN_REQUIRED_MESSAGE =
  'A VAT registration needs the number that will be printed on invoices.';
const VAT_TRN_LENGTH_MESSAGE = `A VAT registration number is ${VAT_TRN_DIGITS} digits.`;
const ADDRESS_FOR_COORDINATES_MESSAGE =
  'Give the address these coordinates belong to, or clear them.';

type FieldErrors = {
  legalName?: string;
  taxRegistrationNumber?: string;
  vatTrn?: string;
  whatsappNumber?: string;
  displayAddress?: string;
  latitude?: string;
  longitude?: string;
  reason?: string;
};

const FIELD_IDS: Record<keyof FieldErrors, string> = {
  legalName: 'practice-legal-name',
  taxRegistrationNumber: 'practice-tax-registration',
  vatTrn: 'practice-vat-trn',
  whatsappNumber: 'practice-whatsapp-number',
  displayAddress: 'practice-address',
  latitude: 'practice-latitude',
  longitude: 'practice-longitude',
  reason: 'practice-reason',
};

/** Moves focus to the first field that is wrong, so a refusal is heard as well as seen. */
function focusFirstInvalid(errors: FieldErrors): void {
  for (const key of Object.keys(FIELD_IDS) as (keyof FieldErrors)[]) {
    if (errors[key] !== undefined) {
      document.getElementById(FIELD_IDS[key])?.focus();
      return;
    }
  }
}

/** A typed coordinate, or null when the box is empty; `false` when it is not a number. */
function coordinate(value: string, limit: number): number | null | false {
  const typed = value.trim();
  if (typed.length === 0) {
    return null;
  }
  if (!/^-?\d{1,3}(\.\d+)?$/.test(typed)) {
    return false;
  }
  const asNumber = Number(typed);
  return Math.abs(asNumber) <= limit ? asNumber : false;
}

export function PracticeDrawer({
  practice,
  onClose,
  onSaved,
}: {
  practice: Practice;
  onClose: () => void;
  onSaved: (saved: Practice) => void;
}) {
  const { apiFetch } = useAuth();
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useDrawer(drawerRef, closeRef, onClose);

  const [legalName, setLegalName] = useState(practice.legalName);
  // The console is English only (operator's decision of 7 September 2026,
  // docs/DESIGN-BRIEF.md section 10 item 4), so there is no field for the
  // Arabic legal name — but the practice's PATCH sends the whole form at once
  // (docs/SPEC/00-data-model.md, round 20) and `legalNameAr` is required in
  // the body: `optional(200)` in app/api/practice/schema.ts is
  // `z.string().nullable()`, not `.optional()`, and the update writes
  // `legal_name_ar = $2` every time (app/api/practice/routes.ts). Omitting it
  // would be a 400 and sending '' would blank it, so the value the drawer
  // loaded travels back unchanged and production's invoices keep their Arabic
  // legal name.
  const legalNameAr = practice.legalNameAr;
  const [licenceNumber, setLicenceNumber] = useState(practice.licenceNumber ?? '');
  const [licensingAuthority, setLicensingAuthority] = useState(practice.licensingAuthority ?? '');
  const [licenceExpiresOn, setLicenceExpiresOn] = useState(practice.licenceExpiresOn ?? '');
  const [taxRegistrationNumber, setTaxRegistrationNumber] = useState(
    practice.taxRegistrationNumber ?? '',
  );
  const [vatRegistered, setVatRegistered] = useState(practice.vatRegistered);
  const [vatTrn, setVatTrn] = useState(practice.vatTrn ?? '');
  const [whatsappNumber, setWhatsappNumber] = useState(practice.whatsappNumber ?? '');
  const [displayAddress, setDisplayAddress] = useState(practice.address?.displayAddress ?? '');
  const [emirate, setEmirate] = useState<Emirate>(
    practice.address?.emirate ?? practice.defaultEmirate,
  );
  const [latitude, setLatitude] = useState(
    practice.address?.latitude === null || practice.address?.latitude === undefined
      ? ''
      : String(practice.address.latitude),
  );
  const [longitude, setLongitude] = useState(
    practice.address?.longitude === null || practice.address?.longitude === undefined
      ? ''
      : String(practice.address.longitude),
  );
  const [reason, setReason] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const hasAddressOnRecord = practice.address !== null;

  function clearFieldError(key: keyof FieldErrors) {
    setFieldErrors((prev) => (prev[key] === undefined ? prev : { ...prev, [key]: undefined }));
    setFormError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);

    const errors: FieldErrors = {};
    if (legalName.trim().length === 0) {
      errors.legalName = 'The practice needs the legal name its invoices are issued under.';
    }
    const typedTax = taxRegistrationNumber.replace(/\s/g, '');
    if (typedTax.length > 0 && !/^[A-Za-z0-9-]{5,30}$/.test(typedTax)) {
      errors.taxRegistrationNumber =
        'A corporate tax registration number is letters, digits and hyphens.';
    }
    const typedVatTrn = vatTrn.replace(/\s/g, '');
    if (vatRegistered && !new RegExp(`^\\d{${VAT_TRN_DIGITS}}$`).test(typedVatTrn)) {
      errors.vatTrn = typedVatTrn.length === 0 ? VAT_TRN_REQUIRED_MESSAGE : VAT_TRN_LENGTH_MESSAGE;
    }
    const typedWhatsapp = whatsappNumber.replace(/[\s()-]/g, '');
    if (typedWhatsapp.length > 0 && !/^\+[1-9][0-9]{6,14}$/.test(typedWhatsapp)) {
      errors.whatsappNumber = WHATSAPP_MESSAGE;
    }
    const typedAddress = displayAddress.trim();
    if (hasAddressOnRecord && typedAddress.length === 0) {
      errors.displayAddress = 'Give the address as it should appear on an invoice.';
    }
    const lat = coordinate(latitude, 90);
    const lng = coordinate(longitude, 180);
    if (lat === false) {
      errors.latitude = 'A latitude is a number between -90 and 90.';
    }
    if (lng === false) {
      errors.longitude = 'A longitude is a number between -180 and 180.';
    }
    if (lat !== false && lng !== false && (lat === null) !== (lng === null)) {
      const missing = lat === null ? 'latitude' : 'longitude';
      errors[missing] = 'A coordinate needs both a latitude and a longitude.';
    }
    if (typedAddress.length > 0 && !hasAddressOnRecord && (lat === null || lat === false)) {
      errors.latitude = COORDINATES_MESSAGE;
    }
    // The other way round: coordinates typed with no address and none on
    // record used to be dropped on the floor, because there was no address row
    // to hang them on and the form sent none. Refuse instead of discarding.
    if (typedAddress.length === 0 && !hasAddressOnRecord && (lat !== null || lng !== null)) {
      errors.displayAddress = ADDRESS_FOR_COORDINATES_MESSAGE;
    }
    if (reason.trim().length === 0) {
      errors.reason = REASON_MESSAGE;
    }

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      focusFirstInvalid(errors);
      return;
    }

    const address =
      typedAddress.length === 0 && !hasAddressOnRecord
        ? null
        : {
            displayAddress: typedAddress,
            emirate,
            latitude: lat === false ? null : lat,
            longitude: lng === false ? null : lng,
          };

    setBusy(true);
    try {
      const res = await apiFetch('/api/practice', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-reason': reason.trim() },
        body: JSON.stringify({
          legalName: legalName.trim(),
          legalNameAr,
          taxRegistrationNumber,
          licenceNumber,
          licensingAuthority,
          licenceExpiresOn: licenceExpiresOn.trim().length === 0 ? null : licenceExpiresOn,
          vatRegistered,
          vatTrn: vatRegistered ? typedVatTrn : '',
          whatsappNumber: typedWhatsapp,
          address,
        }),
      });
      if (res.ok) {
        onSaved(PracticeResponse.parse(await res.json()).practice);
        return;
      }
      if (res.status === 403) {
        setFormError(FORBIDDEN_MESSAGE);
        return;
      }
      if (res.status === 400) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
          code?: string;
        } | null;
        if (body?.error === 'reason_required') {
          setFormError(REASON_MESSAGE);
          return;
        }
        if (body?.code === 'vat_trn_required') {
          setFieldErrors((prev) => ({ ...prev, vatTrn: VAT_TRN_REQUIRED_MESSAGE }));
          setFormError(VAT_TRN_REQUIRED_MESSAGE);
          return;
        }
        setFormError(body?.code === 'coordinates_required' ? COORDINATES_MESSAGE : CHECK_MESSAGE);
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
      aria-labelledby="practice-drawer-title"
    >
      <header className="drawer__header">
        <div className="drawer__title">
          <h2 id="practice-drawer-title">Practice details</h2>
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
          <p className="small muted">
            The legal name and a reason are required. Everything else is optional, and a
            registration number is asked for only if the VAT switch is on.
          </p>

          <Field
            id={FIELD_IDS.legalName}
            label="Legal name"
            hint="As it appears on the trade licence and on every invoice."
            type="text"
            maxLength={200}
            value={legalName}
            onChange={(e) => {
              setLegalName(e.target.value);
              clearFieldError('legalName');
            }}
            error={fieldErrors.legalName}
          />

          <Field
            id="practice-licence-number"
            label="Trade licence number (optional)"
            type="text"
            maxLength={60}
            value={licenceNumber}
            onChange={(e) => setLicenceNumber(e.target.value)}
          />

          <Field
            id="practice-licensing-authority"
            label="Licensing authority (optional)"
            hint="The department or free zone that issued the licence."
            type="text"
            maxLength={120}
            value={licensingAuthority}
            onChange={(e) => setLicensingAuthority(e.target.value)}
          />

          <Field
            id={FIELD_IDS.whatsappNumber}
            label="WhatsApp number (optional)"
            hint="What the client portal's ask-for-a-visit button opens. Leave it empty and the portal says to contact the practice, without a button."
            type="tel"
            inputMode="tel"
            maxLength={40}
            value={whatsappNumber}
            onChange={(e) => {
              setWhatsappNumber(e.target.value);
              clearFieldError('whatsappNumber');
            }}
            error={fieldErrors.whatsappNumber}
          />

          <Field
            id="practice-licence-expires"
            label="Licence expires (optional)"
            type="date"
            value={licenceExpiresOn}
            onChange={(e) => setLicenceExpiresOn(e.target.value)}
          />

          <Field
            id={FIELD_IDS.displayAddress}
            label={hasAddressOnRecord ? 'Registered address' : 'Registered address (optional)'}
            hint="Printed on invoices as the supplier's address."
            type="text"
            maxLength={300}
            value={displayAddress}
            onChange={(e) => {
              setDisplayAddress(e.target.value);
              clearFieldError('displayAddress');
            }}
            error={fieldErrors.displayAddress}
          />

          <Select
            id="practice-emirate"
            label="Emirate"
            value={emirate}
            onChange={(e) => setEmirate(e.target.value as Emirate)}
          >
            {EMIRATES.map((code) => (
              <option key={code} value={code}>
                {EMIRATE_LABELS[code]}
              </option>
            ))}
          </Select>

          <div className="coordinate-pair">
            <Field
              id={FIELD_IDS.latitude}
              label="Latitude (optional)"
              type="text"
              inputMode="decimal"
              value={latitude}
              onChange={(e) => {
                setLatitude(e.target.value);
                clearFieldError('latitude');
              }}
              error={fieldErrors.latitude}
            />
            <Field
              id={FIELD_IDS.longitude}
              label="Longitude (optional)"
              type="text"
              inputMode="decimal"
              value={longitude}
              onChange={(e) => {
                setLongitude(e.target.value);
                clearFieldError('longitude');
              }}
              error={fieldErrors.longitude}
            />
          </div>

          <Field
            id={FIELD_IDS.taxRegistrationNumber}
            label="Corporate tax registration number (optional)"
            hint="The corporate tax registration the practice holds. Not the VAT number."
            type="text"
            maxLength={40}
            value={taxRegistrationNumber}
            onChange={(e) => {
              setTaxRegistrationNumber(e.target.value);
              clearFieldError('taxRegistrationNumber');
            }}
            error={fieldErrors.taxRegistrationNumber}
          />

          <label className="vat-switch-row">
            <span className="vat-switch-copy">
              <span>Registered for VAT</span>
              <span className="small muted" id="practice-vat-consequence">
                This records the registration and the number it was issued under. While it is off,
                invoices carry no VAT and show one figure; turning it on adds VAT at the
                practice&rsquo;s standard rate to every new sale. Turning it off removes the number
                from the record.
              </span>
            </span>
            <span className={vatRegistered ? 'vat-switch vat-switch--on' : 'vat-switch'}>
              <input
                id="practice-vat-registered"
                type="checkbox"
                className="vat-switch__input"
                aria-label="Registered for VAT"
                aria-describedby="practice-vat-consequence"
                checked={vatRegistered}
                onChange={(e) => {
                  setVatRegistered(e.target.checked);
                  clearFieldError('vatTrn');
                }}
              />
              <span className="vat-switch__track" aria-hidden="true" />
              <span className="vat-switch__thumb" aria-hidden="true" />
            </span>
          </label>

          {vatRegistered ? (
            <Field
              id={FIELD_IDS.vatTrn}
              label="VAT registration number"
              hint={`${VAT_TRN_DIGITS} digits, as issued by the Federal Tax Authority. Required while the switch above is on.`}
              type="text"
              inputMode="numeric"
              maxLength={40}
              value={vatTrn}
              onChange={(e) => {
                setVatTrn(e.target.value);
                clearFieldError('vatTrn');
              }}
              error={fieldErrors.vatTrn}
            />
          ) : null}

          <Field
            id={FIELD_IDS.reason}
            label="Why this changes"
            hint="Recorded against the change, and read later by whoever asks what happened."
            type="text"
            maxLength={200}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              clearFieldError('reason');
            }}
            error={fieldErrors.reason}
          />

          {formError ? <Note tone="critical">{formError}</Note> : null}

          <div className="drawer__actions">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save details'}
            </Button>
          </div>
        </form>
      </div>
    </aside>
  );
}
