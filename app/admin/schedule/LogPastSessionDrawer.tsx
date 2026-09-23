import { useEffect, useRef, useState } from 'react';
import { PAST_SESSION_MINUTES, type PastSessionBilling } from '@domain/session';
import { ClientListResponse, type ClientRow } from '../../api/clients/schema';
import { AppointmentOptionsResponse, type DeliveryMode } from '../../api/appointments/schema';
import {
  RecordPastSessionResponse,
  type RecordPastBadRequestCode,
  type RecordPastBlockReason,
} from '../../api/sessions/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note, Select } from '../../shell/components/Controls';
import { DateField } from '../../shell/components/DateField';
import { CloseIcon } from '../../shell/components/Icons';
import { TimeField } from '../../shell/components/TimeField';
import { VOID_CONFLICT_MESSAGES, isCorrectionConflictCode } from './VoidSessionDrawer';
import { formatDay } from './windows';

/**
 * "Log a past session": the drawer the day schedule opens for a day that has
 * passed (docs/superpowers/specs/2026-09-16-past-sessions-design.md, trunk
 * round 51). The clients the practice already has were seen before the app,
 * and the office types each visit up from the records: who, which service,
 * where, who delivered it, when it started and how long it ran, how it was
 * paid for, and why it is being logged now. `POST /api/sessions/from-records`
 * writes it as one completed appointment and one completed session, so it
 * stands in the day's list like any other visit.
 *
 * The same steps as the booking drawer, in the same order and from the same
 * options door, because a past visit is the same facts as a future one plus
 * a length and a settlement. Never a modal (DESIGN.md "The Beside Rule").
 *
 * **Correcting one** (`replaces`, trunk round 60): the same drawer, titled
 * "Correct a past session", opened from a visit logged from the records and
 * pre-filled from it — client, service, location, practitioner, day, start,
 * length and settlement — with a fresh reason to give. It sends `replaces`,
 * and the route voids the wrong visit and logs this one in its place in one
 * act, so the wrong visit is never gone while the right one is missing.
 */

/**
 * The visit a correction replaces, as the day schedule's row hands it over.
 * No delivery mode: the drawer reads it from the location, as it does for a
 * fresh log, so carrying the old one would only be a second answer to ignore.
 */
export type ReplacedVisit = {
  sessionId: string;
  client: Pick<ClientRow, 'id' | 'givenName' | 'familyName'>;
  serviceTypeId: string;
  locationId: string;
  practitionerId: string;
  on: string;
  startTime: string;
  durationMinutes: number | null;
  billing: PastSessionBilling;
};

const LOCATION_LABELS: Record<string, string> = {
  home: 'Home',
  work: 'Work',
  school: 'School',
  studio: 'The studio',
  base: 'Base',
  other: 'Other',
};

function deliveryModeOf(locationLabel: string): DeliveryMode {
  return locationLabel === 'studio' ? 'studio' : 'home';
}

const BILLING_LABELS: Record<PastSessionBilling, string> = {
  credit: "A credit from the client's package",
  settled_outside: 'Settled before the app, nothing to charge',
};

/** A 400 sends only a `code`; each is named here with its way out. */
const BAD_REQUEST_MESSAGES: Record<RecordPastBadRequestCode, string> = {
  invalid_request: 'Something on the form is missing or invalid. Check each step and try again.',
  reason_required: 'Say why this visit is being logged now.',
  not_a_day: 'That is not a day the calendar has. Check the date.',
  in_the_future: 'A past visit cannot be dated after today. Choose an earlier day.',
  too_old: 'That is before the practice existed. Check the year.',
  client_not_found: 'This client could not be found. Search again.',
  practitioner_not_found: 'This practitioner could not be found. Choose a different one.',
  practitioner_inactive: 'This practitioner is no longer active. Choose a different one.',
  service_type_not_found: 'This service could not be found. Choose a different one.',
  service_type_inactive: 'This service is no longer offered. Choose a different one.',
  delivery_mode_unavailable:
    'This service is not offered at that location. Choose a different location.',
  location_not_found: 'This location could not be found. Choose a different one.',
  location_mismatch:
    "This location isn't the client's own address or the studio. Choose one of those.",
};

/** What each block reason means to the person typing, and what to do about it. */
const BLOCK_MESSAGES: Record<RecordPastBlockReason, string> = {
  not_authorised:
    'This practitioner was not certified for this service on that day. Check the date, or choose who delivered it.',
  client_inactive: 'This client’s record is closed. A visit cannot be added to it.',
  consent_missing_participation:
    'The client has no participation consent on file. Record it on their record first.',
  consent_missing_minor_participation:
    'A guardian’s consent for this young person is not on file. Record it on their record first.',
  consent_missing_home_visit:
    'The client has no home-visit consent on file. Record it on their record first.',
  consent_missing_health_data:
    'The client’s consent to hold their brain-map and neurofeedback information is not on file. Record it first.',
  date_of_birth_unknown:
    'The client’s date of birth is not on their record. Add it first, so the practice knows whose consent applies.',
  no_credit_available:
    'No credit covers this visit on that day. Record the package sale first, or mark the visit as settled before the app.',
  practitioner_overlap:
    'This practitioner already had a visit at that time. Check the time, or the other visit.',
  client_overlap:
    'This client already had a visit at that time. Check the time, or the other visit.',
};

type SubmitError =
  | { kind: 'forbidden' }
  | { kind: 'messages'; messages: readonly string[] }
  | { kind: 'generic'; message: string };

type FetchState = 'idle' | 'loading' | 'ready' | 'error';

const GENERIC = 'The visit could not be logged. Try again.';

export function LogPastSessionDrawer({
  date: scheduleDate,
  replaces,
  onClose,
  onRecorded,
}: {
  /** The past day the schedule is showing: the visit is logged on it. */
  date: string;
  /** A correction: the visit logged from the records that this one replaces. */
  replaces?: ReplacedVisit;
  onClose: () => void;
  onRecorded: () => void;
}) {
  const { apiFetch } = useAuth();
  const closeRef = useRef<HTMLButtonElement>(null);

  const [clientQuery, setClientQuery] = useState('');
  const [clientResults, setClientResults] = useState<readonly ClientRow[] | null>(null);
  const [clientSearchState, setClientSearchState] = useState<FetchState>('idle');
  const [selectedClient, setSelectedClient] = useState<Pick<
    ClientRow,
    'id' | 'givenName' | 'familyName'
  > | null>(replaces?.client ?? null);

  const [options, setOptions] = useState<AppointmentOptionsResponse | null>(null);
  const [optionsState, setOptionsState] = useState<FetchState>('idle');
  const [serviceTypeId, setServiceTypeId] = useState<string | null>(
    replaces?.serviceTypeId ?? null,
  );
  const [locationId, setLocationId] = useState<string | null>(replaces?.locationId ?? null);
  const [practitionerId, setPractitionerId] = useState<string | null>(
    replaces?.practitionerId ?? null,
  );
  // A correction may move the visit to the day it really happened on; a
  // fresh log is written on the day the schedule is showing.
  const [date, setDate] = useState(replaces?.on ?? scheduleDate);
  const [startTime, setStartTime] = useState(replaces?.startTime ?? '');
  const [minutes, setMinutes] = useState(
    replaces?.durationMinutes == null ? '' : String(replaces.durationMinutes),
  );
  const [billing, setBilling] = useState<PastSessionBilling | ''>(replaces?.billing ?? '');
  const [reason, setReason] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);

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

  // The same debounced search as the booking drawer, for the same reasons.
  useEffect(() => {
    if (selectedClient) return;
    const query = clientQuery.trim();
    if (query.length < 2) return;
    let live = true;
    const timer = setTimeout(() => {
      setClientSearchState('loading');
      void apiFetch(`/api/clients?q=${encodeURIComponent(query)}`)
        .then(async (res) => {
          if (!live) return;
          if (!res.ok) {
            setClientSearchState('error');
            return;
          }
          const parsed = ClientListResponse.parse(await res.json());
          setClientResults(parsed.clients);
          setClientSearchState('ready');
        })
        .catch(() => {
          if (live) setClientSearchState('error');
        });
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [apiFetch, clientQuery, selectedClient]);

  // The booking route's own options door, asked for the visit's own day, so
  // the practitioners offered are the ones certified for the service then.
  useEffect(() => {
    if (!selectedClient) return;
    let live = true;
    const params = new URLSearchParams({ clientId: selectedClient.id });
    if (serviceTypeId) {
      params.set('serviceTypeId', serviceTypeId);
      params.set('date', date);
    }
    void apiFetch(`/api/appointments/options?${params.toString()}`)
      .then(async (res) => {
        if (!live) return;
        if (!res.ok) {
          setOptionsState('error');
          return;
        }
        const loaded = AppointmentOptionsResponse.parse(await res.json());
        setOptions(loaded);
        setOptionsState('ready');
        if (loaded.serviceTypes.length === 1) {
          setServiceTypeId((current) => current ?? loaded.serviceTypes[0]?.id ?? null);
        }
        if (loaded.practitioners.length === 1) {
          setPractitionerId((current) => current ?? loaded.practitioners[0]?.id ?? null);
        }
      })
      .catch(() => {
        if (live) setOptionsState('error');
      });
    return () => {
      live = false;
    };
  }, [apiFetch, selectedClient, serviceTypeId, date]);

  function selectClient(client: Pick<ClientRow, 'id' | 'givenName' | 'familyName'>) {
    setSelectedClient(client);
    setClientResults(null);
    setClientQuery('');
    setLocationId(null);
    setPractitionerId(null);
    setSubmitError(null);
  }

  function changeClient() {
    setSelectedClient(null);
    setOptions(null);
    setOptionsState('idle');
    setServiceTypeId(null);
    setLocationId(null);
    setPractitionerId(null);
    setSubmitError(null);
  }

  function selectService(id: string) {
    if ((id || null) === serviceTypeId) return;
    setServiceTypeId(id || null);
    setLocationId(null);
    setPractitionerId(null);
    setSubmitError(null);
    setOptions((previous) => (previous ? { ...previous, practitioners: [] } : previous));
  }

  const serviceType = options?.serviceTypes.find((s) => s.id === serviceTypeId) ?? null;
  const locationChoices = (options?.locations ?? []).filter((location) =>
    serviceType ? serviceType.deliveryModes.includes(deliveryModeOf(location.label)) : false,
  );
  const selectedLocation = locationChoices.find((l) => l.id === locationId) ?? null;
  const deliveryMode = selectedLocation ? deliveryModeOf(selectedLocation.label) : null;

  const minutesNumber = minutes.trim() === '' ? null : Number(minutes);
  const minutesValid =
    minutesNumber === null ||
    (Number.isInteger(minutesNumber) &&
      minutesNumber >= PAST_SESSION_MINUTES.min &&
      minutesNumber <= PAST_SESSION_MINUTES.max);

  const canSubmit =
    Boolean(
      date &&
      selectedClient &&
      serviceTypeId &&
      locationId &&
      deliveryMode &&
      practitionerId &&
      startTime &&
      billing &&
      reason.trim() &&
      minutesValid,
    ) && !submitting;

  async function handleSubmit() {
    if (!date || !selectedClient || !serviceTypeId || !locationId || !deliveryMode) return;
    if (!practitionerId || !startTime || !billing || !reason.trim() || !minutesValid) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await apiFetch('/api/sessions/from-records', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-reason': reason.trim() },
        body: JSON.stringify({
          clientId: selectedClient.id,
          practitionerId,
          serviceTypeId,
          locationId,
          deliveryMode,
          on: date,
          startTime,
          ...(minutesNumber === null ? {} : { durationMinutes: minutesNumber }),
          billing,
          ...(replaces ? { replaces: replaces.sessionId } : {}),
        }),
      });
      if (res.status === 201) {
        onRecorded();
        return;
      }
      if (res.status === 403) {
        setSubmitError({ kind: 'forbidden' });
        return;
      }
      const body = (await res.json().catch(() => null)) as unknown;
      if (res.status === 422) {
        const parsed = RecordPastSessionResponse.safeParse(body);
        if (parsed.success && parsed.data.status === 'blocked') {
          setSubmitError({
            kind: 'messages',
            messages: parsed.data.reasons.map((r) => BLOCK_MESSAGES[r]),
          });
          return;
        }
      }
      // A correction refused because the visit it replaces cannot be voided,
      // or belongs to another household.
      if (res.status === 409) {
        const code = (body as { code?: unknown } | null)?.code;
        setSubmitError({
          kind: 'messages',
          messages: [isCorrectionConflictCode(code) ? VOID_CONFLICT_MESSAGES[code] : GENERIC],
        });
        return;
      }
      if (res.status === 400) {
        const code = (body as { code?: RecordPastBadRequestCode } | null)?.code;
        setSubmitError({
          kind: 'messages',
          messages: [code && BAD_REQUEST_MESSAGES[code] ? BAD_REQUEST_MESSAGES[code] : GENERIC],
        });
        return;
      }
      setSubmitError({ kind: 'generic', message: GENERIC });
    } catch {
      setSubmitError({ kind: 'generic', message: GENERIC });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <aside className="drawer" role="dialog" aria-labelledby="log-past-session-title">
      <header className="drawer__header">
        <div className="drawer__title">
          <h2 id="log-past-session-title">
            {replaces ? 'Correct a past session' : 'Log a past session'}
          </h2>
          <p className="small muted">
            {replaces
              ? 'The visit as it should have been logged. The wrong one is voided in the same step.'
              : `On ${formatDay(date)}, from the practice’s records. It stands in the day’s list as completed.`}
          </p>
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
        <div className="stepper">
          <div className="stepper__step">
            <span className="field__label">Client</span>
            {selectedClient ? (
              <p className="stepper__chosen">
                <span>
                  {selectedClient.givenName} {selectedClient.familyName}
                </span>
                <Button variant="quiet" onClick={changeClient}>
                  Change
                </Button>
              </p>
            ) : (
              <>
                <Field
                  id="past-client-search"
                  label="Search clients"
                  type="search"
                  placeholder="Name or record number"
                  value={clientQuery}
                  onChange={(e) => setClientQuery(e.target.value)}
                />
                {clientQuery.trim() ? (
                  <>
                    {clientQuery.trim().length < 2 ? (
                      <Note>Keep typing: search starts at two characters.</Note>
                    ) : null}
                    {clientQuery.trim().length >= 2 && clientSearchState === 'loading' ? (
                      <Note>Searching.</Note>
                    ) : null}
                    {clientQuery.trim().length >= 2 && clientSearchState === 'error' ? (
                      <Note tone="critical">The client list could not be searched. Try again.</Note>
                    ) : null}
                    {clientQuery.trim().length >= 2 &&
                    clientSearchState === 'ready' &&
                    (clientResults ?? []).length === 0 ? (
                      <Note>No client matches.</Note>
                    ) : null}
                    {clientQuery.trim().length >= 2 &&
                    clientSearchState === 'ready' &&
                    clientResults &&
                    clientResults.length > 0 ? (
                      <ul className="stepper__results">
                        {clientResults.map((client) => (
                          <li key={client.id}>
                            <button
                              type="button"
                              className="link"
                              onClick={() => selectClient(client)}
                            >
                              {client.givenName} {client.familyName}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                ) : null}
              </>
            )}
          </div>

          <div className="stepper__step">
            <Select
              id="past-service"
              label="Service"
              disabled={!selectedClient}
              hint={selectedClient ? undefined : 'Choose a client first'}
              value={serviceTypeId ?? ''}
              onChange={(e) => selectService(e.target.value)}
            >
              <option value="">Choose a service</option>
              {(options?.serviceTypes ?? []).map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </Select>
            {optionsState === 'error' ? (
              <Note tone="critical">The service list could not be loaded. Try again.</Note>
            ) : null}
          </div>

          <div className="stepper__step">
            <Select
              id="past-location"
              label="Location"
              disabled={!serviceType}
              hint={serviceType ? undefined : 'Choose a service first'}
              value={locationId ?? ''}
              onChange={(e) => {
                setLocationId(e.target.value || null);
                setSubmitError(null);
              }}
            >
              <option value="">Choose a location</option>
              {locationChoices.map((location) => (
                <option key={location.id} value={location.id}>
                  {LOCATION_LABELS[location.label] ?? location.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="stepper__step">
            <Select
              id="past-practitioner"
              label="Practitioner"
              disabled={!serviceType}
              hint={serviceType ? 'Who delivered the visit' : 'Choose a service first'}
              value={practitionerId ?? ''}
              onChange={(e) => {
                setPractitionerId(e.target.value || null);
                setSubmitError(null);
              }}
            >
              <option value="">Choose a practitioner</option>
              {(options?.practitioners ?? []).map((practitioner) => (
                <option key={practitioner.id} value={practitioner.id}>
                  {practitioner.displayName}
                </option>
              ))}
            </Select>
            {serviceType && (options?.practitioners ?? []).length === 0 ? (
              <Note>No practitioner was certified for this service on that day.</Note>
            ) : null}
          </div>

          <div className="stepper__step">
            {replaces ? (
              <DateField
                id="past-day"
                label="Day"
                value={date}
                onChange={(next) => {
                  setDate(next);
                  setSubmitError(null);
                }}
              />
            ) : null}
            <TimeField
              id="past-start-time"
              label="Start time"
              value={startTime}
              onChange={(next) => {
                setStartTime(next);
                setSubmitError(null);
              }}
            />
            <Field
              id="past-minutes"
              label="Length in minutes (optional)"
              type="number"
              inputMode="numeric"
              min={PAST_SESSION_MINUTES.min}
              max={PAST_SESSION_MINUTES.max}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              hint={
                minutesValid
                  ? "Leave blank for the service's usual length."
                  : `Between ${PAST_SESSION_MINUTES.min} and ${PAST_SESSION_MINUTES.max} minutes.`
              }
              error={minutesValid ? undefined : 'Not a length a visit can have.'}
            />
          </div>

          <div className="stepper__step">
            <Select
              id="past-billing"
              label="How was it paid for?"
              value={billing}
              onChange={(e) => {
                setBilling(e.target.value as PastSessionBilling | '');
                setSubmitError(null);
              }}
            >
              <option value="">Choose one</option>
              {(Object.keys(BILLING_LABELS) as PastSessionBilling[]).map((choice) => (
                <option key={choice} value={choice}>
                  {BILLING_LABELS[choice]}
                </option>
              ))}
            </Select>
            <Field
              id="past-reason"
              label="Why it is being logged now"
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              hint="Kept on the record with the visit."
            />
          </div>

          {submitError ? (
            submitError.kind === 'forbidden' ? (
              <Note tone="critical">
                Only the owner, an admin or a lead practitioner can log a past session.
              </Note>
            ) : submitError.kind === 'generic' ? (
              <Note tone="critical">{submitError.message}</Note>
            ) : (
              <div className="stepper__issues">
                {submitError.messages.map((message, index) => (
                  <Note key={`${index}-${message}`} tone="critical">
                    {message}
                  </Note>
                ))}
              </div>
            )
          ) : null}

          <div className="stepper__submit">
            <Button variant="primary" disabled={!canSubmit} onClick={() => void handleSubmit()}>
              {submitting ? 'Logging…' : replaces ? 'Log the correction' : 'Log the session'}
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}
