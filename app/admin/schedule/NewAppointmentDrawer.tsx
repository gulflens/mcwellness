import { useEffect, useRef, useState } from 'react';
import { ClientListResponse, type ClientRow } from '../../api/clients/schema';
import {
  AppointmentOptionsResponse,
  AppointmentRow,
  ConflictResponse,
  type BadRequestCode,
  type DeliveryMode,
} from '../../api/appointments/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note, Select } from '../../shell/components/Controls';
import { CloseIcon } from '../../shell/components/Icons';
import { localConflictMessage } from './conflictMessages';
import { composeWindowStart, windowEndForTime } from './windows';

/**
 * The right-side "new appointment" drawer (docs/SPEC/scheduling-manual.md
 * section 4.3, cut to what `POST /api/appointments` accepts today): client,
 * then service, then location, then practitioner, then a start time. Each
 * step unlocks only once the data it needs exists — location and
 * practitioner both need nothing but a chosen service, so they unlock
 * together, not one after the other; the start time needs both of them, so
 * it unlocks last. Never a modal (DESIGN.md "The Beside Rule"): fixed to the
 * inline end, over the ledger, no scrim.
 */

/** `location.label` is the place's category, not a free-text address
 * (docs/SPEC/00-data-model.md section 3): 'studio' is the practice's one
 * studio location; anything else returned by the options route is a
 * location that belongs to the client. That single check is the only signal
 * this screen has for which delivery mode a chosen location implies — the
 * options route does not send `owner_type` — so it doubles as the delivery
 * icon in the location list and as the `deliveryMode` this drawer submits. */
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

/** A 400 sends only a `code`; this is this screen's own plain-language line
 * for each one, naming the problem and the way out (craft-floor's "errors
 * name the problem and the recovery"), not just the problem alone. */
const BAD_REQUEST_MESSAGES: Partial<Record<BadRequestCode, string>> = {
  location_mismatch:
    "This location isn't the client's own address or the studio. Choose one of those.",
  client_not_found: 'This client could not be found. Search again.',
  practitioner_not_found: 'This practitioner could not be found. Choose a different one.',
  practitioner_inactive: 'This practitioner is no longer active. Choose a different one.',
  service_type_not_found: 'This service could not be found. Choose a different one.',
  service_type_inactive: 'This service is no longer offered. Choose a different one.',
  delivery_mode_unavailable:
    'This service is not offered at that location. Choose a different location.',
  location_not_found: 'This location could not be found. Choose a different one.',
  invalid_request: 'Something on the form is missing or invalid. Check each step and try again.',
};

type Issue = { code: string; message: string };

type SubmitError =
  | { kind: 'forbidden' }
  | { kind: 'issues'; issues: readonly Issue[] }
  | { kind: 'generic'; message: string };

type FetchState = 'idle' | 'loading' | 'ready' | 'error';

export function NewAppointmentDrawer({
  date,
  onClose,
  onCreated,
}: {
  /** The day the schedule was showing when the panel opened; the panel's own
   * date field starts there. */
  date: string;
  onClose: () => void;
  onCreated: (appointment: AppointmentRow) => void;
}) {
  const { apiFetch } = useAuth();
  const closeRef = useRef<HTMLButtonElement>(null);

  const [clientQuery, setClientQuery] = useState('');
  const [clientResults, setClientResults] = useState<readonly ClientRow[] | null>(null);
  const [clientSearchState, setClientSearchState] = useState<FetchState>('idle');
  const [selectedClient, setSelectedClient] = useState<ClientRow | null>(null);

  const [options, setOptions] = useState<AppointmentOptionsResponse | null>(null);
  const [optionsState, setOptionsState] = useState<FetchState>('idle');
  const [selectedServiceTypeId, setSelectedServiceTypeId] = useState<string | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [selectedPractitionerId, setSelectedPractitionerId] = useState<string | null>(null);
  const [startTime, setStartTime] = useState('');
  const [bookingDate, setBookingDate] = useState(date);

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

  // Client search: debounced, same rhythm as ClientsPage's own search. An
  // empty query fetches nothing; the render below hides the results block in
  // that case rather than the effect resetting state for it, so no setState
  // ever runs synchronously in the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (selectedClient) return;
    const query = clientQuery.trim();
    // Below two characters, a search is mostly noise (near-every client
    // matches) and near-every keystroke would send one; the render below
    // shows a "keep typing" line instead rather than staying silent.
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

  // Options: locations need the client; practitioners need the service and
  // this day too. Cleared explicitly by changeClient(), an event handler, not
  // by this effect, for the same reason as the search effect above.
  useEffect(() => {
    if (!selectedClient) return;
    let live = true;
    const params = new URLSearchParams({ clientId: selectedClient.id });
    if (selectedServiceTypeId) {
      params.set('serviceTypeId', selectedServiceTypeId);
      params.set('date', bookingDate);
    }
    void apiFetch(`/api/appointments/options?${params.toString()}`)
      .then(async (res) => {
        if (!live) return;
        if (!res.ok) {
          setOptionsState('error');
          return;
        }
        setOptions(AppointmentOptionsResponse.parse(await res.json()));
        setOptionsState('ready');
      })
      .catch(() => {
        if (live) setOptionsState('error');
      });
    return () => {
      live = false;
    };
  }, [apiFetch, selectedClient, selectedServiceTypeId, bookingDate]);

  function selectClient(client: ClientRow) {
    setSelectedClient(client);
    setClientResults(null);
    setClientQuery('');
    setSelectedServiceTypeId(null);
    setSelectedLocationId(null);
    setSelectedPractitionerId(null);
    setStartTime('');
    setSubmitError(null);
  }

  function changeClient() {
    setSelectedClient(null);
    setOptions(null);
    setOptionsState('idle');
    setSelectedServiceTypeId(null);
    setSelectedLocationId(null);
    setSelectedPractitionerId(null);
    setStartTime('');
    setSubmitError(null);
  }

  function selectService(id: string) {
    setSelectedServiceTypeId(id || null);
    setSelectedLocationId(null);
    setSelectedPractitionerId(null);
    setStartTime('');
    setSubmitError(null);
    // The practitioner list is filtered by service + date server-side, so the
    // options effect below re-fetches it the moment selectedServiceTypeId
    // changes — but until that fetch resolves, options.practitioners still
    // holds whoever was credentialed for the OLD service. Cleared here so the
    // now-enabled practitioner select never offers that stale list, even for
    // one render (serviceTypes and locations are untouched: neither depends
    // on which service is chosen, so neither one goes stale).
    setOptions((previous) => (previous ? { ...previous, practitioners: [] } : previous));
  }

  const serviceType = options?.serviceTypes.find((s) => s.id === selectedServiceTypeId) ?? null;
  const locationChoices = (options?.locations ?? []).filter((location) =>
    serviceType ? serviceType.deliveryModes.includes(deliveryModeOf(location.label)) : false,
  );
  const selectedLocation = locationChoices.find((l) => l.id === selectedLocationId) ?? null;
  const deliveryMode = selectedLocation ? deliveryModeOf(selectedLocation.label) : null;

  const practitionerStepEnabled = Boolean(serviceType);
  const timeStepEnabled = Boolean(selectedLocationId && selectedPractitionerId);
  const canSubmit =
    Boolean(
      selectedClient &&
      selectedServiceTypeId &&
      selectedLocationId &&
      deliveryMode &&
      selectedPractitionerId &&
      startTime,
    ) && !submitting;

  async function handleSubmit() {
    if (!selectedClient || !selectedServiceTypeId || !selectedLocationId || !deliveryMode) return;
    if (!selectedPractitionerId || !startTime) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await apiFetch('/api/appointments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          clientId: selectedClient.id,
          practitionerId: selectedPractitionerId,
          serviceTypeId: selectedServiceTypeId,
          locationId: selectedLocationId,
          deliveryMode,
          windowStart: composeWindowStart(bookingDate, startTime),
        }),
      });
      if (res.status === 201) {
        onCreated(AppointmentRow.parse(await res.json()));
        return;
      }
      if (res.status === 409) {
        const parsed = ConflictResponse.parse(await res.json());
        setSubmitError({
          kind: 'issues',
          issues: parsed.issues.map((issue) => ({
            code: issue.code,
            message: localConflictMessage(issue),
          })),
        });
        return;
      }
      if (res.status === 403) {
        setSubmitError({ kind: 'forbidden' });
        return;
      }
      if (res.status === 400) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        const code = body?.code as BadRequestCode | undefined;
        setSubmitError({
          kind: 'issues',
          issues: [
            {
              code: code ?? 'invalid_request',
              message:
                (code && BAD_REQUEST_MESSAGES[code]) ??
                'Something on the form is missing or invalid.',
            },
          ],
        });
        return;
      }
      setSubmitError({
        kind: 'generic',
        message: 'The appointment could not be booked. Try again.',
      });
    } catch {
      setSubmitError({
        kind: 'generic',
        message: 'The appointment could not be booked. Try again.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <aside className="drawer" role="dialog" aria-labelledby="new-appointment-title">
      <header className="drawer__header">
        <div className="drawer__title">
          <h2 id="new-appointment-title">New appointment</h2>
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
            <Field
              id="new-appointment-date"
              label="Date"
              type="date"
              value={bookingDate}
              onChange={(e) => {
                setBookingDate(e.target.value);
                // A practitioner certified on one day may be away on another: the
                // list is filtered by date on the server, so the choice is
                // cleared and fetched again.
                setSelectedPractitionerId(null);
              }}
              hint="The visit is booked on this day."
            />
          </div>

          <div className="stepper__step">
            {/* A plain label, not a heading: the other four steps carry no
                heading of their own either (each is named by its own Field
                or Select label instead), and a single h3 here with none
                beside it would be a lone heading with no sibling level to
                sit inside (DESIGN.md's heading hierarchy). */}
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
                  id="appt-client-search"
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
              id="appt-service"
              label="Service"
              disabled={!selectedClient}
              hint={selectedClient ? undefined : 'Choose a client first'}
              value={selectedServiceTypeId ?? ''}
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
              id="appt-location"
              label="Location"
              disabled={!serviceType}
              hint={serviceType ? undefined : 'Choose a service first'}
              value={selectedLocationId ?? ''}
              onChange={(e) => {
                setSelectedLocationId(e.target.value || null);
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
            {serviceType && locationChoices.length === 0 ? (
              <Note>No home or studio location is available for this client and service.</Note>
            ) : null}
          </div>

          <div className="stepper__step">
            <Select
              id="appt-practitioner"
              label="Practitioner"
              disabled={!practitionerStepEnabled}
              hint={practitionerStepEnabled ? undefined : 'Choose a service first'}
              value={selectedPractitionerId ?? ''}
              onChange={(e) => {
                setSelectedPractitionerId(e.target.value || null);
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
              <Note>
                No practitioner is certified for this service on this date. Choose a different
                service, or ask the practice to certify one for it.
              </Note>
            ) : null}
          </div>

          <div className="stepper__step">
            <Field
              id="appt-start-time"
              label="Start time"
              type="time"
              disabled={!timeStepEnabled}
              value={startTime}
              onChange={(e) => {
                setStartTime(e.target.value);
                setSubmitError(null);
              }}
              hint={
                !timeStepEnabled
                  ? 'Choose a location and a practitioner first'
                  : startTime
                    ? `Arrival window ${startTime}–${windowEndForTime(startTime)}`
                    : undefined
              }
            />
          </div>

          {submitError ? (
            submitError.kind === 'forbidden' ? (
              <Note tone="critical">
                Only the owner, an admin or a lead practitioner can book an appointment.
              </Note>
            ) : submitError.kind === 'generic' ? (
              <Note tone="critical">{submitError.message}</Note>
            ) : (
              // Each issue is its own Note, which already announces (role="alert"
              // on the critical tone): no wrapper role="alert" nesting one
              // alert region inside another, and no bespoke .issues list that
              // could not announce anything at all on its own.
              <div className="stepper__issues">
                {submitError.issues.map((issue, index) => (
                  <Note key={`${issue.code}-${index}`} tone="critical">
                    {issue.message}
                  </Note>
                ))}
              </div>
            )
          ) : null}

          <div className="stepper__submit">
            <Button variant="primary" disabled={!canSubmit} onClick={() => void handleSubmit()}>
              {submitting ? 'Booking…' : 'Book appointment'}
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}
