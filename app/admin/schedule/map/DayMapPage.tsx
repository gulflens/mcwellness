import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { AppointmentListResponse, type AppointmentRow } from '../../../api/appointments/schema';
import { PracticeDayResponse, type PracticeDayPractitioner } from '../../../api/routing/schema';
import { useAuth } from '../../../shell/auth/AuthContext';
import { Button, Field, Note, PageHeader, Select } from '../../../shell/components/Controls';
import { StatusChip } from '../../../shell/components/StatusChip';
import { APPOINTMENT_STATUS_LABELS, APPOINTMENT_STATUS_TONES } from '../appointmentStatus';
import { CancelAppointmentDrawer } from '../CancelAppointmentDrawer';
import { MoveAppointmentDrawer } from '../MoveAppointmentDrawer';
import { formatWindow, practiceDay } from '../windows';
import { DayMap, formatDrive } from './DayMap';
import { browserMapKey, loadGoogleMaps, type GoogleMaps } from './googleMaps';
import { OptimiseDrawer } from './OptimiseDrawer';
import './map.css';

/**
 * The practice's day, drawn (docs/SPEC/route-planning.md sections 4 and 5;
 * docs/SPEC/scheduling-manual.md section 4.2; docs/DESIGN-BRIEF.md 6.2, "the
 * one full-bleed screen"). The map fills the content area and the day's own
 * rows sit over its inline start, carrying the same facts the Schedule table
 * carries and the same three actions.
 *
 * **Two reads, joined by an id.** `GET /api/appointments?date=` carries who
 * is behind each door and is where the audit trail records that the day was
 * read; `GET /api/routing/practice-day?date=` carries the coordinates and the
 * drives and names nobody. Neither would be enough on its own, and neither is
 * widened to do the other's work.
 *
 * **This page is opened by a plain anchor, never by the router.** It is
 * served as its own document with the wider content security policy a
 * browser map needs (section 8); a client-side navigation would carry the
 * strict policy in with it and Google's script would be refused silently. If
 * that happens anyway, the page says which door to come in by rather than
 * showing an empty frame.
 *
 * **The map is never the day.** With no key, a blocked script or a vendor
 * that is down, the rows, the estimates and the optimiser all still work:
 * what is lost is a picture.
 */

const NO_KEY = "The map needs the practice's browser key.";
const NOT_LOADED = 'The map could not be loaded.';
const WRONG_DOOR =
  'Open the day map from the Schedule page — a map cannot load on a screen you reached ' +
  'from another one.';
const DAY_FAILED = 'The day could not be loaded. Try again.';
const CONFIRM_FAILED =
  'The visit could not be confirmed. Reload the day to see where it stands, then try again.';
const ALREADY_MOVED_ON =
  'This visit is no longer waiting to be confirmed — it has been confirmed, moved or called ' +
  'off already. Reload the day to see where it stands.';

/** The two statuses a visit can still be moved or called off from. */
const OPEN_STATUSES: readonly AppointmentRow['status'][] = ['proposed', 'confirmed'];

type State =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; appointments: readonly AppointmentRow[]; day: PracticeDayResponse };

export type DayMapPageProps = {
  /** The build's own key unless a test says otherwise. */
  browserKey?: string | null;
  /** Injected so no test reaches the network. */
  loadMaps?: (key: string) => Promise<GoogleMaps>;
};

export function DayMapPage({ browserKey, loadMaps }: DayMapPageProps = {}) {
  const { apiFetch } = useAuth();
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? practiceDay(new Date());
  const setDate = (next: string) => setParams(next ? { date: next } : {});
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const [maps, setMaps] = useState<GoogleMaps | null>(null);
  // Only the load's own failure is state; "there is no key" is a fact about
  // the build and is derived below rather than written into an effect.
  const [loadFailure, setLoadFailure] = useState<string | null>(null);
  const [acting, setActing] = useState<{ kind: 'move' | 'cancel'; row: AppointmentRow } | null>(
    null,
  );
  const [optimising, setOptimising] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);

  const key = browserKey === undefined ? browserMapKey() : browserKey;

  useEffect(() => {
    if (key === null) return;
    let live = true;
    void (loadMaps ?? loadGoogleMaps)(key)
      .then((namespace) => {
        if (!live) return;
        setLoadFailure(null);
        setMaps(namespace);
      })
      .catch(() => {
        if (!live) return;
        // A script refused by the policy is a page somebody reached by the
        // wrong door: the map document has its own, and only its own document
        // carries the nonce that admits Google's script.
        setLoadFailure(document.querySelector('script[nonce]') === null ? WRONG_DOOR : NOT_LOADED);
      });
    return () => {
      live = false;
    };
  }, [key, loadMaps]);

  const mapNote = key === null ? NO_KEY : loadFailure;

  useEffect(() => {
    let live = true;
    void Promise.all([
      apiFetch(`/api/appointments?date=${date}`),
      apiFetch(`/api/routing/practice-day?date=${date}`),
    ])
      .then(async ([list, road]) => {
        if (!live) return;
        if (!list.ok || !road.ok) {
          setState({ kind: 'error' });
          return;
        }
        setState({
          kind: 'ready',
          appointments: AppointmentListResponse.parse(await list.json()).appointments,
          day: PracticeDayResponse.parse(await road.json()),
        });
      })
      .catch(() => {
        if (live) setState({ kind: 'error' });
      });
    return () => {
      live = false;
    };
  }, [apiFetch, date, reloadToken]);

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1);
    setSelectedId(null);
  }, []);

  /** Every practitioner with a stop that day, in the order the answer gives. */
  const practitioners = state.kind === 'ready' ? state.day.practitioners : [];
  const current: PracticeDayPractitioner | null =
    practitioners.find((p) => p.practitionerId === shown) ?? practitioners[0] ?? null;

  /** The rows of the shown practitioner's day, in window order, with their stop numbers. */
  const rows = useMemo(() => {
    if (state.kind !== 'ready' || current === null) return [];
    const byId = new Map(state.appointments.map((row) => [row.id, row]));
    return current.stops
      .map((stop, index) => {
        const row = byId.get(stop.appointmentId);
        return row === undefined
          ? null
          : {
              row,
              index,
              leg: current.legs.find((leg) => leg.toStopId === stop.appointmentId),
            };
      })
      .filter(
        (
          entry,
        ): entry is {
          row: AppointmentRow;
          index: number;
          leg: (typeof current.legs)[number] | undefined;
        } => entry !== null,
      );
  }, [state, current]);

  const practitionerName =
    rows[0]?.row.practitioner.displayName ??
    (state.kind === 'ready'
      ? (state.appointments.find((row) => row.practitioner.id === current?.practitionerId)
          ?.practitioner.displayName ?? null)
      : null);

  const confirm = useCallback(
    async (row: AppointmentRow) => {
      setActionError(null);
      setConfirming(row.id);
      try {
        const res = await apiFetch(`/api/appointments/${row.id}/confirm`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        });
        if (res.ok) {
          reload();
          return;
        }
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        setActionError(
          body?.code === 'appointment_not_proposed' || res.status === 404
            ? ALREADY_MOVED_ON
            : res.status === 403
              ? 'You do not have permission to confirm this appointment.'
              : CONFIRM_FAILED,
        );
      } catch {
        setActionError(CONFIRM_FAILED);
      } finally {
        setConfirming(null);
      }
    },
    [apiFetch, reload],
  );

  const movable = rows.filter((entry) => entry.row.status === 'proposed').length;
  const canOptimise = state.kind === 'ready' && rows.length >= 2 && movable > 0;

  return (
    <section className="page daymap__page">
      {maps !== null && current !== null ? (
        <DayMap maps={maps} day={current} selectedId={selectedId} onSelect={setSelectedId} />
      ) : (
        <div className="daymap daymap--absent" />
      )}
      <aside className="daymap__panel" aria-label="The day">
        <PageHeader title="Day map" aside={practitionerName ?? undefined} />
        <div className="toolbar">
          <Field
            id="daymap-date"
            className="schedule__date"
            label="Date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          {/* A plain anchor, not a Link: this document carries the map's own
              policy and the Schedule page carries the strict one, so each is
              entered as its own document (section 4.1). */}
          <a className="link schedule__week-link" href={`/admin/schedule?date=${date}`}>
            Schedule
          </a>
          {practitioners.length > 1 ? (
            <Select
              id="daymap-practitioner"
              label="Practitioner"
              value={current?.practitionerId ?? ''}
              onChange={(e) => {
                setShown(e.target.value);
                setSelectedId(null);
              }}
            >
              {practitioners.map((p) => (
                <option key={p.practitionerId} value={p.practitionerId}>
                  {state.kind === 'ready'
                    ? (state.appointments.find((row) => row.practitioner.id === p.practitionerId)
                        ?.practitioner.displayName ?? 'Practitioner')
                    : 'Practitioner'}
                </option>
              ))}
            </Select>
          ) : null}
          <Button
            variant="secondary"
            disabled={!canOptimise}
            onClick={() => {
              setActing(null);
              setApplied(null);
              setOptimising(true);
            }}
          >
            Optimise the day
          </Button>
        </div>
        {mapNote ? <Note>{mapNote}</Note> : null}
        {state.kind === 'loading' ? <Note>Loading the day.</Note> : null}
        {state.kind === 'error' ? <Note tone="critical">{DAY_FAILED}</Note> : null}
        {actionError ? <Note tone="critical">{actionError}</Note> : null}
        {applied ? <Note>{applied}</Note> : null}
        {state.kind === 'ready' && rows.length === 0 ? (
          <Note>No appointments are booked for this day.</Note>
        ) : null}
        <ol className="daymap__rows">
          {rows.map(({ row, index, leg }) => (
            <li
              key={row.id}
              className="daymap__row"
              aria-current={selectedId === row.id ? 'true' : undefined}
            >
              {index > 0 ? <p className="daymap__drive small muted">{formatDrive(leg)}</p> : null}
              <div className="daymap__row-head">
                <span className="daymap__row-number numeric">{index + 1}</span>
                <span className="numeric">{formatWindow(row.windowStart, row.windowEnd)}</span>
                <StatusChip
                  label={APPOINTMENT_STATUS_LABELS[row.status]}
                  tone={APPOINTMENT_STATUS_TONES[row.status]}
                />
              </div>
              <button type="button" className="link" onClick={() => setSelectedId(row.id)}>
                {row.client.givenName} {row.client.familyName}
              </button>
              <p className="small muted">
                {row.serviceType.name}, {row.location.label}, {row.location.emirate}
              </p>
              {OPEN_STATUSES.includes(row.status) ? (
                <span className="schedule__row-actions">
                  {row.status === 'proposed' ? (
                    <Button
                      variant="quiet"
                      disabled={confirming !== null}
                      aria-label={`Confirm ${row.client.givenName} ${row.client.familyName}'s appointment`}
                      onClick={() => void confirm(row)}
                    >
                      {confirming === row.id ? 'Confirming…' : 'Confirm'}
                    </Button>
                  ) : null}
                  <Button
                    variant="quiet"
                    aria-label={`Move ${row.client.givenName} ${row.client.familyName}'s appointment`}
                    onClick={() => {
                      setOptimising(false);
                      setActing({ kind: 'move', row });
                    }}
                  >
                    Move
                  </Button>
                  <Button
                    variant="quiet"
                    aria-label={`Call off ${row.client.givenName} ${row.client.familyName}'s appointment`}
                    onClick={() => {
                      setOptimising(false);
                      setActing({ kind: 'cancel', row });
                    }}
                  >
                    Call off
                  </Button>
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </aside>
      {acting?.kind === 'move' ? (
        <MoveAppointmentDrawer
          appointment={acting.row}
          onClose={() => setActing(null)}
          onMoved={() => {
            setActing(null);
            reload();
          }}
        />
      ) : null}
      {acting?.kind === 'cancel' ? (
        <CancelAppointmentDrawer
          appointment={acting.row}
          onClose={() => setActing(null)}
          onCancelled={reload}
        />
      ) : null}
      {optimising && current !== null ? (
        <OptimiseDrawer
          date={date}
          practitionerId={current.practitionerId}
          stops={rows.map(({ row }) => row)}
          onClose={() => setOptimising(false)}
          onApplied={(message) => {
            setOptimising(false);
            setApplied(message);
            reload();
          }}
        />
      ) : null}
    </section>
  );
}
