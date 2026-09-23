import { useEffect, useRef, useState } from 'react';
import type { AppointmentRow } from '../../api/appointments/schema';
import { VOID_CONFLICT_CODES, type VoidConflictCode } from '../../api/sessions/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note } from '../../shell/components/Controls';
import { CloseIcon } from '../../shell/components/Icons';
import { dayOf, formatDay, formatWindow } from './windows';

/**
 * Voiding a visit logged from the practice's records in error (trunk round
 * 60, docs/superpowers/specs/2026-09-23-void-logged-session-design.md
 * "Screens"). `POST /api/sessions/:id/void` stamps the session and its
 * appointment voided, frees the window, and gives back the credit the visit
 * took; nothing is deleted, and the row stays on the day greyed as "Voided".
 *
 * The drawer says what will happen before it happens, in two sentences: the
 * window is freed, and the credit comes back — or nothing comes back, because
 * the visit was settled before the app and took no credit. The reason is the
 * request's own (`x-reason`) and goes on the record with the void.
 *
 * Offered only on a visit logged from the records, to the office's three
 * roles (`session.void`); the route and the database hold the same line.
 * Never a modal (DESIGN.md "The Beside Rule").
 */

/**
 * A 409 names why this row is not one a void may withdraw. Shared with the
 * correction (LogPastSessionDrawer), whose route refuses with the same codes
 * when the visit it replaces cannot be voided.
 */
export const VOID_CONFLICT_MESSAGES: Record<VoidConflictCode, string> = {
  not_a_records_row: 'Only a visit logged from the records can be voided.',
  not_completed: 'This visit is not a completed one.',
  already_voided: 'This visit has already been voided.',
  session_in_use: 'A measurement or an invoice still names this visit; remove that first.',
};

const GENERIC = 'The visit could not be voided. Try again.';

export function isVoidConflictCode(code: unknown): code is VoidConflictCode {
  return (VOID_CONFLICT_CODES as readonly unknown[]).includes(code);
}

export function VoidSessionDrawer({
  appointment,
  onClose,
  onVoided,
}: {
  /** A completed row logged from the records: `sessionId` names what is voided. */
  appointment: AppointmentRow;
  onClose: () => void;
  /** Called once the void has landed, so the day behind can be reloaded. */
  onVoided: () => void;
}) {
  const { apiFetch } = useAuth();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  async function handleSubmit() {
    const why = reason.trim();
    if (!why || !appointment.sessionId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/sessions/${appointment.sessionId}/void`, {
        method: 'POST',
        // The route reads no body, but the API declines a POST that does not
        // declare itself JSON (`jsonOnly`, app/api/_middleware/security.ts).
        headers: { 'content-type': 'application/json', 'x-reason': why },
        body: '{}',
      });
      if (res.ok) {
        onVoided();
        return;
      }
      if (res.status === 403) {
        setError('Only the owner, an admin or a lead practitioner can void a visit.');
        return;
      }
      if (res.status === 400) {
        setError('Say why this visit is being voided.');
        return;
      }
      if (res.status === 404) {
        setError(
          'This visit is no longer there. Close this and reload the day to see what changed.',
        );
        return;
      }
      if (res.status === 409) {
        const body = (await res.json().catch(() => null)) as { code?: unknown } | null;
        setError(isVoidConflictCode(body?.code) ? VOID_CONFLICT_MESSAGES[body.code] : GENERIC);
        return;
      }
      setError(GENERIC);
    } catch {
      setError(GENERIC);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <aside className="drawer" role="dialog" aria-labelledby="void-session-title">
      <header className="drawer__header">
        <div className="drawer__title">
          <h2 id="void-session-title">Void this visit</h2>
          <p className="small muted">Logged from the records in error.</p>
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
            <span className="field__label">The visit</span>
            <p className="stepper__chosen">
              <span>
                {appointment.client.givenName} {appointment.client.familyName}
              </span>
              <span className="numeric">
                {formatDay(dayOf(appointment.windowStart))}{' '}
                {formatWindow(appointment.windowStart, appointment.windowEnd)}
              </span>
            </p>
          </div>

          <Note>The window is freed for the right visit.</Note>
          <Note>
            {appointment.settledOutsideApp
              ? 'Nothing comes back: the visit was settled before the app.'
              : 'The session credit comes back to the household.'}
          </Note>

          <div className="stepper__step">
            <Field
              id="void-reason"
              label="Why"
              maxLength={500}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setError(null);
              }}
              hint="Kept on the record with the void."
            />
          </div>

          {error ? <Note tone="critical">{error}</Note> : null}

          <div className="stepper__submit">
            <Button
              variant="primary"
              disabled={!reason.trim() || submitting}
              onClick={() => void handleSubmit()}
            >
              {submitting ? 'Voiding…' : 'Void'}
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}
