import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  AppointmentListResponse,
  type AppointmentRow,
  type DeliveryMode,
} from '../../api/appointments/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note, PageHeader } from '../../shell/components/Controls';
import { StatusChip } from '../../shell/components/StatusChip';
import { APPOINTMENT_STATUS_LABELS, APPOINTMENT_STATUS_TONES } from './appointmentStatus';
import { addDays, formatDay, formatWindow, practiceDay, PRACTICE_UTC_OFFSET } from './windows';
import './schedule.css';

/**
 * The week, read only (docs/SPEC/scheduling-manual.md sections 4.1 and 5.2).
 *
 * Seven days across, every practitioner in each, carrying the same facts the
 * day view's rows carry: the window, who, with whom, which service, where,
 * and where it stands. Nothing here books, moves or calls anything off — a
 * week is for seeing the shape of it, and every change is made on the day
 * itself, where the coordinator can see what else that day already holds.
 * Section 4.1's dragging is not this screen either: it belongs to the real
 * calendar grid, and a drag with no conflict feedback beside it would be a
 * worse thing to ship than no drag at all.
 *
 * **Seven requests, one per day.** `GET /api/appointments` answers one
 * tenant-local calendar day (its own docstring, and the audit trail writes a
 * row per stop read either way). Widening it to a range is a change to the
 * shape of that route and to what a read means in the trail, so this asks it
 * seven times instead and says so out loud rather than quietly.
 */

const DELIVERY_LABELS: Record<DeliveryMode, string> = {
  home: 'Home',
  studio: 'Studio',
  remote: 'Remote',
};

const LOAD_ERROR = 'The week could not be loaded. Try again.';

type Day = { date: string; appointments: readonly AppointmentRow[] };

/**
 * Which week the state in hand describes, carried on the state itself.
 *
 * Moving to the next week does not clear this first: setting state from
 * inside an effect body is a cascading render, and the answer is to derive
 * "still loading" rather than to write it. So the render compares the week
 * the state is for with the week being asked for, and anything else is the
 * previous week's answer waiting to be replaced.
 */
type State =
  | { kind: 'loading' }
  | { kind: 'error'; anchor: string }
  | { kind: 'ready'; anchor: string; days: readonly Day[] };

/**
 * The week `date` falls in, Monday first.
 *
 * The weekday is read from midday in the practice's own zone rather than from
 * midnight: an instant at midnight Dubai is the previous evening in UTC, and
 * `getUTCDay` on it would name the day before. Midday is the same calendar
 * day in both, so no such correction is needed and none is written.
 */
function weekOf(date: string): string[] {
  const weekday = new Date(`${date}T12:00:00${PRACTICE_UTC_OFFSET}`).getUTCDay(); // 0 Sunday … 6 Saturday
  const monday = addDays(date, -((weekday + 6) % 7));
  return Array.from({ length: 7 }, (_unused, index) => addDays(monday, index));
}

export function WeekPage() {
  const { apiFetch } = useAuth();
  const [params, setParams] = useSearchParams();
  const anchor = params.get('date') ?? practiceDay(new Date());
  const days = useMemo(() => weekOf(anchor), [anchor]);
  // Read once per render rather than frozen at mount, so a week left open
  // overnight marks the right column in the morning.
  const today = practiceDay(new Date());
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let live = true;
    void Promise.all(
      days.map(async (date) => {
        const res = await apiFetch(`/api/appointments?date=${date}`);
        if (!res.ok) throw new Error('unavailable');
        const parsed = AppointmentListResponse.parse(await res.json());
        return { date, appointments: parsed.appointments };
      }),
    )
      .then((loaded) => {
        if (live) setState({ kind: 'ready', anchor, days: loaded });
      })
      .catch(() => {
        if (live) setState({ kind: 'error', anchor });
      });
    return () => {
      live = false;
    };
  }, [anchor, apiFetch, days]);

  // The answer in hand is only this week's answer if it was asked for this
  // week; otherwise the request for this one is still in flight.
  const settled = state.kind !== 'loading' && state.anchor === anchor ? state : null;
  const total =
    settled?.kind === 'ready'
      ? settled.days.reduce((count, day) => count + day.appointments.length, 0)
      : null;

  function shift(offset: number) {
    setParams({ date: addDays(anchor, offset) });
  }

  return (
    <section className="page">
      <PageHeader
        title="Week"
        aside={
          total === null ? null : (
            <span className="numeric">
              {total === 1 ? '1 appointment' : `${total} appointments`}
            </span>
          )
        }
        action={
          <Link className="button button--secondary" to={`/admin/schedule?date=${anchor}`}>
            Back to the day
          </Link>
        }
      />
      <div className="toolbar">
        <Button variant="quiet" onClick={() => shift(-7)}>
          Previous week
        </Button>
        <span className="small muted numeric">
          {formatDay(days[0] ?? anchor)} – {formatDay(days[6] ?? anchor)}
        </span>
        <Button variant="quiet" onClick={() => shift(7)}>
          Next week
        </Button>
      </div>

      {settled === null ? <Note>Loading the week.</Note> : null}
      {settled?.kind === 'error' ? <Note tone="critical">{LOAD_ERROR}</Note> : null}
      {settled?.kind === 'ready' ? (
        <div className="week">
          {settled.days.map((day) => (
            <section
              key={day.date}
              className={`week__day${day.date === today ? ' week__day--today' : ''}`}
              aria-label={formatDay(day.date)}
              // Announced as well as drawn: a week is read to find where one is
              // in it, and the mark that says so should not be visual only
              // (design review of this pull request).
              aria-current={day.date === today ? 'date' : undefined}
            >
              <h2 className="week__heading small">
                <Link className="link" to={`/admin/schedule?date=${day.date}`}>
                  {formatDay(day.date)}
                </Link>
              </h2>
              {day.appointments.length === 0 ? (
                <p className="week__empty small muted">Nothing booked.</p>
              ) : (
                <ol className="week__stops">
                  {day.appointments.map((row) => (
                    <li key={row.id} className="week__stop">
                      <span className="week__window numeric">
                        {formatWindow(row.windowStart, row.windowEnd)}
                      </span>
                      <span className="week__name">
                        {row.client.givenName} {row.client.familyName}
                      </span>
                      {/* The Arabic name beneath the Latin one, exactly as the
                          day view and the clients table render it. A week that
                          dropped it would be the one screen in the console
                          where a household written in Arabic is not
                          (docs/DESIGN-BRIEF.md, and the compliance review of
                          this pull request). */}
                      {row.client.givenNameAr ? (
                        <span className="small muted" lang="ar" dir="rtl">
                          {row.client.givenNameAr} {row.client.familyNameAr}
                        </span>
                      ) : null}
                      {/* Stood down rather than dropped when the columns get
                          narrow: seven days side by side is the thing this
                          screen is for, and these two facts are a click away on
                          the day itself (schedule.css, .week__aside). */}
                      <span className="week__aside small muted">
                        {row.practitioner.displayName}
                      </span>
                      <span className="week__aside small muted">
                        {row.serviceType.name}, {DELIVERY_LABELS[row.deliveryMode]}
                      </span>
                      <StatusChip
                        label={APPOINTMENT_STATUS_LABELS[row.status]}
                        tone={APPOINTMENT_STATUS_TONES[row.status]}
                      />
                    </li>
                  ))}
                </ol>
              )}
            </section>
          ))}
        </div>
      ) : null}
    </section>
  );
}
