import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { CheckInRequest, CheckInResponseReason } from '../../api/sessions/schema';
import { CheckInResponse } from '../../api/sessions/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note, Select } from '../../shell/components/Controls';
import './CheckInPage.css';
import { ServiceTypeOptionsResponse, SessionErrorBody, type ServiceTypeOption } from './schema';

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
  | { kind: 'not-booked' }
  | { kind: 'conflict' }
  | { kind: 'failed' };

// The inputs that decide whether a retry is genuinely a retry (same visit,
// same tap) or a corrected attempt at checking in someone else (item 1,
// docs/CHANGE-REQUESTS): the session and event ids are only ever reused
// when all three match the previous attempt exactly.
type AttemptKey = { recordNumber: string; serviceTypeId: string; deliveryMode: DeliveryMode };
type Attempt = { sessionId: string; eventId: string; key: AttemptKey };

function sameAttemptKey(a: AttemptKey, b: AttemptKey): boolean {
  return (
    a.recordNumber === b.recordNumber &&
    a.serviceTypeId === b.serviceTypeId &&
    a.deliveryMode === b.deliveryMode
  );
}

const RECORD_NUMBER_PATTERN = /^MW-\d{6}$/;
const RECORD_NUMBER_HINT =
  'Enter the record number as MW- followed by six digits, for example MW-000123.';

const LOCATION_PURPOSE =
  'Proof you were at the door when you checked in, never tracking, and seen only by the practice.';

// Passed to getCurrentPosition itself (item 2): no cached fix, and give up
// rather than let the practitioner wait indefinitely on a bad signal.
const LOCATION_TIMEOUT_MS = 10000;
// A guard the browser's own API does not promise: a device that calls
// neither callback at all (some in-app WebViews do this) would otherwise
// leave the switch waiting forever. Resolved here instead, a little after
// getCurrentPosition's own timeout, with the point left null.
const LOCATION_DEADMAN_MS = LOCATION_TIMEOUT_MS + 2000;
const LOCATION_NOTE_UNSUPPORTED = 'This device cannot share its location.';
const LOCATION_NOTE_NOT_SHARED = 'Location was not shared. Check-in will continue without it.';

const REASON_COPY: Record<CheckInResponseReason, string> = {
  not_authorised:
    'You are not set up to deliver this service today. Ask the practice to check why.',
  consent_missing_participation: 'Consent to be seen is missing. Ask the practice to add it.',
  consent_missing_minor_participation:
    "A guardian's consent is missing. Ask the practice to add it.",
  consent_missing_home_visit: 'Home-visit consent is missing. Ask the practice to add it.',
  date_of_birth_unknown: 'Date of birth is not recorded. Ask the practice to add it.',
  already_checked_in: 'Already checked in on another device. Ask the practice if that was not you.',
};

const FORBIDDEN_MESSAGE =
  'You do not have access to check in a visit. Ask the practice to check your account.';
const NOT_BOOKED_MESSAGE =
  'This visit is not booked for you today. Check the record number, or ask the practice.';
const CONFLICT_MESSAGE = 'That check-in could not be completed. Try again.';
const FAILED_MESSAGE = 'Something went wrong. Check your connection, then try again.';
const PRACTICE_TIME_ZONE = 'Asia/Dubai';

// Outcomes a plain retry cannot clear: nothing changes about the request
// that could make a second identical attempt succeed, so the primary
// action keeps naming the action rather than implying a retry will help
// (item 9 — "does not turn the primary into 'Try again'").
function isUnretriable(outcome: Outcome): boolean {
  return outcome.kind === 'blocked' || outcome.kind === 'forbidden';
}

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

// A single read of the device's position, options fixed at the door (item
// 2): never a cached fix, and resolved to null — rather than left pending —
// whenever the device refuses, times out, or (the dead-man guard) never
// calls either callback at all.
function readPosition(): Promise<Point | null> {
  const geolocation = typeof navigator === 'undefined' ? undefined : navigator.geolocation;
  if (!geolocation) return Promise.resolve(null);
  return new Promise<Point | null>((resolve) => {
    let settled = false;
    const finish = (value: Point | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadman);
      resolve(value);
    };
    const deadman = setTimeout(() => finish(null), LOCATION_DEADMAN_MS);
    geolocation.getCurrentPosition(
      (position) => finish({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => finish(null),
      { timeout: LOCATION_TIMEOUT_MS, maximumAge: 0 },
    );
  });
}

export function CheckInPage() {
  const { apiFetch } = useAuth();
  const navigate = useNavigate();

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [attempt, setAttempt] = useState<Attempt | null>(null);

  const [servicesState, setServicesState] = useState<ServicesState>({ kind: 'loading' });
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [recordNumber, setRecordNumber] = useState('');
  const [recordNumberError, setRecordNumberError] = useState<string | null>(null);
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>('home');
  const [shareLocation, setShareLocation] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);
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
      setLocationNote(null);
      return;
    }
    const geolocation = typeof navigator === 'undefined' ? undefined : navigator.geolocation;
    if (!geolocation) {
      setLocationNote(LOCATION_NOTE_UNSUPPORTED);
      return;
    }
    // This first read is only ever used for immediate feedback (permission
    // refused, device unsupported): the point actually sent is read again,
    // fresh, at the moment of submission, below.
    const nextPoint = await readPosition();
    if (!mountedRef.current) return;
    setLocationNote(nextPoint ? null : LOCATION_NOTE_NOT_SHARED);
  }, []);

  const submit = useCallback(async () => {
    const normalizedRecordNumber = normalizeRecordNumber(recordNumber);
    const formatError = validateRecordNumber(normalizedRecordNumber);
    if (formatError) {
      setRecordNumberError(formatError);
      return;
    }
    if (!effectiveServiceId) {
      // The primary action is disabled whenever there is no service to
      // pick (see canSubmit below), so this guards a state the UI never
      // actually reaches.
      return;
    }
    const serviceTypeId = effectiveServiceId;
    setRecordNumberError(null);
    setOutcome({ kind: 'submitting' });

    // Read the position again, now, rather than trusting whatever was
    // captured when the switch was first turned on: the point recorded is
    // where the practitioner is standing at the moment they tap (item 2).
    const submittedPoint = shareLocation ? await readPosition() : null;
    if (mountedRef.current) {
      setLocationNote(shareLocation && !submittedPoint ? LOCATION_NOTE_NOT_SHARED : null);
    }

    const key: AttemptKey = { recordNumber: normalizedRecordNumber, serviceTypeId, deliveryMode };
    const ids: Attempt =
      attempt && sameAttemptKey(attempt.key, key)
        ? attempt
        : { sessionId: crypto.randomUUID(), eventId: crypto.randomUUID(), key };
    setAttempt(ids);

    const body: CheckInRequest = {
      // See this file's header comment and the pull request body: the
      // record number, not yet the uuid app/api/sessions/schema.ts expects.
      clientId: normalizedRecordNumber,
      point: submittedPoint,
      events: [
        {
          id: ids.eventId,
          seq: 1,
          kind: 'session_started',
          deviceAt: new Date().toISOString(),
          payload: { serviceTypeId, deliveryMode, locationId: null },
        },
      ],
    };

    try {
      const res = await apiFetch(`/api/sessions/${ids.sessionId}/events`, {
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
      if (res.status === 400) {
        const parsedError = SessionErrorBody.safeParse(await res.json().catch(() => null));
        if (parsedError.success && parsedError.data.detail === 'client_not_found') {
          setOutcome({ kind: 'not-booked' });
          return;
        }
        setOutcome({ kind: 'failed' });
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
  }, [apiFetch, attempt, deliveryMode, effectiveServiceId, recordNumber, shareLocation]);

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
  const primaryLabel = submitting
    ? 'Checking in…'
    : outcome.kind === 'idle' || isUnretriable(outcome)
      ? 'Check in'
      : 'Try again';

  return (
    <div className="ground" data-ground="dark">
      <main className="plain plain--instrument">
        <div className="checkin">
          <Button variant="quiet" className="checkin__back" onClick={() => navigate('/today')}>
            Back to Today
          </Button>
          <h1>Check in</h1>
          <div className="checkin__form">
            <div className="field">
              <label htmlFor="checkin-record-number" className="field__label">
                Record number
              </label>
              <input
                id="checkin-record-number"
                className="field__input numeric"
                placeholder="MW-000123"
                autoComplete="off"
                value={recordNumber}
                onChange={(e) => {
                  setRecordNumber(e.target.value);
                  if (recordNumberError) setRecordNumberError(null);
                }}
                aria-invalid={recordNumberError ? true : undefined}
                aria-describedby="checkin-record-number-hint"
              />
              <div
                id="checkin-record-number-hint"
                className={
                  recordNumberError ? 'field__hint small note--critical' : 'field__hint small muted'
                }
                role={recordNumberError ? 'alert' : undefined}
              >
                {recordNumberError ?? RECORD_NUMBER_HINT}
              </div>
            </div>

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
                <span className="small muted">{LOCATION_PURPOSE}</span>
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
            {outcome.kind === 'not-booked' ? (
              <Note tone="critical">{NOT_BOOKED_MESSAGE}</Note>
            ) : null}
            {outcome.kind === 'conflict' ? <Note tone="critical">{CONFLICT_MESSAGE}</Note> : null}
            {outcome.kind === 'failed' ? <Note tone="critical">{FAILED_MESSAGE}</Note> : null}

            <div className="checkin__dock">
              <Button
                variant="primary"
                className="checkin__primary"
                disabled={!canSubmit}
                onClick={() => void submit()}
              >
                {primaryLabel}
              </Button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
