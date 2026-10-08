import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  AppointmentListResponse,
  type AppointmentRow,
  type DeliveryMode,
} from '../../api/appointments/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { canOpenSettings } from '../../shell/adminAccess';
import { Button, Note, PageHeader } from '../../shell/components/Controls';
import { DateField } from '../../shell/components/DateField';
import { StatusChip } from '../../shell/components/StatusChip';
import { Table, type Column } from '../../shell/components/Table';
import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_STATUS_TONES,
  isCalledOff,
} from './appointmentStatus';
import { CancellationPolicyDrawer } from './CancellationPolicyDrawer';
import { LogPastSessionDrawer } from './LogPastSessionDrawer';
import { NewAppointmentDrawer } from './NewAppointmentDrawer';
import { ScheduleClientDrawer } from './ScheduleClientDrawer';
import {
  ShowCalledOff,
  useVisitActions,
  VisitActionButtons,
  VisitActionDrawers,
} from './visitActions';
import { dayOf, formatMovedTo, formatWindow, practiceDay } from './windows';
import './schedule.css';

/**
 * The admin console's day schedule (docs/SPEC/scheduling-manual.md section
 * 4.1, cut to a table for this pull request — the week calendar and the day
 * map are later work). One tenant-local calendar day, across every
 * practitioner, with an "Add appointment" door onto `POST /api/appointments`.
 */

const DELIVERY_LABELS: Record<DeliveryMode, string> = {
  home: 'Home',
  studio: 'Studio',
  remote: 'Remote',
};

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; appointments: readonly AppointmentRow[] };

export function SchedulePage() {
  const { apiFetch, session } = useAuth();
  // The day lives in the address, so the week view can hand a day back and a
  // reload or a shared link opens on the same one. A date is not personal
  // data (.claude/rules/ui.md forbids putting a person in a query string, not
  // a calendar day).
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? practiceDay(new Date());
  const setDate = (next: string) => setParams(next ? { date: next } : {});
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [selectedClient, setSelectedClient] = useState<AppointmentRow['client'] | null>(null);
  const [policyOpen, setPolicyOpen] = useState(false);
  // A visit that happened before the app, typed up from the records: offered
  // only on a day that has passed, to the same three roles that book
  // (trunk round 51). Today's visits are checked in at the door.
  const [pastOpen, setPastOpen] = useState(false);
  const isPastDay = date < practiceDay(new Date());
  // Called-off visits stay on the day's list on purpose
  // (app/api/appointments/list.ts) and are folded away here until asked for.
  const [showCalledOff, setShowCalledOff] = useState(false);
  // The two figures the cancel drawer quotes are the owner's and an admin's to
  // change — the same audience the practice's own identity has, and the same
  // one `scheduling_setting_write` admits beneath the route.
  const canEditPolicy =
    session.status === 'signed-in' && canOpenSettings(session.actor, new Date());

  useEffect(() => {
    let live = true;
    void apiFetch(`/api/appointments?date=${date}`)
      .then(async (res) => {
        if (!live) return;
        if (!res.ok) {
          setState({
            kind: 'error',
            message: "The day's appointments could not be loaded. Try again.",
          });
          return;
        }
        const parsed = AppointmentListResponse.parse(await res.json());
        setState({ kind: 'ready', appointments: parsed.appointments });
      })
      .catch(() => {
        if (live) {
          setState({
            kind: 'error',
            message: "The day's appointments could not be loaded. Try again.",
          });
        }
      });
    return () => {
      live = false;
    };
  }, [apiFetch, date, reloadToken]);

  const handleCreated = useCallback(() => {
    setDrawerOpen(false);
    setReloadToken((token) => token + 1);
  }, []);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  // One drawer at a time: the schedule has one inline-end slot, and two
  // drawers stacked in it would be two dialogs fighting over the same focus.
  const closeOthers = useCallback(() => {
    setDrawerOpen(false);
    setPastOpen(false);
    setSelectedClient(null);
    setPolicyOpen(false);
  }, []);
  const { acting, openAction, closeAction, confirm, confirming, actionError, canVoid } =
    useVisitActions({ onChanged: reload, beforeOpen: closeOthers });

  const columns = useMemo<Column<AppointmentRow>[]>(
    () => [
      {
        key: 'window',
        header: 'Window',
        numeric: true,
        render: (row) => formatWindow(row.windowStart, row.windowEnd),
      },
      {
        key: 'client',
        header: 'Client',
        // The same cell pattern the clients table uses for a name
        // (ClientsPage.tsx): a link that opens the record.
        render: (row) => (
          <span className="name">
            <button
              type="button"
              className="link"
              onClick={() => {
                setDrawerOpen(false);
                setSelectedClient(row.client);
              }}
            >
              {row.client.givenName} {row.client.familyName}
            </button>
          </span>
        ),
      },
      {
        key: 'practitioner',
        header: 'Practitioner',
        render: (row) => row.practitioner.displayName,
      },
      { key: 'service', header: 'Service', render: (row) => row.serviceType.name },
      {
        key: 'delivery',
        header: 'Delivery',
        render: (row) => DELIVERY_LABELS[row.deliveryMode],
      },
      {
        key: 'status',
        header: 'Status',
        render: (row) => (
          <span className="schedule__status">
            <StatusChip
              label={APPOINTMENT_STATUS_LABELS[row.status]}
              tone={APPOINTMENT_STATUS_TONES[row.status]}
            />
            {row.movedTo ? (
              <Link
                className="link small"
                to={`/admin/schedule?date=${dayOf(row.movedTo.windowStart)}`}
              >
                Moved to {formatMovedTo(row.movedTo.windowStart)}
              </Link>
            ) : null}
          </span>
        ),
      },
      {
        key: 'actions',
        header: 'Change',
        align: 'end',
        render: (row) => (
          <VisitActionButtons
            row={row}
            canVoid={canVoid}
            confirming={confirming}
            onConfirm={(visit) => void confirm(visit)}
            onOpen={openAction}
          />
        ),
      },
    ],
    [canVoid, confirm, confirming, openAction],
  );

  const calledOff =
    state.kind === 'ready' ? state.appointments.filter((row) => isCalledOff(row.status)).length : 0;
  const shown =
    state.kind === 'ready'
      ? showCalledOff
        ? state.appointments
        : state.appointments.filter((row) => !isCalledOff(row.status))
      : [];
  const count = state.kind === 'ready' ? shown.length : null;

  return (
    <section className="page">
      <PageHeader
        title="Schedule"
        aside={
          count === null ? null : (
            <span className="numeric">
              {count === 1 ? '1 appointment' : `${count} appointments`}
            </span>
          )
        }
        // Secondary, not primary: the drawer's own "Book appointment" submit
        // is the one primary action on screen once it opens (DESIGN.md's
        // "at most one primary button" rule).
        action={
          <Button
            variant="secondary"
            onClick={() => {
              setSelectedClient(null);
              setPastOpen(false);
              setDrawerOpen(true);
            }}
          >
            Add appointment
          </Button>
        }
      />
      <div className="toolbar">
        <div className="schedule__date">
          <DateField id="schedule-date" label="Date" value={date} onChange={setDate} />
        </div>
        {/* Still links — each goes to another screen — and from 2026-09-12 they
            wear the console's one switcher look (app/shell/shell.css), so the
            schedule's other views read like every other page's sections. */}
        <Link className="schedule__week-link" to={`/admin/schedule/week?date=${date}`}>
          See the week
        </Link>
        <Link className="schedule__week-link" to={`/admin/schedule/board?date=${date}`}>
          Open the board
        </Link>
        {/* A plain anchor, not a Link: the map is served as its own document
            with the policy a browser map needs (docs/SPEC/route-planning.md
            section 4.1), and a client-side navigation would carry this
            screen's stricter policy into it. */}
        <a className="schedule__week-link" href={`/admin/schedule/map?date=${date}`}>
          Open the day map
        </a>
        {isPastDay ? (
          <Button
            variant="quiet"
            className="schedule__policy-button"
            onClick={() => {
              setDrawerOpen(false);
              setSelectedClient(null);
              closeAction();
              setPolicyOpen(false);
              setPastOpen(true);
            }}
          >
            Log a past session
          </Button>
        ) : null}
        {canEditPolicy ? (
          <Button
            variant="quiet"
            className="schedule__policy-button"
            onClick={() => {
              setDrawerOpen(false);
              setSelectedClient(null);
              closeAction();
              setPastOpen(false);
              setPolicyOpen(true);
            }}
          >
            Cancellation policy
          </Button>
        ) : null}
        <ShowCalledOff
          id="schedule-show-called-off"
          checked={showCalledOff}
          hidden={calledOff}
          onChange={setShowCalledOff}
        />
      </div>
      {state.kind === 'loading' ? <Note>Loading the day's appointments.</Note> : null}
      {state.kind === 'error' ? <Note tone="critical">{state.message}</Note> : null}
      {actionError ? <Note tone="critical">{actionError}</Note> : null}
      {state.kind === 'ready' ? (
        <Table
          caption="The day's appointments"
          columns={columns}
          rows={shown}
          rowKey={(row) => row.id}
          empty={
            calledOff > 0 && !showCalledOff
              ? 'Every visit on this day has been called off.'
              : 'No appointments are booked for this day.'
          }
        />
      ) : null}
      {drawerOpen ? (
        <NewAppointmentDrawer
          date={date}
          onClose={() => setDrawerOpen(false)}
          onCreated={handleCreated}
        />
      ) : null}
      {selectedClient ? (
        <ScheduleClientDrawer client={selectedClient} onClose={() => setSelectedClient(null)} />
      ) : null}
      {policyOpen ? (
        <CancellationPolicyDrawer onClose={() => setPolicyOpen(false)} onSaved={reload} />
      ) : null}
      {pastOpen ? (
        <LogPastSessionDrawer
          date={date}
          onClose={() => setPastOpen(false)}
          onRecorded={() => {
            setPastOpen(false);
            reload();
          }}
        />
      ) : null}
      <VisitActionDrawers acting={acting} onClose={closeAction} onChanged={reload} />
    </section>
  );
}
