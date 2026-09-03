import { useEffect, useRef, useState } from 'react';
import {
  ConflictResponse,
  MoveAppointmentResponse,
  type AppointmentActionCode,
  type AppointmentRow,
} from '../../api/appointments/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note } from '../../shell/components/Controls';
import { CloseIcon } from '../../shell/components/Icons';
import { localConflictMessage } from './conflictMessages';
import {
  composeWindowStart,
  dayOf,
  formatDay,
  formatWindow,
  timeOf,
  windowEndForTime,
} from './windows';

/**
 * Moving one visit to a new arrival window
 * (docs/SPEC/scheduling-manual.md sections 2 and 3).
 *
 * Two facts the drawer keeps in front of the coordinator, because both are
 * easy to forget while typing a time. The first is what the household was
 * already promised, shown above the fields rather than replaced by them. The
 * second is that moving a visit does not tell anyone: `confirmed` means the
 * client was informed (section 3), a moved visit keeps that status, and
 * informing them again is the same manual step it always was.
 *
 * Never a modal (DESIGN.md "The Beside Rule"): fixed to the inline end, over
 * the ledger, no scrim.
 */

const NOT_FOUND =
  'This appointment is no longer there. Close this and reload the day to see what changed.';

const ACTION_MESSAGES: Record<AppointmentActionCode, string> = {
  invalid_request: 'Check the date and the time, then try again.',
  appointment_not_found: NOT_FOUND,
  appointment_settled:
    'This visit has already been checked in, delivered, called off or moved, so it cannot be ' +
    'moved now. Reload the day to see where it stands.',
  reason_required: 'Say why this visit is moving before moving it.',
};

type Issue = { code: string; message: string };

type SubmitError =
  | { kind: 'forbidden' }
  | { kind: 'issues'; issues: readonly Issue[] }
  | { kind: 'generic'; message: string };

export function MoveAppointmentDrawer({
  appointment,
  onClose,
  onMoved,
}: {
  appointment: AppointmentRow;
  onClose: () => void;
  onMoved: (moved: MoveAppointmentResponse) => void;
}) {
  const { apiFetch } = useAuth();
  const closeRef = useRef<HTMLButtonElement>(null);

  const [date, setDate] = useState(() => dayOf(appointment.windowStart));
  const [startTime, setStartTime] = useState(() => timeOf(appointment.windowStart));
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

  const unchanged =
    date === dayOf(appointment.windowStart) && startTime === timeOf(appointment.windowStart);
  const canSubmit = Boolean(date && startTime && reason.trim()) && !unchanged && !submitting;

  async function handleSubmit() {
    if (!date || !startTime || !reason.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await apiFetch(`/api/appointments/${appointment.id}/move`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // The trail's own record of why a promise to a household changed
          // (docs/SPEC/scheduling-manual.md section 9). The middleware scrubs
          // it and stamps it on the transaction.
          'x-reason': reason.trim(),
        },
        body: JSON.stringify({ windowStart: composeWindowStart(date, startTime) }),
      });
      if (res.status === 201) {
        onMoved(MoveAppointmentResponse.parse(await res.json()));
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
      if (res.status === 400 || res.status === 404) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        const code = body?.code as AppointmentActionCode | undefined;
        setSubmitError({
          kind: 'issues',
          issues: [
            {
              code: code ?? 'invalid_request',
              message: (code && ACTION_MESSAGES[code]) ?? NOT_FOUND,
            },
          ],
        });
        return;
      }
      setSubmitError({ kind: 'generic', message: 'The visit could not be moved. Try again.' });
    } catch {
      setSubmitError({ kind: 'generic', message: 'The visit could not be moved. Try again.' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <aside className="drawer" role="dialog" aria-labelledby="move-appointment-title">
      <header className="drawer__header">
        <div className="drawer__title">
          <h2 id="move-appointment-title">Move appointment</h2>
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
            <span className="field__label">Arranged for</span>
            <p className="stepper__chosen">
              <span>
                {appointment.client.givenName} {appointment.client.familyName}
              </span>
              <span className="numeric">
                {formatDay(dayOf(appointment.windowStart))}{' '}
                {formatWindow(appointment.windowStart, appointment.windowEnd)}
              </span>
            </p>
            <div className="small muted">
              {appointment.serviceType.name}, with {appointment.practitioner.displayName}
            </div>
          </div>

          <div className="stepper__step">
            <Field
              id="move-date"
              className="schedule__date"
              label="New date"
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setSubmitError(null);
              }}
            />
          </div>

          <div className="stepper__step">
            <Field
              id="move-start-time"
              label="New start time"
              type="time"
              value={startTime}
              onChange={(e) => {
                setStartTime(e.target.value);
                setSubmitError(null);
              }}
              hint={
                startTime ? `Arrival window ${startTime}–${windowEndForTime(startTime)}` : undefined
              }
            />
          </div>

          <div className="stepper__step">
            <Field
              id="move-reason"
              label="Why is it moving?"
              type="text"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setSubmitError(null);
              }}
              hint="Recorded against this change. A short sentence is enough."
            />
          </div>

          <Note>The household still has to be told the new window.</Note>

          {submitError ? (
            submitError.kind === 'forbidden' ? (
              <Note tone="critical">
                Only the owner, an admin or a lead practitioner can move an appointment.
              </Note>
            ) : submitError.kind === 'generic' ? (
              <Note tone="critical">{submitError.message}</Note>
            ) : (
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
              {submitting ? 'Moving…' : 'Move appointment'}
            </Button>
            {unchanged ? <span className="small muted">Choose a different time first.</span> : null}
          </div>
        </div>
      </div>
    </aside>
  );
}
