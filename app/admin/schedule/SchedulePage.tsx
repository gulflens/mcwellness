import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  AppointmentListResponse,
  type AppointmentRow,
  type DeliveryMode,
} from '../../api/appointments/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note, PageHeader } from '../../shell/components/Controls';
import { StatusChip } from '../../shell/components/StatusChip';
import { Table, type Column } from '../../shell/components/Table';
import { APPOINTMENT_STATUS_LABELS, APPOINTMENT_STATUS_TONES } from './appointmentStatus';
import { CancelAppointmentDrawer } from './CancelAppointmentDrawer';
import { MoveAppointmentDrawer } from './MoveAppointmentDrawer';
import { NewAppointmentDrawer } from './NewAppointmentDrawer';
import { ScheduleClientDrawer } from './ScheduleClientDrawer';
import { formatWindow, practiceDay } from './windows';
import './schedule.css';

/**
 * The admin console's day schedule (docs/SPEC/scheduling-manual.md section
 * 4.1, cut to a table for this pull request — the week calendar and the day
 * map are later work). One tenant-local calendar day, across every
 * practitioner, with an "Add appointment" door onto `POST /api/appointments`.
 */

/**
 * The two statuses a visit can still be moved or called off from: it is
 * either on the calendar unannounced, or agreed with the household. Anything
 * further on — checked in, delivered, missed, already called off, already
 * moved — has happened, and what happened is not undone from this screen
 * (docs/SPEC/scheduling-manual.md section 3). The routes hold the same line,
 * and they are the ones that matter; this only keeps the screen from
 * offering an action that would be refused.
 */
const OPEN_STATUSES: readonly AppointmentRow['status'][] = ['proposed', 'confirmed'];

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
  const { apiFetch } = useAuth();
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
  // One drawer at a time: the schedule has one inline-end slot, and two
  // drawers stacked in it would be two dialogs fighting over the same focus.
  const [acting, setActing] = useState<{ kind: 'move' | 'cancel'; row: AppointmentRow } | null>(
    null,
  );

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

  const openAction = useCallback((kind: 'move' | 'cancel', row: AppointmentRow) => {
    setDrawerOpen(false);
    setSelectedClient(null);
    setActing({ kind, row });
  }, []);

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
        // The same cell pattern the clients table uses for a name (ClientsPage.tsx):
        // a link that opens the record, the Arabic name beneath it.
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
            {row.client.givenNameAr ? (
              <span className="name__ar small muted" lang="ar" dir="rtl">
                {row.client.givenNameAr} {row.client.familyNameAr}
              </span>
            ) : null}
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
          <StatusChip
            label={APPOINTMENT_STATUS_LABELS[row.status]}
            tone={APPOINTMENT_STATUS_TONES[row.status]}
          />
        ),
      },
      {
        key: 'actions',
        header: 'Change',
        align: 'end',
        render: (row) =>
          OPEN_STATUSES.includes(row.status) ? (
            <span className="schedule__row-actions">
              {/* The accessible name carries whose visit it is: eight
                  identical "Move" buttons down a column are eight identical
                  buttons to anything that reads them aloud. */}
              <Button
                variant="quiet"
                aria-label={`Move ${row.client.givenName} ${row.client.familyName}'s appointment`}
                onClick={() => openAction('move', row)}
              >
                Move
              </Button>
              <Button
                variant="quiet"
                aria-label={`Call off ${row.client.givenName} ${row.client.familyName}'s appointment`}
                onClick={() => openAction('cancel', row)}
              >
                Call off
              </Button>
            </span>
          ) : null,
      },
    ],
    [openAction],
  );

  const count = state.kind === 'ready' ? state.appointments.length : null;

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
              setDrawerOpen(true);
            }}
          >
            Add appointment
          </Button>
        }
      />
      <div className="toolbar">
        <Field
          id="schedule-date"
          className="schedule__date"
          label="Date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <Link className="link schedule__week-link" to={`/admin/schedule/week?date=${date}`}>
          See the week
        </Link>
      </div>
      {state.kind === 'loading' ? <Note>Loading the day's appointments.</Note> : null}
      {state.kind === 'error' ? <Note tone="critical">{state.message}</Note> : null}
      {state.kind === 'ready' ? (
        <Table
          caption="The day's appointments"
          columns={columns}
          rows={state.appointments}
          rowKey={(row) => row.id}
          empty="No appointments are booked for this day."
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
    </section>
  );
}
