import { useEffect, useRef, useState } from 'react';
import type { AppointmentRow } from '../../../api/appointments/schema';
import { OptimiseDayResponse, type PlannedStopRow } from '../../../api/routing/schema';
import { useAuth } from '../../../shell/auth/AuthContext';
import { Button, Field, Note } from '../../../shell/components/Controls';
import { CloseIcon } from '../../../shell/components/Icons';
import { Table, type Column } from '../../../shell/components/Table';
import { useDrawer } from '../../../shell/components/useDrawer';
import { formatWindow } from '../windows';

/**
 * The optimised day, before anything changes (docs/SPEC/route-planning.md
 * sections 5.1 and 5.2): what the day drives now, what it would drive, what
 * that saves, where the figures came from, and the new order visit by visit.
 *
 * **Nothing is applied until Apply.** The plan is computed by
 * `POST /api/routing/practice-day/optimise`, which writes only the estimate
 * cache; applying it is `POST /api/appointments/reorder`, which runs each
 * move through the move rule inside one transaction and asks for a reason.
 *
 * **Only the moved visits are sent.** An anchor keeps its window by
 * definition, and a movable visit the plan left where it was has nothing to
 * move; sending either would retire a row and insert an identical one, which
 * is a household's promise rewritten for nothing.
 *
 * Never a modal (DESIGN.md "The Beside Rule"): fixed to the inline end, over
 * the map, no scrim.
 */

const REFUSALS: Record<string, string> = {
  nothing_to_move: 'Every visit today has been agreed with its household, or is already under way.',
  no_improvement: 'This order already drives least.',
  infeasible: 'The day cannot be improved around the confirmed visits.',
  too_many_stops: 'More than eight stops in a day is not optimised.',
};

const SOURCES: Record<string, string> = {
  traffic: 'Estimates from traffic.',
  'straight-line': 'Straight-line estimates.',
  mixed: 'Some estimates from traffic, some straight-line.',
};

const PLAN_FAILED = 'The plan could not be worked out. Close this and try again.';
const STALE = 'The day changed while you were looking. Reload the day.';
const APPLY_FAILED = 'The new order could not be applied. Reload the day and try again.';
const FORBIDDEN = 'Only the owner, an admin or a lead practitioner can change the day.';
const DEFAULT_REASON = 'Day optimised on the map';

/**
 * A span of driving, as a person says it: "1 h 45 min", or "12 min" under the
 * hour. Never a decimal and never seconds — this is an estimate of a drive,
 * and a figure to the second would claim a precision no estimate has.
 */
export function formatDriveSpan(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest === 0 ? `${minutes / 60} h` : `${Math.floor(minutes / 60)} h ${rest} min`;
}

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'answered'; plan: OptimiseDayResponse };

type PlanRow = { stop: PlannedStopRow; appointment: AppointmentRow | undefined };

export function OptimiseDrawer({
  date,
  practitionerId,
  stops,
  onClose,
  onApplied,
}: {
  date: string;
  practitionerId: string;
  /** The panel's own rows, so the drawer can name each visit. */
  stops: readonly AppointmentRow[];
  onClose: () => void;
  onApplied: (message: string) => void;
}) {
  const { apiFetch } = useAuth();
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useDrawer(drawerRef, closeRef, onClose);

  const [state, setState] = useState<State>({ kind: 'loading' });
  const [reason, setReason] = useState(DEFAULT_REASON);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void apiFetch('/api/routing/practice-day/optimise', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ date, practitionerId }),
    })
      .then(async (res) => {
        if (!live) return;
        if (!res.ok) {
          setState({ kind: 'error', message: res.status === 403 ? FORBIDDEN : PLAN_FAILED });
          return;
        }
        setState({ kind: 'answered', plan: OptimiseDayResponse.parse(await res.json()) });
      })
      .catch(() => {
        if (live) setState({ kind: 'error', message: PLAN_FAILED });
      });
    return () => {
      live = false;
    };
  }, [apiFetch, date, practitionerId]);

  const answered = state.kind === 'answered' ? state.plan : null;
  const plan = answered?.kind === 'plan' ? answered : null;
  const byId = new Map(stops.map((row) => [row.id, row]));
  const rows: PlanRow[] =
    plan === null
      ? []
      : plan.stops.map((stop) => ({ stop, appointment: byId.get(stop.appointmentId) }));
  const moved = plan === null ? [] : plan.stops.filter((stop) => stop.moved && !stop.anchor);

  const columns: Column<PlanRow>[] = [
    {
      key: 'stop',
      header: 'Stop',
      render: ({ appointment }) =>
        appointment === undefined
          ? 'A visit'
          : `${appointment.client.givenName} ${appointment.client.familyName}`,
    },
    {
      key: 'now',
      header: 'Now',
      numeric: true,
      render: ({ appointment }) =>
        appointment === undefined
          ? '– –'
          : formatWindow(appointment.windowStart, appointment.windowEnd),
    },
    {
      key: 'after',
      header: 'After',
      numeric: true,
      render: ({ stop }) => formatWindow(stop.windowStart, stop.windowEnd),
    },
    {
      key: 'change',
      header: 'Change',
      render: ({ stop, appointment }) =>
        stop.anchor
          ? appointment?.status === 'confirmed'
            ? 'kept (confirmed)'
            : 'kept (already begun)'
          : stop.moved
            ? 'moved'
            : 'kept',
    },
  ];

  async function apply() {
    if (plan === null || reason.trim() === '') return;
    setApplying(true);
    setApplyError(null);
    try {
      const res = await apiFetch('/api/appointments/reorder', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // The trail's own record of why several promises changed at once
          // (docs/SPEC/scheduling-manual.md section 9).
          'x-reason': reason.trim(),
        },
        body: JSON.stringify({
          date,
          practitionerId,
          moves: moved.map((stop) => ({
            appointmentId: stop.appointmentId,
            windowStart: stop.windowStart,
            wasWindowStart: stop.wasWindowStart,
            travelBufferMinutes: stop.travelBufferMinutes,
          })),
        }),
      });
      if (res.ok) {
        const message =
          moved.length === 1
            ? '1 visit moved. The households have not been told.'
            : `${moved.length} visits moved. The households have not been told.`;
        setDone(message);
        onApplied(message);
        return;
      }
      const body = (await res.json().catch(() => null)) as { code?: string } | null;
      setApplyError(
        res.status === 403 ? FORBIDDEN : body?.code === 'stale_plan' ? STALE : APPLY_FAILED,
      );
    } catch {
      setApplyError(APPLY_FAILED);
    } finally {
      setApplying(false);
    }
  }

  return (
    <aside className="drawer" role="dialog" aria-labelledby="optimise-title" ref={drawerRef}>
      <header className="drawer__header">
        <div className="drawer__title">
          <h2 id="optimise-title">Optimise the day</h2>
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
          {state.kind === 'loading' ? <Note>Working out the order that drives least.</Note> : null}
          {state.kind === 'error' ? <Note tone="critical">{state.message}</Note> : null}
          {answered?.kind === 'refusal' ? (
            <Note>{REFUSALS[answered.reason] ?? PLAN_FAILED}</Note>
          ) : null}
          {plan === null ? null : (
            <>
              <div className="stepper__step">
                <dl className="optimise__figures">
                  <div>
                    <dt className="field__label">Now</dt>
                    <dd className="numeric">{formatDriveSpan(plan.before.driveSeconds)}</dd>
                  </div>
                  <div>
                    <dt className="field__label">After</dt>
                    <dd className="numeric">{formatDriveSpan(plan.after.driveSeconds)}</dd>
                  </div>
                </dl>
                <p className="stepper__chosen">
                  Saves about {formatDriveSpan(plan.savedSeconds)} of driving.
                </p>
                <p className="small muted">{SOURCES[plan.source] ?? SOURCES.mixed}</p>
              </div>

              <div className="stepper__step">
                <Table
                  caption="The new order"
                  columns={columns}
                  rows={rows}
                  rowKey={({ stop }) => stop.appointmentId}
                />
              </div>

              {done === null ? (
                <>
                  <div className="stepper__step">
                    <Field
                      id="optimise-reason"
                      label="Why is the day changing?"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </div>
                  {applyError ? <Note tone="critical">{applyError}</Note> : null}
                  <div className="stepper__submit">
                    <Button
                      disabled={applying || reason.trim() === '' || moved.length === 0}
                      onClick={() => void apply()}
                    >
                      {applying ? 'Applying…' : 'Apply the new order'}
                    </Button>
                  </div>
                </>
              ) : (
                <Note>{done}</Note>
              )}
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
