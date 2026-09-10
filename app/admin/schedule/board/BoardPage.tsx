import { useEffect, useState, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router';
import { z } from 'zod';
import type { BoardState } from '@domain/scheduling';
import {
  BoardResponse,
  type BoardPractitioner,
  type BoardVisit,
} from '../../../api/appointments/schema';
import { useAuth } from '../../../shell/auth/AuthContext';
import { Note, PageHeader } from '../../../shell/components/Controls';
import { StatusChip, type StatusTone } from '../../../shell/components/StatusChip';
import { formatDay, formatWindow, practiceDay } from '../windows';
import { ReassignDrawer } from './ReassignDrawer';
import { blockOf, daySpan, gridColumns, hourLabels } from './columns';
import './board.css';

/**
 * The dispatcher's board (docs/SPEC/dispatch.md section 4): practitioners
 * down the inline start, the day across in fifteen-minute columns, every
 * visit a block in its state. An idle practitioner still has a row, because a
 * board that hides the person with nothing on is no use for handing them
 * something.
 *
 * **Read, never typed.** Every state comes from the route, which read it from
 * what the practice already records — a status, a check-in, a closed session,
 * and the lateness rule. Nothing on this screen sets a state.
 *
 * **A drag opens the drawer; it never commits on drop** (6.4). A reassignment
 * asks for a reason and a drop cannot type one, so the drop prefills the
 * drawer with the row it landed on and the dispatcher finishes it there. The
 * drawer is also the accessible path: the same block is a button.
 *
 * The address carries a date and nothing else — no client, no practitioner,
 * no appointment (.claude/rules/ui.md: no personal data in a path or a query).
 */

/** The nine states 4.4 names, in the dispatcher's own words. */
const STATE_LABELS: Record<BoardState, string> = {
  waiting: 'Waiting',
  agreed: 'Agreed',
  on_the_way: 'On the way',
  at_the_door: 'At the door',
  running_late: 'Running late',
  finished: 'Finished',
  missed: 'Missed',
  called_off: 'Called off',
  moved: 'Moved',
};

/**
 * Hue is the practice's three status tones and nothing else (4.4): attention
 * is kept for the one state that asks the dispatcher to act now, and critical
 * for the one that has already cost the practice a visit. A day going to plan
 * carries no colour at all.
 */
const STATE_TONES: Record<BoardState, StatusTone> = {
  waiting: 'neutral',
  agreed: 'neutral',
  on_the_way: 'ok',
  at_the_door: 'ok',
  running_late: 'attention',
  finished: 'ok',
  missed: 'critical',
  called_off: 'neutral',
  moved: 'neutral',
};

/**
 * A deployment with no routing seam cannot price the drives, so no visit can
 * be called late. The states still read from the facts; only this one is
 * absent, and the board says so rather than showing a whole day as
 * comfortably on time.
 */
const NO_LATENESS =
  'Running late cannot be worked out on this deployment: no drive estimates are configured.';

const LOAD_ERROR = 'The board could not be loaded. Try again.';

/**
 * The day the address asks for, or the practice's own today when it asks for
 * something that is not a day.
 *
 * The address is not trusted. `?date=x` and `?date=2026-13-45` both reach
 * `formatDay`, whose `Intl.DateTimeFormat.format` throws a `RangeError` on an
 * Invalid Date and takes the whole screen down; the board route answers 400
 * to the same values. The same `z.iso.date()` the route validates with, so
 * the screen and the route agree on what a day is.
 */
const Day = z.iso.date();

function dayAsked(params: URLSearchParams, now: Date): string {
  const asked = params.get('date');
  return asked !== null && Day.safeParse(asked).success ? asked : practiceDay(now);
}

/**
 * Which day the answer in hand describes, carried on the answer itself.
 *
 * Setting "loading" from inside the effect that starts the request is a
 * cascading render, and the answer is to derive it rather than to write it
 * (`WeekPage` records the same reasoning, and `react-hooks/set-state-in-effect`
 * refuses the other shape). So the render compares the day the state is for
 * with the day being asked for, and anything else is a request still in
 * flight.
 */
type State =
  | { kind: 'loading' }
  | { kind: 'ready'; date: string; board: BoardResponse }
  | { kind: 'error'; date: string };

/**
 * The four states in which a visit has not yet been reached, and so is still
 * something to hand on.
 *
 * Read off the state the block itself shows rather than re-derived from the
 * status beside it. The route's gate is "proposed or confirmed, with no
 * session open", and `boardState` has already folded the open session in: a
 * `confirmed` visit whose practitioner is at the door reads `at_the_door`
 * here. Testing the status again would offer a grab handle on a block
 * labelled "At the door" and let the route refuse it with `session_open` —
 * a second copy of a rule that has already been decided (CLAUDE.md rule 4).
 */
const MOVABLE_STATES: readonly BoardState[] = ['waiting', 'agreed', 'on_the_way', 'running_late'];

function movable(visit: BoardVisit): boolean {
  return MOVABLE_STATES.includes(visit.state);
}

/**
 * The state a block says, with the minutes when there are any. Keyed on the
 * state the route decided and never on `byMinutes > 0`: the rule allows a
 * grace period, so a visit can be a few minutes behind and not be late.
 */
function stateLabel(visit: BoardVisit): string {
  if (visit.state === 'running_late' && visit.lateness) {
    return `${STATE_LABELS.running_late}, ${visit.lateness.byMinutes} min`;
  }
  return STATE_LABELS[visit.state];
}

export function BoardPage() {
  const { apiFetch } = useAuth();
  const [params] = useSearchParams();
  const date = dayAsked(params, new Date());
  const [state, setState] = useState<State>({ kind: 'loading' });
  /** Bumped to read the day again after a reassignment has changed it. */
  const [reads, setReads] = useState(0);
  const [drawer, setDrawer] = useState<{
    visit: BoardVisit;
    from: BoardPractitioner;
    to: string | null;
  } | null>(null);

  useEffect(() => {
    let live = true;
    void apiFetch(`/api/appointments/board?date=${date}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('unavailable');
        return BoardResponse.parse(await res.json());
      })
      .then((board) => {
        if (live) setState({ kind: 'ready', date, board });
      })
      .catch(() => {
        if (live) setState({ kind: 'error', date });
      });
    return () => {
      live = false;
    };
  }, [apiFetch, date, reads]);

  // The answer in hand is only this day's if it was asked for this day.
  const settled = state.kind !== 'loading' && state.date === date ? state : null;
  const board = settled?.kind === 'ready' ? settled.board : null;
  const span = daySpan(
    date,
    board ? board.practitioners.flatMap((p) => p.visits.map(blockOf)) : [],
  );

  /** Open the drawer for a block dropped on another practitioner's row. */
  function pickUp(appointmentId: string, onto: BoardPractitioner) {
    if (!board) return;
    for (const practitioner of board.practitioners) {
      for (const visit of practitioner.visits) {
        if (visit.appointmentId !== appointmentId) continue;
        if (practitioner.practitionerId === onto.practitionerId) return;
        setDrawer({ visit, from: practitioner, to: onto.practitionerId });
        return;
      }
    }
  }

  return (
    <section className="page">
      <PageHeader
        title="Board"
        aside={<span className="numeric">{formatDay(date)}</span>}
        action={
          <Link className="button button--secondary" to={`/admin/schedule?date=${date}`}>
            Back to the day
          </Link>
        }
      />
      {settled === null ? <Note>Loading the board.</Note> : null}
      {settled?.kind === 'error' ? <Note tone="critical">{LOAD_ERROR}</Note> : null}
      {board && !board.latenessAvailable ? <Note>{NO_LATENESS}</Note> : null}
      {board ? (
        <div className="board" style={{ '--board-columns': span.columns } as CSSProperties}>
          {/* The axis is decoration for a reader who can see it; every block
              carries its own window in its accessible name, so a screen
              reader loses nothing by skipping this. */}
          <div className="board__hours" aria-hidden="true">
            {hourLabels(span).map((hour) => (
              <span
                key={hour.column}
                className="board__hour numeric"
                style={{ gridColumn: `${hour.column} / span 4` }}
              >
                {hour.label}
              </span>
            ))}
          </div>
          {board.practitioners.map((practitioner) => (
            <section
              key={practitioner.practitionerId}
              className="board__row"
              aria-label={practitioner.displayName}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                pickUp(event.dataTransfer.getData('text/plain'), practitioner);
              }}
            >
              <h2 className="board__name">{practitioner.displayName}</h2>
              <div className="board__lane">
                {practitioner.visits.length === 0 ? (
                  <span className="board__idle small muted">Nothing on</span>
                ) : null}
                {practitioner.visits.map((visit) => {
                  const columns = gridColumns(span, blockOf(visit));
                  const facts = (
                    <>
                      <span className="board__window numeric">
                        {formatWindow(visit.windowStart, visit.windowEnd)}
                      </span>
                      <span className="board__client">
                        {visit.client.givenName} {visit.client.familyName}
                      </span>
                      <span className="board__facts small muted">
                        {visit.serviceType.name}, {visit.emirate}
                      </span>
                      <StatusChip label={stateLabel(visit)} tone={STATE_TONES[visit.state]} />
                    </>
                  );
                  const className = `board__block board__block--${visit.state}`;
                  const style = {
                    '--block-start': columns.start,
                    '--block-end': columns.end,
                  } as CSSProperties;
                  // A visit that has been checked in, delivered, missed, called
                  // off or already moved cannot change hands, and a control
                  // that does nothing when pressed is worse than no control:
                  // it is a settled fact on the board, not a thing to take
                  // hold of. Only a live visit is a button, and only a button
                  // can be dragged.
                  return movable(visit) ? (
                    <button
                      key={visit.appointmentId}
                      type="button"
                      className={className}
                      style={style}
                      draggable
                      onDragStart={(event) =>
                        event.dataTransfer.setData('text/plain', visit.appointmentId)
                      }
                      onClick={() => setDrawer({ visit, from: practitioner, to: null })}
                      aria-label={`${visit.client.givenName} ${visit.client.familyName}, ${formatWindow(visit.windowStart, visit.windowEnd)}, ${stateLabel(visit)}`}
                    >
                      {facts}
                    </button>
                  ) : (
                    <div key={visit.appointmentId} className={className} style={style}>
                      {facts}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ) : null}
      {drawer && board ? (
        /*
         * Keyed on the visit, so re-targeting the drawer at another block
         * starts a fresh one. Without it `to` and `reason` are initialised
         * once and survive the change of props: a reason typed for one
         * household's visit would be posted as the audited record of why a
         * different one changed hands (spec 11).
         */
        <ReassignDrawer
          key={drawer.visit.appointmentId}
          visit={drawer.visit}
          from={drawer.from}
          initialTo={drawer.to}
          practitioners={board.practitioners.filter(
            (p) => p.practitionerId !== drawer.from.practitionerId,
          )}
          onClose={() => setDrawer(null)}
          onDone={() => {
            setDrawer(null);
            setReads((read) => read + 1);
          }}
        />
      ) : null}
    </section>
  );
}
