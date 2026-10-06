import { useCallback, useState } from 'react';
import type { AppointmentRow } from '../../api/appointments/schema';
import { isVoidableRow } from '@domain/session';
import { canActor } from '@domain/shared';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button } from '../../shell/components/Controls';
import { CancelAppointmentDrawer } from './CancelAppointmentDrawer';
import { LogPastSessionDrawer, type ReplacedVisit } from './LogPastSessionDrawer';
import { MoveAppointmentDrawer } from './MoveAppointmentDrawer';
import { VoidSessionDrawer } from './VoidSessionDrawer';
import { dayOf, timeOf } from './windows';

/**
 * What can be done to one visit from a schedule screen, in one place: the day
 * and the week offer the same five acts — Confirm, Move and Call off on a
 * visit still open, Correct and Void on one logged from the records — and open
 * the same drawers to do them. Before this module the day held all of it
 * inline and the week offered nothing; a second copy for the week would have
 * been two answers to the same question waiting to disagree.
 */

/**
 * The two statuses a visit can still be moved or called off from: it is
 * either on the calendar unannounced, or agreed with the household. Anything
 * further on — checked in, delivered, missed, already called off, already
 * moved — has happened, and what happened is not undone from a schedule
 * screen (docs/SPEC/scheduling-manual.md section 3). The routes hold the same
 * line, and they are the ones that matter; this only keeps the screen from
 * offering an action that would be refused.
 */
export const OPEN_STATUSES: readonly AppointmentRow['status'][] = ['proposed', 'confirmed'];

export type VisitActionKind = 'move' | 'cancel' | 'void' | 'correct';
export type Acting = { kind: VisitActionKind; row: AppointmentRow } | null;

/**
 * What "Confirm" means, and why it is a button rather than an automatic
 * consequence of booking. `proposed` is "placed on the calendar, client not
 * yet informed" and `confirmed` is "client informed (manual toggle in Phase
 * 1; WhatsApp in Phase 2)" — docs/SPEC/scheduling-manual.md section 3. The
 * telling itself happens on the telephone or on WhatsApp; this records that
 * it happened, and until it is recorded the visit is on nobody's Today
 * (`OWN_STATUS_FILTER`, app/api/appointments/list.ts), which is the whole
 * point of the distinction and was the whole of the defect
 * (docs/CHANGE-REQUESTS/qa-01.md item 1).
 */
const CONFIRM_FAILED =
  'The visit could not be confirmed. Reload the day to see where it stands, then try again.';

const ALREADY_MOVED_ON =
  'This visit is no longer waiting to be confirmed — it has been confirmed, moved or called ' +
  'off already. Reload the day to see where it stands.';

/** The row as the correction drawer pre-fills from it. */
function replacedVisit(row: AppointmentRow & { sessionId: string }): ReplacedVisit {
  return {
    sessionId: row.sessionId,
    client: {
      id: row.client.id,
      givenName: row.client.givenName,
      familyName: row.client.familyName,
    },
    serviceTypeId: row.serviceType.id,
    locationId: row.location.id,
    practitionerId: row.practitioner.id,
    on: dayOf(row.windowStart),
    startTime: timeOf(row.windowStart),
    durationMinutes: row.sessionMinutes,
    billing: row.settledOutsideApp ? 'settled_outside' : 'credit',
  };
}

/**
 * The state behind a schedule screen's visit actions.
 *
 * `beforeOpen` is the screen's own: the day closes its other drawers first,
 * because the schedule has one inline-end slot and two drawers stacked in it
 * would be two dialogs fighting over the same focus.
 */
export function useVisitActions({
  onChanged,
  beforeOpen,
}: {
  /** Called whenever the visits behind should be read again. */
  onChanged: () => void;
  beforeOpen?: () => void;
}) {
  const { apiFetch, session } = useAuth();
  const [acting, setActing] = useState<Acting>(null);
  // The one row being confirmed, so its own button says so and no other row's
  // does; and what to say when it could not be. Neither is a drawer: telling
  // a household is a thing that has already happened by the time somebody
  // reaches for this, so there is nothing to ask them.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Void and Correct: the office's three roles (`session.void`), the same
  // three the route admits.
  const canVoid =
    session.status === 'signed-in' &&
    canActor(session.actor, { type: 'session.void' }, {}, new Date());

  const openAction = useCallback(
    (kind: VisitActionKind, row: AppointmentRow) => {
      beforeOpen?.();
      setActionError(null);
      setActing({ kind, row });
    },
    [beforeOpen],
  );

  const closeAction = useCallback(() => setActing(null), []);

  const confirm = useCallback(
    async (row: AppointmentRow) => {
      setActionError(null);
      setConfirming(row.id);
      try {
        const res = await apiFetch(`/api/appointments/${row.id}/confirm`, {
          method: 'POST',
          // The route reads no body — confirming carries no choices — but the
          // API declines a POST that does not declare itself JSON
          // (`jsonOnly`, app/api/_middleware/security.ts), so an empty object
          // is what is sent rather than nothing at all.
          headers: { 'content-type': 'application/json' },
          body: '{}',
        });
        if (res.ok) {
          onChanged();
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
    [apiFetch, onChanged],
  );

  return { acting, openAction, closeAction, confirm, confirming, actionError, canVoid };
}

/**
 * The buttons for one visit, or nothing when there is nothing left to do to
 * it. The accessible name carries whose visit it is: eight identical "Move"
 * buttons down a column are eight identical buttons to anything that reads
 * them aloud.
 */
export function VisitActionButtons({
  row,
  canVoid,
  confirming,
  onConfirm,
  onOpen,
  className = 'schedule__row-actions',
}: {
  row: AppointmentRow;
  canVoid: boolean;
  confirming: string | null;
  onConfirm: (row: AppointmentRow) => void;
  onOpen: (kind: VisitActionKind, row: AppointmentRow) => void;
  className?: string;
}) {
  const who = `${row.client.givenName} ${row.client.familyName}`;
  if (canVoid && isVoidableRow(row)) {
    return (
      <span className={className}>
        <Button
          variant="quiet"
          aria-label={`Correct ${who}'s visit`}
          onClick={() => onOpen('correct', row)}
        >
          Correct
        </Button>
        <Button
          variant="quiet"
          aria-label={`Void ${who}'s visit`}
          onClick={() => onOpen('void', row)}
        >
          Void
        </Button>
      </span>
    );
  }
  if (!OPEN_STATUSES.includes(row.status)) return null;
  return (
    <span className={className}>
      {row.status === 'proposed' ? (
        <Button
          variant="quiet"
          disabled={confirming !== null}
          aria-label={`Confirm ${who}'s appointment`}
          onClick={() => onConfirm(row)}
        >
          {confirming === row.id ? 'Confirming…' : 'Confirm'}
        </Button>
      ) : null}
      <Button
        variant="quiet"
        aria-label={`Move ${who}'s appointment`}
        onClick={() => onOpen('move', row)}
      >
        Move
      </Button>
      <Button
        variant="quiet"
        aria-label={`Call off ${who}'s appointment`}
        onClick={() => onOpen('cancel', row)}
      >
        Call off
      </Button>
    </span>
  );
}

/** The drawer for whichever act is under way, or nothing. */
export function VisitActionDrawers({
  acting,
  onClose,
  onChanged,
}: {
  acting: Acting;
  onClose: () => void;
  onChanged: () => void;
}) {
  if (acting === null) return null;
  const done = () => {
    onClose();
    onChanged();
  };
  if (acting.kind === 'move') {
    return <MoveAppointmentDrawer appointment={acting.row} onClose={onClose} onMoved={done} />;
  }
  if (acting.kind === 'void') {
    return <VoidSessionDrawer appointment={acting.row} onClose={onClose} onVoided={done} />;
  }
  if (acting.kind === 'correct') {
    if (!isVoidableRow(acting.row)) return null;
    return (
      <LogPastSessionDrawer
        // One drawer per visit: a correction opened from another row starts
        // from that row, not from what was typed into this one.
        key={acting.row.id}
        date={dayOf(acting.row.windowStart)}
        replaces={replacedVisit(acting.row)}
        onClose={onClose}
        onRecorded={done}
      />
    );
  }
  // The call-off drawer stays open once it is done: it has the fee to report
  // and, where one was charged, the waiver to offer.
  return (
    <CancelAppointmentDrawer appointment={acting.row} onClose={onClose} onCancelled={onChanged} />
  );
}

/**
 * The switch that brings called-off visits back onto the list. Off by default
 * and remembered nowhere: it is a way of reading the screen, not a setting,
 * and the next visit opens on the visits still happening. The count says how
 * many are folded away, so a day that looks empty is never mistaken for one
 * nothing was ever booked on.
 */
export function ShowCalledOff({
  id,
  checked,
  hidden,
  onChange,
}: {
  id: string;
  checked: boolean;
  /** How many called-off visits the list holds, shown or not. */
  hidden: number;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="checkbox schedule__called-off">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        Show called-off visits{hidden > 0 ? <span className="numeric"> ({hidden})</span> : null}
      </span>
    </label>
  );
}
