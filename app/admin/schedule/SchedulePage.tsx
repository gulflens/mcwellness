import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AppointmentListResponse,
  type AppointmentRow,
  type DeliveryMode,
} from '../../api/appointments/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note, PageHeader } from '../../shell/components/Controls';
import { Table, type Column } from '../../shell/components/Table';
import { AppointmentStatusChip } from './AppointmentStatusChip';
import { NewAppointmentDrawer } from './NewAppointmentDrawer';
import './schedule.css';

/**
 * The admin console's day schedule (docs/SPEC/scheduling-manual.md section
 * 4.1, cut to a table for this pull request — the week calendar and the day
 * map are later work). One tenant-local calendar day, across every
 * practitioner, with an "Add appointment" door onto `POST /api/appointments`.
 */

const PRACTICE_TIME_ZONE = 'Asia/Dubai';

const DELIVERY_LABELS: Record<DeliveryMode, string> = {
  home: 'Home',
  studio: 'Studio',
  remote: 'Remote',
};

const TIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: PRACTICE_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function todayInDubai(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: PRACTICE_TIME_ZONE }).format(now);
}

function formatWindow(windowStart: string, windowEnd: string): string {
  return `${TIME_FORMAT.format(new Date(windowStart))}–${TIME_FORMAT.format(new Date(windowEnd))}`;
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; appointments: readonly AppointmentRow[] };

export function SchedulePage() {
  const { apiFetch } = useAuth();
  const [date, setDate] = useState(() => todayInDubai(new Date()));
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

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
        // The Arabic name is not on this row yet: AppointmentRow.client
        // carries only givenName/familyName, unlike the client table's own
        // ClientRow. Left for the appointment route to add.
        render: (row) => (
          <span>
            {row.client.givenName} {row.client.familyName}
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
        render: (row) => <AppointmentStatusChip status={row.status} />,
      },
    ],
    [],
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
      />
      <div className="toolbar">
        <Field
          id="schedule-date"
          className="field--search"
          label="Date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <Button
          variant="primary"
          className="schedule__toolbar-end"
          onClick={() => setDrawerOpen(true)}
        >
          Add appointment
        </Button>
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
    </section>
  );
}
