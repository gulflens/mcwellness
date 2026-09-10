import { useRef, useState } from 'react';
import {
  ConflictResponse,
  type BoardPractitioner,
  type BoardVisit,
  type ConflictIssue,
  type ReassignActionCode,
} from '../../../api/appointments/schema';
import { useAuth } from '../../../shell/auth/AuthContext';
import { Button, Field, Note, Select } from '../../../shell/components/Controls';
import { CloseIcon } from '../../../shell/components/Icons';
import { useDrawer } from '../../../shell/components/useDrawer';
import { localConflictMessage } from '../conflictMessages';
import { formatWindow } from '../windows';

/**
 * Handing one visit to another practitioner (docs/SPEC/dispatch.md section
 * 6.4): the accessible path onto the board's drag, and the one that takes the
 * reason a drop cannot type.
 *
 * Two facts it keeps in front of the dispatcher. The household was promised a
 * window, and this act does not change it — only the hands. And whoever the
 * visit goes to must be certified for the service on the day, which is the
 * route's own check and the commonest refusal here.
 *
 * Never a modal (DESIGN.md "The Beside Rule"): fixed to the inline end, over
 * the board, no scrim. The same shape as the day's own move and call-off
 * drawers, so the two screens feel like one console.
 */

/**
 * The seven refusals a reassignment can meet before any rule is consulted,
 * and no others: `REASSIGN_ACTION_CODES` is the route's own list, and a
 * drawer should carry only the sentences its own route can produce (the
 * `MoveActionCode` precedent, app/admin/schedule/MoveAppointmentDrawer.tsx).
 */
const ACTION_MESSAGES: Record<ReassignActionCode, string> = {
  invalid_request: 'Check the practitioner and try again.',
  reason_required: 'Say why this visit is changing hands before it does.',
  appointment_not_found: 'This appointment is no longer there. Close this and reload the board.',
  appointment_settled:
    'This visit has already been checked in, delivered, called off or moved. ' +
    'Reload the board to see where it stands.',
  session_open: 'A session has already been started for this visit, so it cannot change hands now.',
  same_practitioner: 'That is the practitioner it is already with.',
  practitioner_not_found:
    'That practitioner is no longer with the practice. Reload the board and choose somebody else.',
};

/**
 * The route answers 403 for two different things: the caller may not reassign
 * at all, or the practitioner they chose holds no credential for this service
 * on that day. It does not say which, and a drawer that guessed would
 * eventually guess wrong — so this names the likely one first (the screen is
 * already behind the same three roles the act needs) and the other after it,
 * with the way out of each.
 */
const FORBIDDEN =
  'That practitioner is not certified for this service on that day. Choose another ' +
  'practitioner, or reload the board if your own access has changed.';

const FAILED = 'The visit could not be reassigned. Try again.';

/** What the "To" list asks of whoever is picked, said before it is sent (6.4). */
const CREDENTIAL_HINT = 'They must hold a valid credential for this service on that day.';

/**
 * The two conflicts whose shared sentence names a recovery this drawer has
 * not got. `localConflictMessage` is written for the booking and move
 * drawers, and both of those can change the time; this one cannot — the
 * household keeps the window it was promised (spec 6.1) — so "Choose a
 * different time" would be advice about a control that is not on the screen.
 * Every other code keeps the module's shared sentence, which already names a
 * recovery this drawer does have.
 */
const OWN_CONFLICT_MESSAGES: Partial<Record<ConflictIssue['code'], string>> = {
  practitioner_overlap:
    'That practitioner already has a visit in this window. Choose another practitioner.',
  client_overlap:
    'The household already has another visit in this window. Look at the day before handing ' +
    'this one on.',
};

function conflictMessage(issue: ConflictIssue): string {
  return OWN_CONFLICT_MESSAGES[issue.code] ?? localConflictMessage(issue);
}

export function ReassignDrawer({
  visit,
  from,
  initialTo,
  practitioners,
  onClose,
  onDone,
}: {
  visit: BoardVisit;
  from: BoardPractitioner;
  /** The row a block was dropped on, when a drag opened this. */
  initialTo: string | null;
  /** Everyone but the practitioner the visit is already with. */
  practitioners: readonly BoardPractitioner[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { apiFetch } = useAuth();
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // The console's shared drawer behaviour: `inert` on everything behind, a
  // focus cycle inside, focus returned, Escape to close. It matters more here
  // than on the day's own drawers — the board behind is a grid of draggable
  // blocks, and a drag begun on it while this is open would re-target the
  // reassignment underneath the dispatcher.
  useDrawer(drawerRef, closeRef, onClose);

  const [to, setTo] = useState(initialTo ?? practitioners[0]?.practitionerId ?? '');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = Boolean(to && reason.trim()) && !submitting;

  /**
   * What is still missing, in the order the drawer asks for it. A disabled
   * primary that says nothing is a control somebody presses twice and then
   * gives up on (the same finding as the move drawer's).
   */
  const missing = !to
    ? 'There is nobody else on the board to hand this visit to.'
    : !reason.trim()
      ? 'Say why it is changing hands first.'
      : null;

  async function handleSubmit() {
    if (!to || !reason.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/appointments/${visit.appointmentId}/reassign`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // The trail's own record of why a promise to a household changed
          // hands (docs/SPEC/dispatch.md section 11). The middleware scrubs it
          // and stamps it on the transaction; the route only insists there was
          // one.
          'x-reason': reason.trim(),
        },
        // No window: the household keeps the one it was promised (6.1).
        body: JSON.stringify({ practitionerId: to }),
      });
      if (res.status === 201) {
        onDone();
        return;
      }
      if (res.status === 403) {
        setError(FORBIDDEN);
        return;
      }
      const body = (await res.json().catch(() => null)) as {
        code?: string;
        issues?: unknown;
      } | null;
      if (res.status === 409) {
        const parsed = ConflictResponse.safeParse(body);
        setError(parsed.success ? parsed.data.issues.map(conflictMessage).join(' ') : FAILED);
        return;
      }
      if (res.status === 400 || res.status === 404) {
        const code = body?.code as ReassignActionCode | undefined;
        setError((code && ACTION_MESSAGES[code]) ?? ACTION_MESSAGES.invalid_request);
        return;
      }
      setError(FAILED);
    } catch {
      setError(FAILED);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <aside ref={drawerRef} className="drawer" role="dialog" aria-labelledby="reassign-title">
      <header className="drawer__header">
        <div className="drawer__title">
          <h2 id="reassign-title">Reassign the visit</h2>
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
            <span className="field__label">Promised</span>
            <p className="stepper__chosen">
              <span>
                {visit.client.givenName} {visit.client.familyName}
              </span>
              <span className="numeric">{formatWindow(visit.windowStart, visit.windowEnd)}</span>
            </p>
            <div className="small muted">
              {visit.serviceType.name}, with {from.displayName}. The household keeps this window.
            </div>
          </div>

          <div className="stepper__step">
            <Select
              id="reassign-to"
              label="To"
              value={to}
              hint={CREDENTIAL_HINT}
              onChange={(e) => {
                setTo(e.target.value);
                setError(null);
              }}
            >
              {practitioners.map((practitioner) => (
                <option key={practitioner.practitionerId} value={practitioner.practitionerId}>
                  {practitioner.displayName}
                </option>
              ))}
            </Select>
          </div>

          <div className="stepper__step">
            <Field
              id="reassign-why"
              label="Why"
              type="text"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setError(null);
              }}
              hint="Recorded against this change. A short sentence is enough."
            />
          </div>

          <Note>
            The household still has to be told who is coming, and the practitioner sees it on their
            next Today.
          </Note>

          {error ? (
            <div className="stepper__issues">
              <Note tone="critical">{error}</Note>
            </div>
          ) : null}

          <div className="stepper__submit">
            <Button variant="primary" disabled={!canSubmit} onClick={() => void handleSubmit()}>
              {submitting ? 'Reassigning…' : 'Reassign'}
            </Button>
            {missing ? <span className="small muted">{missing}</span> : null}
          </div>
        </div>
      </div>
    </aside>
  );
}
