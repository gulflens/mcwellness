import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { CheckInRequest, CheckInResponseReason } from '../../api/sessions/schema';
import { CheckInResponse, OpenSessionResponse } from '../../api/sessions/schema';
import { useAuth, type ApiFetch } from '../../shell/auth/AuthContext';
import { Button, Note, Select } from '../../shell/components/Controls';
import './CheckInPage.css';
import { SessionRunner, type RunnerVisit } from './SessionRunner';
import { useForgetDeviceOnSignOut } from './outbox/signed-out';
import { createOutboxStore, type OutboxStore } from './outbox/store';
import { ServiceTypeOptionsResponse, SessionErrorBody, type ServiceTypeOption } from './schema';

/**
 * The practitioner's way into a visit (docs/SPEC/session-capture.md sections
 * 2 and 3.1). Two doors, one screen:
 *
 * - **Check in.** A record number, the caller's own certified service, a
 *   delivery mode and an optional location, then one button. Dark ground,
 *   single column, the primary action in the thumb zone (.claude/rules/ui.md).
 * - **Resume.** A visit already open — because the phone died, the app was
 *   force-quit, or the practitioner simply reloaded — is offered by name and
 *   by the time it started, before anything else on the screen. Asked of the
 *   server when there is a connection, and of the device's own outbox when
 *   there is not, so a reload in a basement still finds the visit.
 *
 * Once a visit is running, this screen hands over to SessionRunner and shows
 * nothing else: no navigation chrome during a session (section 3.4).
 */

type DeliveryMode = 'home' | 'studio' | 'remote';

type Point = { lat: number; lng: number };

type ServicesState =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; services: ServiceTypeOption[] };

/** A visit already open, offered before anything else on the screen. */
type ResumeOffer =
  | { kind: 'looking' }
  | { kind: 'none' }
  | { kind: 'offered'; visit: RunnerVisit }
  | { kind: 'dismissed' };

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
  not_booked_today:
    'This visit is not booked for you today. Check the record number, or ask the practice.',
  // Its own sentence, and it names the instrument rather than the register:
  // the practitioner is standing at a door and needs to know what to say
  // (docs/SPEC/practitioner-phone.md section 6.3).
  kit_calibration_overdue: "The amplifier's calibration is overdue. Call the practice.",
};

const FORBIDDEN_MESSAGE =
  'You do not have access to check in a visit. Ask the practice to check your account.';
const NOT_BOOKED_MESSAGE =
  'This visit is not booked for you today. Check the record number, or ask the practice.';
// The route's own detail code for this 400 is being renamed to
// not_booked_today; client_not_found stays mapped to the same sentence for
// one release so a device on the old code, or a server not yet redeployed,
// never regresses to the generic failure. Drop client_not_found once that
// release has passed.
const NOT_BOOKED_DETAILS = new Set(['not_booked_today', 'client_not_found']);
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

// A plain fetch-and-parse, returning the next state rather than setting it
// itself: both the mount effect and the retry control in the services
// error note call this same function and apply its result, so a failed
// load is never a dead end (design re-check on pull request 24).
function fetchServicesState(apiFetch: ApiFetch): Promise<ServicesState> {
  return apiFetch('/api/sessions/service-types')
    .then(async (res) => {
      if (!res.ok) return { kind: 'error' } as const;
      const parsed = ServiceTypeOptionsResponse.safeParse(await res.json());
      if (!parsed.success) return { kind: 'error' } as const;
      return { kind: 'ready', services: parsed.data.serviceTypes } as const;
    })
    .catch(() => ({ kind: 'error' }) as const);
}

/**
 * Turns the server's answer about an open visit into what the runner needs.
 * The label is a given name and a family initial, which is all the wire ever
 * carried (app/api/sessions/schema.ts's OpenSession).
 */
function visitFromOpen(open: {
  id: string;
  clientGivenName: string;
  clientFamilyInitial: string | null;
  serviceTypeId: string;
  checkedInAt: string;
  number: number;
  of: number | null;
  lastSeq: number;
  photoConsent: boolean;
}): RunnerVisit {
  const initial = (open.clientFamilyInitial ?? '').trim();
  const name = open.clientGivenName.trim();
  return {
    sessionId: open.id,
    clientLabel: name.length === 0 ? 'This visit' : initial ? `${name} ${initial}.` : name,
    checkedInAt: open.checkedInAt,
    number: open.number,
    of: open.of,
    serviceTypeId: open.serviceTypeId,
    photoConsent: open.photoConsent ? 'given' : 'refused',
    lastSeq: open.lastSeq,
    // Conservative after a resume: the practitioner is told below that
    // sharing is off, rather than having a position taken they did not
    // switch on for this half of the visit.
    shareLocation: false,
  };
}

/**
 * Asks the server for the visit this practitioner left open, if any.
 *
 * Bounded, because the whole face waits on this answer: the screen shows
 * either the offer or the form, never one and then suddenly the other, and a
 * question nobody answers must not hold a practitioner at a door. Four
 * seconds, then the device's own note is asked instead — which is what
 * happens with no signal at all anyway, and answers in milliseconds.
 */
const OPEN_VISIT_TIMEOUT_MS = 4000;

async function fetchOpenVisit(apiFetch: ApiFetch): Promise<RunnerVisit | null> {
  try {
    const res = await apiFetch('/api/sessions/open', {
      signal: AbortSignal.timeout(OPEN_VISIT_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const parsed = OpenSessionResponse.safeParse(await res.json());
    if (!parsed.success || parsed.data.session === null) return null;
    return visitFromOpen(parsed.data.session);
  } catch {
    return null;
  }
}

export function CheckInPage() {
  const { apiFetch } = useAuth();
  const navigate = useNavigate();
  // This face reads the device's own open-visit note, which carries a given
  // name and a family initial, so it arms the sign-out wipe too
  // (./outbox/signed-out.ts).
  useForgetDeviceOnSignOut();
  // The day sheet knows which client this is and hands the record number over
  // in router state, so nobody types MW-000123 standing at a door
  // (app/therapist/today/TodayPage.tsx). Never a query string: a record
  // number is personal data, and .claude/rules/ui.md keeps personal data out
  // of paths and query strings. Read once at mount, normalised like a typed
  // value, and validated on submit exactly as one is; prefilling grants
  // nothing, the route still resolves it inside the caller's own practice.
  const location = useLocation();
  const handedOver = (location.state as { record?: unknown } | null)?.record;
  const prefilledRecordNumber =
    typeof handedOver === 'string' ? normalizeRecordNumber(handedOver) : '';

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [running, setRunning] = useState<RunnerVisit | null>(null);
  const [resume, setResume] = useState<ResumeOffer>({ kind: 'looking' });
  const storeRef = useRef<OutboxStore | null>(null);

  const [servicesState, setServicesState] = useState<ServicesState>({ kind: 'loading' });
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [recordNumber, setRecordNumber] = useState(prefilledRecordNumber);
  const [recordNumberError, setRecordNumberError] = useState<string | null>(null);
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>('home');
  const [shareLocation, setShareLocation] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });

  const loadServices = useCallback(() => fetchServicesState(apiFetch), [apiFetch]);

  useEffect(() => {
    // The initial state is already 'loading' (useState above); this effect
    // only ever fires once in practice (apiFetch's identity is stable), so
    // nothing needs setting synchronously here — only from loadServices'
    // own resolution, which is what react-hooks/set-state-in-effect asks
    // for. The retry control in the error note below runs the same
    // loadServices call — a failed load is not a dead end.
    let live = true;
    void loadServices().then((next) => {
      if (live) setServicesState(next);
    });
    return () => {
      live = false;
    };
  }, [loadServices]);

  // Is there a visit already open? The server knows, and when it cannot be
  // reached the device's own outbox note does — a reload with no signal must
  // still offer to resume rather than looking like a fresh day.
  useEffect(() => {
    let live = true;
    void (async () => {
      const fromServer = await fetchOpenVisit(apiFetch);
      if (!live) return;
      if (fromServer) {
        setResume({ kind: 'offered', visit: fromServer });
        return;
      }
      const store = await createOutboxStore();
      if (!live) return;
      storeRef.current = store;
      const note = await store.readOpenVisit();
      if (!live) return;
      setResume(
        note === null
          ? { kind: 'none' }
          : {
              kind: 'offered',
              visit: {
                sessionId: note.sessionId,
                clientLabel: note.clientLabel,
                checkedInAt: note.checkedInAt,
                number: note.number,
                of: note.of,
                serviceTypeId: note.serviceTypeId,
                // The device could not ask. Not "they refused": the screen
                // says it cannot check rather than putting words in a
                // family's mouth (design review, item 5).
                photoConsent: 'unknown',
                // The device's own high-water mark: an offline resume cannot
                // ask the server where it got to, so it picks up from what it
                // last wrote rather than from one.
                lastSeq: note.lastSeq,
                shareLocation: false,
              },
            },
      );
    })();
    return () => {
      live = false;
    };
  }, [apiFetch]);

  // Derived, not stored: the practitioner's own pick once made, otherwise
  // the first (usually only) certified service — computed at render rather
  // than defaulted via an effect and a second render.
  const services = servicesState.kind === 'ready' ? servicesState.services : [];
  const effectiveServiceId = selectedServiceId || (services[0]?.id ?? '');
  const selectedServiceNameAr =
    services.find((service) => service.id === effectiveServiceId)?.nameAr ?? null;

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
      // The record number as its own field (app/api/sessions/schema.ts's
      // ClientMrn, pull request 23) — never clientId, which is reserved for
      // a caller who already has the client's uuid to hand.
      clientMrn: normalizedRecordNumber,
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
        if (parsedError.success && NOT_BOOKED_DETAILS.has(parsedError.data.detail ?? '')) {
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
        // The check-in answer has no name in it — the request carried a
        // record number, not a person — so the visit is read back once,
        // which is also where "session N of M" comes from. A failure here is
        // not a failure of the check-in: the visit runs with a plain label.
        const opened = await fetchOpenVisit(apiFetch);
        if (!mountedRef.current) return;
        setRunning(opened === null ? null : { ...opened, shareLocation });
        if (opened !== null) return;
        setRunning({
          sessionId: ids.sessionId,
          clientLabel: 'This visit',
          checkedInAt: parsed.data.checkedInAt,
          number: 1,
          of: null,
          serviceTypeId,
          photoConsent: parsed.data.photoConsent ? 'given' : 'refused',
          lastSeq: 1,
          shareLocation,
        });
        return;
      }
      setOutcome({ kind: 'failed' });
    } catch {
      setOutcome({ kind: 'failed' });
    }
  }, [apiFetch, attempt, deliveryMode, effectiveServiceId, recordNumber, shareLocation]);

  if (running) {
    return (
      <SessionRunner
        visit={running}
        service={services.find((s) => s.id === running.serviceTypeId) ?? null}
        onFinished={() => navigate('/today')}
      />
    );
  }

  if (resume.kind === 'looking') {
    // The offer, when there is one, is the loudest thing on this face and
    // belongs above the form. So the form does not exist until the question
    // is answered: an offer that arrives afterwards would push the record
    // number, the service and the primary action down the screen while the
    // practitioner was already reaching for them (design review, item 11).
    // A moment, not a screen — bounded above, and answered from the device
    // in milliseconds when there is no signal to ask over.
    return (
      <div className="ground" data-ground="dark">
        <main className="plain plain--instrument">
          <div className="checkin__confirmation">
            <h1>Check in</h1>
            <Note>Checking whether you have a visit already open.</Note>
          </div>
        </main>
      </div>
    );
  }

  if (outcome.kind === 'checked-in') {
    // Checked in, and the visit is being read back so the runner can name
    // who is in the room. A moment, not a screen.
    return (
      <div className="ground" data-ground="dark">
        <main className="plain plain--instrument">
          <div className="checkin__confirmation">
            <h1>Checked in</h1>
            <Note>
              Checked in at{' '}
              <span className="numeric">{formatCheckedInTime(outcome.checkedInAt)}</span>.
            </Note>
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

          {/* The offer is the only primary on this face while it stands: the
              form's own Check in drops to secondary below, so the
              practitioner is never asked to choose between two equally loud
              actions. It cannot arrive late and shove the form down the
              screen, because the form is not painted until the question it
              answers is settled (above). */}
          {resume.kind === 'offered' ? (
            <section className="checkin__resume">
              <p className="checkin__resume-line">
                Resume session for {resume.visit.clientLabel}, started{' '}
                <span className="numeric">{formatCheckedInTime(resume.visit.checkedInAt)}</span>.
              </p>
              <p className="small muted">
                Sharing your location is off after a resume. The visit is recorded either way.
              </p>
              <Button
                variant="primary"
                className="checkin__primary"
                onClick={() => setRunning(resume.visit)}
              >
                Resume
              </Button>
              <Button
                variant="quiet"
                className="checkin__dismiss"
                onClick={() => setResume({ kind: 'dismissed' })}
              >
                Check in someone else instead
              </Button>
            </section>
          ) : null}
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
              <div className="checkin__services-error">
                <Note tone="critical">The service list could not be loaded.</Note>
                <Button
                  variant="secondary"
                  className="checkin__retry-services"
                  onClick={() => {
                    // A click handler, not an effect, so setting 'loading'
                    // synchronously here is fine: the retry shows "Loading
                    // your services." immediately rather than sitting inert
                    // until the fetch resolves.
                    setServicesState({ kind: 'loading' });
                    void loadServices().then((next) => {
                      if (mountedRef.current) setServicesState(next);
                    });
                  }}
                >
                  Try again
                </Button>
              </div>
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
            {/* The practice's catalogue is bilingual and the chosen service's
                Arabic name belongs on this screen, beneath its English, the
                way every checklist item and question on the runner carries
                its own. It sits here rather than inside the options because
                a native <option> holds no markup, so nothing inside one can
                be marked as Arabic or laid out right to left. */}
            {selectedServiceNameAr ? (
              <p className="small muted" lang="ar" dir="rtl">
                {selectedServiceNameAr}
              </p>
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
                variant={resume.kind === 'offered' ? 'secondary' : 'primary'}
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
