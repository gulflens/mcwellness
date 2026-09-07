import { useEffect, useRef, useState } from 'react';
import {
  REASONS_NEEDING_THE_HOUSEHOLD_TOLD,
  cancellationStatusFor,
  householdHasBeenTold,
  reasonCanBeGivenAt,
} from '@domain/scheduling';
import { WaiveCallOutFeeResponse } from '../../api/billing/ledger-schema';
import {
  CancelAppointmentResponse,
  CANCELLATION_REASONS,
  SchedulingSettingsResponse,
  type AppointmentRow,
  type CancelActionCode,
  type CancellationReason,
} from '../../api/appointments/schema';
import { fils } from '@domain/shared';
import { callOutFeeFor, formatFils } from '../billing/money';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Field, Note, Select } from '../../shell/components/Controls';
import { CloseIcon } from '../../shell/components/Icons';
import { BoundaryLink } from './map/documentBoundary';
import { dayOf, formatDay, formatWindow } from './windows';

/**
 * Calling a visit off, and saying what that costs before it is done
 * (docs/SPEC/scheduling-manual.md sections 3 and 6.4, docs/SPEC/billing.md
 * section 4.3).
 *
 * **The consequence is named while the coordinator can still change their
 * mind.** Inside the practice's own notice period a cancellation carries the
 * practice's call-out fee, and finding that out afterwards is finding it out
 * too late. So the drawer asks the practice for its policy, runs the same two
 * rules the route and the ledger will run — `cancellationStatusFor` for the
 * status and `callOutFeeFor` for the money, each the one place its rule lives
 * — and says plainly what this visit will cost.
 *
 * **One fee, never a session** (the founder's decision of 2026-09-04). A
 * package's sessions are never taken for a cancellation, whatever the notice
 * was, and the drawer says so out loud: a coordinator who remembers the old
 * rule should be told the new one rather than left to infer it from a silence.
 *
 * **And what actually happened is reported, not assumed.** The route reads the
 * charge back out of the ledger and hands over its id, so the panel after the
 * event offers to forgive exactly the row that exists.
 *
 * **A visit the household has never been told about is a different act.**
 * `proposed` is a slot the practice is holding and has mentioned to nobody
 * (docs/SPEC/scheduling-manual.md section 3), so releasing it takes nothing
 * from anybody: there is no notice to break, no session to use and nothing to
 * tell them afterwards. The two reasons that claim the household did
 * something are not offered at all, rather than offered and refused, because
 * whether a household has been told is a fact about the visit and does not
 * change while this drawer is open (docs/CHANGE-REQUESTS/qa-01.md item 5).
 */

const REASON_LABELS: Record<CancellationReason, string> = {
  client_request: 'The family called it off',
  practice_request: 'The practice called it off',
  unfit_to_attend: 'The visit could not go ahead at the door',
};

const NOT_FOUND =
  'This appointment is no longer there. Close this and reload the day to see what changed.';

const ACTION_MESSAGES: Record<CancelActionCode, string> = {
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
  household_not_told:
    'The household has not been told about this visit yet, so it cannot be called off on ' +
    'their behalf or recorded as unable to go ahead. Choose another reason.',
};

/** The eight characters `WaiveEntitlementInput` insists on, so the drawer can
 * say so rather than let the route say it in a 400. */
const MINIMUM_WAIVER_REASON = 8;

/**
 * What to say the fee was, once it has been charged.
 *
 * **The same figure as before the act.** The practice's price is net and VAT is
 * added on top at write time (migration 406), so reading the gross back and
 * showing it would have this drawer say AED 150.00 in one breath and AED 157.50
 * in the next about the same visit — a practice that appears to have moved its
 * own price while the coordinator was reading (design review of this pull
 * request). Where VAT was added the larger figure is the true one, so it is
 * shown and named as including VAT; where there is none — the practice today —
 * the two figures are the same and nothing needs saying.
 */
function feeAsCharged(
  outcome: CancelAppointmentResponse,
): { fils: number; includesVat: boolean } | null {
  if (outcome.callOutFeeNetFils === null) return null;
  const vat = outcome.callOutFeeVatFils ?? 0;
  return vat > 0
    ? { fils: outcome.callOutFeeGrossFils ?? outcome.callOutFeeNetFils, includesVat: true }
    : { fils: outcome.callOutFeeNetFils, includesVat: false };
}

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

  // Whether anybody has told this household about this visit at all. Read
  // once: the drawer is open for a moment and the row behind it does not
  // change underneath it.
  const told = householdHasBeenTold(appointment.status);
  const reasons = CANCELLATION_REASONS.filter(
    (value) => told || !REASONS_NEEDING_THE_HOUSEHOLD_TOLD.includes(value),
  );
  const [reason, setReason] = useState<CancellationReason>(() => reasons[0] ?? 'practice_request');
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
    { windowStart: new Date(appointment.windowStart), status: appointment.status },
    new Date(),
  );

  // The same two rules the route and the ledger run, given the same figures.
  // Null only while the practice's own policy is still being fetched: guessing
  // at it and being wrong is worse than saying nothing for a moment.
  const outcome =
    settings === null
      ? null
      : cancellationStatusFor(
          { windowStart: new Date(appointment.windowStart), status: appointment.status },
          reason,
          new Date(),
          settings.noticeHours,
        );
  const willBeLate = outcome === null ? null : outcome === 'cancelled_late';
  // What it will cost, from billing's own rule rather than from this screen's
  // reading of it. Null when nothing is charged — a visit called off in time,
  // or one the practice itself is calling off.
  const feeFils =
    outcome === null || settings === null
      ? null
      : callOutFeeFor(outcome, reason, { callOutFeeFils: fils(settings.unfitFeeFils) });

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
        const code = body?.code as CancelActionCode | undefined;
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
   * Forgive the fee, from here.
   *
   * `docs/SPEC/billing.md` section 4.3 asks for "a one-click waiver with a
   * reason field", and this is the one moment a coordinator both knows it is
   * wanted and has already written the reason down — the sentence they typed
   * about what happened is exactly the reason a waiver needs. Sending them to
   * another screen to find the charge again would be the click that never
   * happens, and the family would keep owing it.
   *
   * The route is billing's and so is the permission: a lead practitioner may
   * call a visit off and may not forgive the charge, which is a real
   * distinction and not one this screen argues with. A refusal is said plainly
   * and the way through to Billing stays.
   */
  async function waive(invoiceId: string) {
    setWaiver({ kind: 'saving' });
    try {
      const res = await apiFetch(`/api/billing/invoices/${invoiceId}/waiver`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-reason': note.trim() },
        body: JSON.stringify({ reason: note.trim() }),
      });
      if (res.ok) {
        WaiveCallOutFeeResponse.parse(await res.json());
        setWaiver({ kind: 'given' });
        return;
      }
      setWaiver({
        kind: 'refused',
        message:
          res.status === 403
            ? 'Waiving a charge is the owner’s, an admin’s or finance’s. Ask one of them, or open Billing.'
            : 'The fee could not be waived from here. Open Billing and waive it there.',
      });
    } catch {
      setWaiver({
        kind: 'refused',
        message: 'The fee could not be waived from here. Open Billing and waive it there.',
      });
    }
  }

  // What the visit actually cost, once the route has said so. Null before the
  // act and whenever nothing was charged.
  const charged = state.kind === 'done' ? feeAsCharged(state.outcome) : null;

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
              {charged !== null && waiver.kind !== 'given' ? (
                <Note tone="attention">
                  {`A call-out fee of AED ${formatFils(charged.fils)}${
                    charged.includesVat ? ', including VAT,' : ''
                  } is on the client’s account, and no session was taken. If the fee should not ` +
                    'stand, waive it now.'}
                </Note>
              ) : null}
              {waiver.kind === 'given' ? (
                <Note>The call-out fee has been waived. The client owes nothing for it.</Note>
              ) : null}
              {waiver.kind === 'refused' ? <Note tone="critical">{waiver.message}</Note> : null}
              {charged === null && state.outcome.status === 'cancelled_late' ? (
                <Note>Nothing was charged for it, and no session was taken.</Note>
              ) : null}
              <div className="stepper__submit">
                {state.outcome.feeInvoiceId !== null && waiver.kind !== 'given' ? (
                  <Button
                    variant="primary"
                    disabled={
                      waiver.kind === 'saving' || note.trim().length < MINIMUM_WAIVER_REASON
                    }
                    onClick={() => void waive(state.outcome.feeInvoiceId as string)}
                  >
                    {waiver.kind === 'saving' ? 'Waiving it…' : 'Waive the fee'}
                  </Button>
                ) : null}
                {/* A `BoundaryLink`, not a `Link`: this drawer is opened from
                    the day map as well as from the Schedule, and the map is a
                    document served with a wider content security policy that
                    no other screen of the practice may be rendered inside
                    (app/admin/schedule/map/documentBoundary.tsx). There it is a
                    plain anchor and the browser loads Billing afresh; here it
                    stays the client-side link it always was. */}
                <BoundaryLink className="button button--secondary" to="/admin/billing">
                  Open Billing
                </BoundaryLink>
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
                  {reasons.map((value) => (
                    <option key={value} value={value}>
                      {REASON_LABELS[value]}
                    </option>
                  ))}
                </Select>
              </div>

              {tooEarly ? <Note tone="critical">{ACTION_MESSAGES.reason_too_early}</Note> : null}
              {!told ? (
                <Note>
                  The household has not been told about this visit yet, so calling it off costs them
                  nothing: it is a slot the practice was holding, and the practice is releasing it.
                </Note>
              ) : null}
              {told && !tooEarly && willBeLate === true && feeFils !== null ? (
                <Note tone="attention">
                  {reason === 'unfit_to_attend'
                    ? 'A visit that cannot go ahead once the practitioner has arrived counts as ' +
                      'late whatever notice was given. '
                    : `This is inside the practice's ${settings?.noticeHours} hours' notice. `}
                  A call-out fee of AED {formatFils(feeFils)} applies; no session is taken. It can
                  be waived afterwards.
                </Note>
              ) : null}
              {told && !tooEarly && willBeLate === true && feeFils === null ? (
                <Note>
                  {reason === 'practice_request'
                    ? 'This is recorded as late, because that is what the calendar says, and it ' +
                      'costs the family nothing: the practice is calling it off. No session is ' +
                      'taken and no fee is charged.'
                    : 'This is recorded as late, and it costs the family nothing. No session is ' +
                      'taken and no fee is charged.'}
                </Note>
              ) : null}
              {told && !tooEarly && willBeLate === false ? (
                <Note>
                  This is outside the practice&rsquo;s {settings?.noticeHours} hours&rsquo; notice,
                  so there is no fee. The client keeps the session either way.
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

              <Note>
                {told
                  ? 'The household still has to be told the visit is off, and the practitioner ' +
                    'sees it on their next Today.'
                  : 'There is nothing to tell the household: this visit was never announced to ' +
                    'them, and it was on no practitioner’s Today.'}
              </Note>

              {told && policy === 'loading' ? (
                <Note>Reading the practice&rsquo;s notice period.</Note>
              ) : null}
              {told && policy === 'unavailable' ? (
                <Note tone="critical">
                  The practice&rsquo;s notice period could not be read, so this screen cannot say
                  whether calling this visit off carries the call-out fee. Try again in a moment.
                </Note>
              ) : null}
              {state.kind === 'error' ? <Note tone="critical">{state.message}</Note> : null}

              <div className="stepper__submit">
                <Button
                  variant="primary"
                  // Never while the consequence is unknown. A cancellation
                  // that might silently cost a household a session is not a
                  // thing to let somebody do without telling them which it is
                  // (design review of the pull request that added this). A
                  // visit the household was never told about has no such
                  // consequence to be unknown, so it does not wait on the
                  // practice's notice period being readable.
                  disabled={!note.trim() || tooEarly || (told && policy !== 'ready') || submitting}
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
