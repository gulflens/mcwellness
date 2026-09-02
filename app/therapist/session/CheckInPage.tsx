import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { CheckInRequest, CheckInResponseReason } from '../../api/sessions/schema';
import { CheckInResponse } from '../../api/sessions/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note, Select } from '../../shell/components/Controls';
import './CheckInPage.css';
import { ServiceTypeOptionsResponse, type ServiceTypeOption } from './schema';

/**
 * The practitioner's check-in screen (docs/SPEC/session-capture.md section
 * 3.1): a record number, the caller's own certified service, a delivery
 * mode and an optional location, then one button. Dark ground, single
 * column, the primary action in the thumb zone (.claude/rules/ui.md).
 *
 * Two gaps against `app/api/sessions/**`, both outside this pull request's
 * paths — see the pull request body's "Builder notes":
 * 1. `GET /api/sessions/service-types` is not mounted yet; the services
 *    list below will show its "could not be loaded" note until it is.
 * 2. `POST /api/sessions/:id/events`'s `CheckInRequest.clientId` is typed
 *    `z.uuid()` today. This screen sends the record number the
 *    practitioner enters, exactly as this pull request's brief specifies
 *    ("clientId by record number or id"); until the schema (and the
 *    route's lookup) accept a record number too, a real check-in will
 *    come back as the generic "Something went wrong" failure below.
 */

type DeliveryMode = 'home' | 'studio' | 'remote';

type Point = { lat: number; lng: number };

type ServicesState =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; services: ServiceTypeOption[] };

type Outcome =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'checked-in'; checkedInAt: string }
  | { kind: 'blocked'; reasons: CheckInResponseReason[] }
  | { kind: 'forbidden' }
  | { kind: 'conflict' }
  | { kind: 'failed' };

const RECORD_NUMBER_PATTERN = /^MW-\d{6}$/;
const RECORD_NUMBER_HINT =
  'Enter the record number as MW- followed by six digits, for example MW-000123.';

const REASON_COPY: Record<CheckInResponseReason, string> = {
  not_authorised: 'Certification for this service is not valid today.',
  consent_missing_participation: 'Consent to be seen is missing.',
  consent_missing_minor_participation: "A guardian's consent is missing.",
  consent_missing_home_visit: 'Home-visit consent is missing.',
  date_of_birth_unknown: 'Date of birth is not recorded.',
  already_checked_in: 'Already checked in on another device.',
};

const FORBIDDEN_MESSAGE =
  'You do not have access to check in a visit. Ask the practice to check your account.';
const CONFLICT_MESSAGE = 'That check-in could not be completed. Try again.';
const FAILED_MESSAGE = 'Something went wrong. Try again.';
const PRACTICE_TIME_ZONE = 'Asia/Dubai';

function normalizeRecordNumber(value: string): string {
  return value.trim().toUpperCase();
}

function validateRecordNumber(value: string): string | null {
  return RECORD_NUMBER_PATTERN.test(value) ? null : RECORD_NUMBER_HINT;
}

function formatCheckedInTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: PRACTICE_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

export function CheckInPage() {
  const { apiFetch } = useAuth();
  const navigate = useNavigate();

  const [sessionId] = useState(() => crypto.randomUUID());
  const [eventId] = useState(() => crypto.randomUUID());

  const [servicesState, setServicesState] = useState<ServicesState>({ kind: 'loading' });
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [recordNumber, setRecordNumber] = useState('');
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>('home');
  const [shareLocation, setShareLocation] = useState(false);
  const [point, setPoint] = useState<Point | null>(null);
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });

  useEffect(() => {
    // The initial state is already 'loading' (useState above); this effect
    // only ever fires once in practice (apiFetch's identity is stable), so
    // nothing needs setting synchronously here — only from the fetch's own
    // callbacks, which is what react-hooks/set-state-in-effect asks for.
    let live = true;
    void apiFetch('/api/sessions/service-types')
      .then(async (res) => {
        if (!live) return;
        if (!res.ok) {
          setServicesState({ kind: 'error' });
          return;
        }
        const parsed = ServiceTypeOptionsResponse.safeParse(await res.json());
        if (!parsed.success) {
          setServicesState({ kind: 'error' });
          return;
        }
        setServicesState({ kind: 'ready', services: parsed.data.serviceTypes });
      })
      .catch(() => {
        if (live) setServicesState({ kind: 'error' });
      });
    return () => {
      live = false;
    };
  }, [apiFetch]);

  // Derived, not stored: the practitioner's own pick once made, otherwise
  // the first (usually only) certified service — computed at render rather
  // than defaulted via an effect and a second render.
  const services = servicesState.kind === 'ready' ? servicesState.services : [];
  const effectiveServiceId = selectedServiceId || (services[0]?.id ?? '');

  const handleShareLocationChange = useCallback(async (next: boolean) => {
    setShareLocation(next);
    if (!next) {
      setPoint(null);
      setLocationNote(null);
      return;
    }
    const geolocation = typeof navigator === 'undefined' ? undefined : navigator.geolocation;
    if (!geolocation) {
      setPoint(null);
      setLocationNote('This device cannot share its location.');
      return;
    }
    await new Promise<void>((resolve) => {
      geolocation.getCurrentPosition(
        (position) => {
          setPoint({ lat: position.coords.latitude, lng: position.coords.longitude });
          setLocationNote(null);
          resolve();
        },
        () => {
          setPoint(null);
          setLocationNote('Location was not shared. Check-in will continue without it.');
          resolve();
        },
      );
    });
  }, []);

  const submit = useCallback(async () => {
    const normalizedRecordNumber = normalizeRecordNumber(recordNumber);
    const formatError = validateRecordNumber(normalizedRecordNumber);
    if (formatError) {
      setValidationError(formatError);
      return;
    }
    if (!effectiveServiceId) {
      setValidationError('Choose a service before checking in.');
      return;
    }
    const serviceTypeId = effectiveServiceId;
    setValidationError(null);
    setOutcome({ kind: 'submitting' });

    const body: CheckInRequest = {
      // See this file's header comment and the pull request body: the
      // record number, not yet the uuid app/api/sessions/schema.ts expects.
      clientId: normalizedRecordNumber,
      point,
      events: [
        {
          id: eventId,
          seq: 1,
          kind: 'session_started',
          deviceAt: new Date().toISOString(),
          payload: { serviceTypeId, deliveryMode, locationId: null },
        },
      ],
    };

    try {
      const res = await apiFetch(`/api/sessions/${sessionId}/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 403) {
        setOutcome({ kind: 'forbidden' });
        return;
      }
      if (res.status === 409) {
        setOutcome({ kind: 'conflict' });
        return;
      }
      if (res.status === 422) {
        const parsed = CheckInResponse.safeParse(await res.json());
        if (parsed.success && parsed.data.status === 'blocked') {
          setOutcome({ kind: 'blocked', reasons: [...parsed.data.reasons] });
          return;
        }
        setOutcome({ kind: 'failed' });
        return;
      }
      if (!res.ok) {
        setOutcome({ kind: 'failed' });
        return;
      }
      const parsed = CheckInResponse.safeParse(await res.json());
      if (parsed.success && parsed.data.status === 'checked_in') {
        setOutcome({ kind: 'checked-in', checkedInAt: parsed.data.checkedInAt });
        return;
      }
      setOutcome({ kind: 'failed' });
    } catch {
      setOutcome({ kind: 'failed' });
    }
  }, [apiFetch, deliveryMode, effectiveServiceId, eventId, point, recordNumber, sessionId]);

  if (outcome.kind === 'checked-in') {
    return (
      <div className="ground" data-ground="dark">
        <main className="plain plain--instrument">
          <div className="checkin__confirmation">
            <h1>Checked in</h1>
            <Note>
              Checked in at{' '}
              <span className="numeric">{formatCheckedInTime(outcome.checkedInAt)}</span>.
            </Note>
            <Button
              variant="primary"
              className="checkin__primary"
              onClick={() => navigate('/today')}
            >
              Back to Today
            </Button>
          </div>
        </main>
      </div>
    );
  }

  const submitting = outcome.kind === 'submitting';
  const canSubmit = services.length > 0 && !submitting;

  return (
    <div className="ground" data-ground="dark">
      <main className="plain plain--instrument">
        <div className="checkin">
          <Button variant="quiet" className="checkin__back" onClick={() => navigate('/today')}>
            Back to Today
          </Button>
          <h1>Check in</h1>
          <div className="checkin__form">
            <Field
              id="checkin-record-number"
              label="Record number"
              placeholder="MW-000123"
              autoComplete="off"
              value={recordNumber}
              onChange={(e) => setRecordNumber(e.target.value)}
            />

            {servicesState.kind === 'loading' ? <Note>Loading your services.</Note> : null}
            {servicesState.kind === 'error' ? (
              <Note tone="critical">The service list could not be loaded. Try again.</Note>
            ) : null}
            {servicesState.kind === 'ready' && services.length === 0 ? (
              <Note tone="critical">
                No certified service is on file for you. Ask the practice to add one before you
                check in a visit.
              </Note>
            ) : null}
            {services.length > 0 ? (
              <Select
                id="checkin-service"
                label="Service"
                value={effectiveServiceId}
                onChange={(e) => setSelectedServiceId(e.target.value)}
              >
                {services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                  </option>
                ))}
              </Select>
            ) : null}

            <Select
              id="checkin-delivery-mode"
              label="Delivery"
              value={deliveryMode}
              onChange={(e) => setDeliveryMode(e.target.value as DeliveryMode)}
            >
              <option value="home">Home visit</option>
              <option value="studio">Studio</option>
              <option value="remote">Remote</option>
            </Select>

            <label className="checkin__switch-row">
              <span className="checkin__switch-copy">
                <span>Share my location</span>
                <span className="small muted">Records where you checked in, at the door.</span>
              </span>
              <span className={shareLocation ? 'switch switch--on' : 'switch'}>
                <input
                  id="checkin-share-location"
                  type="checkbox"
                  className="switch__input"
                  aria-label="Share my location"
                  checked={shareLocation}
                  onChange={(e) => void handleShareLocationChange(e.target.checked)}
                />
                <span className="switch__track" aria-hidden="true" />
                <span className="switch__thumb" aria-hidden="true" />
              </span>
            </label>
            {locationNote ? <Note>{locationNote}</Note> : null}

            {validationError ? <Note tone="critical">{validationError}</Note> : null}
            {outcome.kind === 'blocked' ? (
              <div className="checkin__reasons">
                {outcome.reasons.map((reason) => (
                  <Note key={reason} tone="critical">
                    {REASON_COPY[reason]}
                  </Note>
                ))}
              </div>
            ) : null}
            {outcome.kind === 'forbidden' ? <Note tone="critical">{FORBIDDEN_MESSAGE}</Note> : null}
            {outcome.kind === 'conflict' ? <Note tone="critical">{CONFLICT_MESSAGE}</Note> : null}
            {outcome.kind === 'failed' ? <Note tone="critical">{FAILED_MESSAGE}</Note> : null}

            <Button
              variant="primary"
              className="checkin__primary"
              disabled={!canSubmit}
              onClick={() => void submit()}
            >
              {submitting ? 'Checking in…' : outcome.kind === 'idle' ? 'Check in' : 'Try again'}
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
