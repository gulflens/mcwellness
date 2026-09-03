import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { cancellationStatusFor, reasonCanBeGivenAt } from '@domain/scheduling';
import { WaiveEntitlementResponse } from '../../api/billing/ledger-schema';
import {
  CancelAppointmentResponse,
  CANCELLATION_REASONS,
  SchedulingSettingsResponse,
  type AppointmentActionCode,
  type AppointmentRow,
  type CancellationReason,
} from '../../api/appointments/schema';
import { formatFils } from '../billing/money';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note, Select } from '../../shell/components/Controls';
import { CloseIcon } from '../../shell/components/Icons';
import { dayOf, formatDay, formatWindow } from './windows';

/**
 * Calling a visit off, and saying what that costs before it is done
 * (docs/SPEC/scheduling-manual.md sections 3 and 6.4, docs/SPEC/billing.md
 * section 4.3).
 *
 * **The consequence is named while the coordinator can still change their
 * mind.** Inside the practice's own notice period a cancellation uses one of
 * the client's sessions, and finding that out afterwards is finding it out
 * too late. So the drawer asks the practice for its notice period, runs the
 * same rule the route will run (`cancellationStatusFor`, the one place that
 * rule lives), and says plainly which side of it this visit falls on.
 *
 * **And what actually happened is reported, not assumed.** A late
 * cancellation only uses a session if the client had one; when they had
 * none, the practice has a decision to make instead, and the panel after the
 * event says which of the two occurred rather than repeating the warning.
 */

const REASON_LABELS: Record<CancellationReason, string> = {
  client_request: 'The family called it off',
  practice_request: 'The practice called it off',
  unfit_to_attend: 'The visit could not go ahead at the door',
};

const NOT_FOUND =
  'This appointment is no longer there. Close this and reload the day to see what changed.';

const ACTION_MESSAGES: Record<AppointmentActionCode, string> = {
  invalid_request: 'Choose a reason, then try again.',
  appointment_not_found: NOT_FOUND,
  appointment_settled:
    'This visit has already been checked in, delivered, called off or moved, so it cannot be ' +
    'called off now. Reload the day to see where it stands.',
  reason_required: 'Say why this visit is being called off before calling it off.',
  reason_too_early:
    'A visit can only be recorded as unable to go ahead once its arrival window has opened. ' +
    'Choose another reason.',
  session_open:
    'A session has already been started for this visit. How it ends is recorded on the session ' +
    'itself, not here.',
};

/** The eight characters `WaiveEntitlementInput` insists on, so the drawer can
 * say so rather than let the route say it in a 400. */
const MINIMUM_WAIVER_REASON = 8;

type Waiver =
  | { kind: 'offered' }
  | { kind: 'saving' }
  | { kind: 'given' }
  | { kind: 'refused'; message: string };

type State =
  | { kind: 'asking' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; outcome: CancelAppointmentResponse };

export function CancelAppointmentDrawer({
  appointment,
  onClose,
  onCancelled,
}: {
  appointment: AppointmentRow;
  onClose: () => void;
  /** Called once the day behind should be reloaded, not on every keystroke. */
  onCancelled: () => void;
}) {
  const { apiFetch } = useAuth();
  const closeRef = useRef<HTMLButtonElement>(null);

  const [reason, setReason] = useState<CancellationReason>('client_request');
  const [note, setNote] = useState('');
  const [settings, setSettings] = useState<SchedulingSettingsResponse | null>(null);
  // Whether the practice's own policy could be read at all. Its own state, not
  // an absent `settings`: "still loading" and "cannot be read" want different
  // sentences, and neither may quietly become "there is no consequence".
  const [policy, setPolicy] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [submitting, setSubmitting] = useState(false);
  const [state, setState] = useState<State>({ kind: 'asking' });
  const [waiver, setWaiver] = useState<Waiver>({ kind: 'offered' });

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

  useEffect(() => {
    let live = true;
    void apiFetch('/api/appointments/settings')
      .then(async (res) => {
        if (!live) return;
        if (!res.ok) {
          setPolicy('unavailable');
          return;
        }
        const parsed = SchedulingSettingsResponse.safeParse(await res.json());
        if (parsed.success) {
          setSettings(parsed.data);
          setPolicy('ready');
        } else {
          setPolicy('unavailable');
        }
      })
      .catch(() => {
        if (live) setPolicy('unavailable');
      });
    return () => {
      live = false;
    };
  }, [apiFetch]);

  // "Could not go ahead at the door" cannot honestly be given about a visit
  // nobody has driven to yet. The route refuses it and so does the database;
  // this says so before the coordinator has typed a sentence about it, which
  // is the only one of the three that is any use to them.
  const tooEarly = !reasonCanBeGivenAt(
    reason,
    { windowStart: new Date(appointment.windowStart) },
    new Date(),
  );

  // The same rule the route runs, given the same figure. Null only while the
  // practice's own notice period is still being fetched: guessing at it and
  // being wrong is worse than saying nothing for a moment.
  const willBeLate =
    settings === null
      ? null
      : cancellationStatusFor(
          { windowStart: new Date(appointment.windowStart) },
          reason,
          new Date(),
          settings.noticeHours,
        ) === 'cancelled_late';

  async function handleSubmit() {
    if (!note.trim()) return;
    setSubmitting(true);
    setState({ kind: 'asking' });
    try {
      const res = await apiFetch(`/api/appointments/${appointment.id}/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-reason': note.trim() },
        body: JSON.stringify({ reason }),
      });
      if (res.ok) {
        setState({ kind: 'done', outcome: CancelAppointmentResponse.parse(await res.json()) });
        onCancelled();
        return;
      }
      if (res.status === 403) {
        setState({
          kind: 'error',
          message: 'You do not have permission to call off this appointment.',
        });
        return;
      }
      if (res.status === 400 || res.status === 404) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        const code = body?.code as AppointmentActionCode | undefined;
        setState({ kind: 'error', message: (code && ACTION_MESSAGES[code]) ?? NOT_FOUND });
        return;
      }
      setState({ kind: 'error', message: 'The visit could not be called off. Try again.' });
    } catch {
      setState({ kind: 'error', message: 'The visit could not be called off. Try again.' });
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Give the session back, from here.
   *
   * `docs/SPEC/billing.md` section 4.3 asks for "a one-click waiver with a
   * reason field", and this is the one moment a coordinator both knows it is
   * wanted and has already written the reason down — the sentence they typed
   * about what happened is exactly the reason a waiver needs. Sending them to
   * another screen to find the credit again would be the click that never
   * happens, and the family would keep paying for it.
   *
   * The route is billing's and so is the permission: a lead practitioner may
   * call a visit off and may not forgive the charge, which is a real
   * distinction and not one this screen argues with. A refusal is said plainly
   * and the way through to Billing stays.
   */
  async function waive(entitlementId: string) {
    setWaiver({ kind: 'saving' });
    try {
      const res = await apiFetch(`/api/billing/entitlements/${entitlementId}/waiver`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-reason': note.trim() },
        body: JSON.stringify({ reason: note.trim() }),
      });
      if (res.ok) {
        WaiveEntitlementResponse.parse(await res.json());
        setWaiver({ kind: 'given' });
        return;
      }
      setWaiver({
        kind: 'refused',
        message:
          res.status === 403
            ? 'Waiving a charge is the owner’s, an admin’s or finance’s. Ask one of them, or open Billing.'
            : 'The session could not be given back from here. Open Billing and waive it there.',
      });
    } catch {
      setWaiver({
        kind: 'refused',
        message: 'The session could not be given back from here. Open Billing and waive it there.',
      });
    }
  }

  return (
    <aside className="drawer" role="dialog" aria-labelledby="cancel-appointment-title">
      <header className="drawer__header">
        <div className="drawer__title">
          <h2 id="cancel-appointment-title">Call off appointment</h2>
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

          {state.kind === 'done' ? (
            <>
              <Note>
                The visit is called off
                {state.outcome.status === 'cancelled_late'
                  ? `, inside the practice's ${state.outcome.noticeHours} hours' notice.`
                  : '.'}
              </Note>
              {state.outcome.creditConsumed && waiver.kind !== 'given' ? (
                <Note tone="attention">
                  It used one of the client&rsquo;s sessions. If it should not have, give it back
                  now.
                </Note>
              ) : null}
              {waiver.kind === 'given' ? (
                <Note>The session has been given back to the client.</Note>
              ) : null}
              {waiver.kind === 'refused' ? <Note tone="critical">{waiver.message}</Note> : null}
              {!state.outcome.creditConsumed && state.outcome.status === 'cancelled_late' ? (
                <Note tone="attention">
                  The client had no session left to use for it, so nothing was taken. The practice
                  decides whether to charge for this one.
                </Note>
              ) : null}
              <div className="stepper__submit">
                {state.outcome.waiverEntitlementId !== null && waiver.kind !== 'given' ? (
                  <Button
                    variant="primary"
                    disabled={
                      waiver.kind === 'saving' || note.trim().length < MINIMUM_WAIVER_REASON
                    }
                    onClick={() => void waive(state.outcome.waiverEntitlementId as string)}
                  >
                    {waiver.kind === 'saving' ? 'Giving it back…' : 'Give the session back'}
                  </Button>
                ) : null}
                <Link className="button button--secondary" to="/admin/billing">
                  Open Billing
                </Link>
                <Button variant="quiet" onClick={onClose}>
                  Close
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="stepper__step">
                <Select
                  id="cancel-reason"
                  label="Reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value as CancellationReason)}
                >
                  {CANCELLATION_REASONS.map((value) => (
                    <option key={value} value={value}>
                      {REASON_LABELS[value]}
                    </option>
                  ))}
                </Select>
              </div>

              {tooEarly ? <Note tone="critical">{ACTION_MESSAGES.reason_too_early}</Note> : null}
              {!tooEarly && willBeLate === true ? (
                <Note tone="attention">
                  {reason === 'unfit_to_attend'
                    ? 'A visit that cannot go ahead once the practitioner has arrived counts as ' +
                      "late whatever notice was given: it uses one of the client's sessions."
                    : `This is inside the practice's ${settings?.noticeHours} hours' notice, so it ` +
                      "uses one of the client's sessions. It can be waived afterwards."}
                </Note>
              ) : null}
              {!tooEarly && willBeLate === false ? (
                <Note>
                  This is outside the practice&rsquo;s {settings?.noticeHours} hours&rsquo; notice,
                  so the client keeps the session.
                </Note>
              ) : null}
              {!tooEarly &&
              reason === 'unfit_to_attend' &&
              settings !== null &&
              settings.unfitFeeFils > 0 ? (
                <Note>
                  The practice&rsquo;s fee for this is AED {formatFils(settings.unfitFeeFils)}. It
                  is not charged automatically; add it on the client&rsquo;s account in Billing.
                </Note>
              ) : null}

              <div className="stepper__step">
                <Field
                  id="cancel-note"
                  label="What happened?"
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  hint="Recorded against this cancellation. A short sentence is enough."
                />
              </div>

              {policy === 'loading' ? (
                <Note>Reading the practice&rsquo;s notice period.</Note>
              ) : null}
              {policy === 'unavailable' ? (
                <Note tone="critical">
                  The practice&rsquo;s notice period could not be read, so this screen cannot say
                  whether calling this visit off uses one of the client&rsquo;s sessions. Try again
                  in a moment.
                </Note>
              ) : null}
              {state.kind === 'error' ? <Note tone="critical">{state.message}</Note> : null}

              <div className="stepper__submit">
                <Button
                  variant="primary"
                  // Never while the consequence is unknown. A cancellation
                  // that might silently cost a household a session is not a
                  // thing to let somebody do without telling them which it is
                  // (design review of this pull request).
                  disabled={!note.trim() || tooEarly || policy !== 'ready' || submitting}
                  onClick={() => void handleSubmit()}
                >
                  {submitting ? 'Calling off…' : 'Call off this visit'}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
