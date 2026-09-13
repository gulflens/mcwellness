import { useEffect, useState } from 'react';
import { Button } from '../../shell/components/Controls';
import { ExportStep } from './ExportStep';
import { describeSignal } from './SignalDots';
import { PARKING_MAX_FILS, formatFilsAsAed, parseAedToFils } from './dirhams';
import type { Delta, Observations, VisitActuals } from './steps';

/**
 * The summary (docs/SPEC/session-capture.md section 3.6): how long, how
 * clean, what changed, what was seen — then what the visit itself cost.
 *
 * Two different quantities used to share the word "Signal" here: the mean
 * quality of the sites at setup, and the score of the session as a whole
 * (domain/session/scoreSignalQuality.ts). They are not the same measurement
 * and a good setup can precede a poor session, so each is named for what it
 * is.
 *
 * The practitioner confirms once, and that confirmation is what closes the
 * visit. Everything above the button is a record of what is about to be
 * written; nothing here can be edited, because editing it would mean
 * rewriting an append-only event log.
 *
 * **The export's last chance is in the dock, not in the page.** ./ExportStep.tsx
 * sits in the middle of this screen and the dock is sticky, so on a phone the
 * "No export attached" marker is scrolled off while Check out never is — and
 * migration 960 means a visit checked out without its export can never be
 * given one. So the dock says so itself, and the button asks twice: the same
 * arm-then-confirm RunStep uses to end a session, for the same reason, that
 * the thing on the other side of the tap cannot be undone.
 *
 * **It is not a gate, in either case.** The second tap is always available;
 * nothing here can refuse a check-out. A practitioner in a living room with no
 * signal, or with an upload that will never finish, taps twice and leaves.
 * `domain/session/canCheckIn.ts` gates entry and nothing gates exit.
 */

const CHIP_LABELS: Record<string, string> = {
  none: 'Nothing to note',
  headache: 'Headache',
  fatigue: 'Fatigue',
  irritability: 'Irritability',
  other: 'Something else',
};

function describeLength(seconds: number | null): string {
  if (seconds === null) return 'Not recorded';
  if (seconds < 60) return 'under a minute';
  return `${Math.round(seconds / 60)} min`;
}

function describeQuality(quality: number | null): string {
  if (quality === null) return 'Not recorded';
  return `${describeSignal(quality)} ${Math.round(quality * 100)}`;
}

/** How long the armed state waits before it forgets it was armed (RunStep's own). */
const ARMED_MS = 5000;

/** What the dock says, in the dock, about a file that cannot be added later. */
const NO_EXPORT = 'No export is attached. It cannot be attached once this visit is checked out.';
const EXPORT_UPLOADING =
  'The export is still uploading. Checking out now ends the visit, and the file cannot be ' +
  'attached afterwards.';

export function SummaryStep({
  sessionId,
  durationSeconds,
  recordReadings,
  setupQuality,
  sessionQuality,
  ratingDeltas,
  observations,
  actuals,
  onActuals,
  exportName,
  exportBusy,
  onExportAttached,
  onExportBusy,
  onConfirm,
}: {
  /** The visit the export is attached to (./ExportStep.tsx). */
  sessionId: string;
  durationSeconds: number | null;
  /** `tenant.record_readings`: whether the two rows below have anything to say. */
  recordReadings: boolean;
  /** The mean quality of the sites at setup (section 3.3). */
  setupQuality: number | null;
  /** The score of the run itself, cleanliness times time in target (section 5 rule 3). */
  sessionQuality: number | null;
  ratingDeltas: readonly Delta[];
  observations: Observations;
  actuals: VisitActuals;
  onActuals: (actuals: VisitActuals) => void;
  /** The name of the export already attached to this visit, or null. */
  exportName: string | null;
  /** Whether an export is uploading right now (./ExportStep.tsx). */
  exportBusy: boolean;
  onExportAttached: (name: string) => void;
  onExportBusy: (busy: boolean) => void;
  onConfirm: () => void;
}) {
  // The field holds what the practitioner typed; the state holds exact fils.
  // Nothing between them is ever a decimal number (./dirhams.ts).
  const [parking, setParking] = useState(() =>
    actuals.parkingCostFils === 0 ? '' : formatFilsAsAed(actuals.parkingCostFils),
  );
  const [parkingError, setParkingError] = useState<string | null>(null);
  // The first tap of the two, when there is something to say before the visit
  // closes for good. RunStep's own control, and its own reasoning: a phone in
  // one hand in somebody's living room gets tapped by accident, and this tap
  // is not undoable.
  const [armed, setArmed] = useState(false);

  // The export is the one thing on this screen that cannot be added later
  // (migration 960). Uploading counts as missing, because confirming unmounts
  // the control and the request lands on a closed visit.
  const exportMissing = exportName === null || exportBusy;

  // A control left armed by a pocket is a control that closes the next thing
  // the practitioner touches. It disarms itself, exactly as RunStep's does.
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), ARMED_MS);
    return () => clearTimeout(timer);
  }, [armed]);

  const onParking = (typed: string) => {
    setParking(typed);
    const fils = parseAedToFils(typed);
    if (fils === null) {
      setParkingError(
        `Enter an amount in dirhams, up to AED ${formatFilsAsAed(PARKING_MAX_FILS)}.`,
      );
      return;
    }
    setParkingError(null);
    onActuals({ ...actuals, parkingCostFils: fils });
  };

  return (
    <div className="step">
      <h1>Summary</h1>

      <dl className="summary">
        <div className="summary__row">
          <dt>Length</dt>
          <dd className="numeric">{describeLength(durationSeconds)}</dd>
        </div>
        {recordReadings ? (
          <>
            {/* Dormant along with the signal check and the run screen's
                panel (fix round 2, finding 3): with no reading ever taken,
                both would otherwise read "Not recorded" on every
                readings-off visit, which reads as something the
                practitioner forgot rather than something the practice does
                not do. Wording and both rows are unchanged when the switch
                is on. */}
            <div className="summary__row">
              <dt>Signal at setup</dt>
              <dd>{describeQuality(setupQuality)}</dd>
            </div>
            <div className="summary__row">
              <dt>Session quality</dt>
              <dd>{describeQuality(sessionQuality)}</dd>
            </div>
          </>
        ) : null}
        {ratingDeltas.map((delta) => (
          <div className="summary__row" key={delta.key}>
            <dt>{delta.label}</dt>
            <dd className="numeric">
              {delta.before} to {delta.after}
            </dd>
          </div>
        ))}
        <div className="summary__row">
          <dt>Observed</dt>
          <dd>
            {observations.chips.length === 0
              ? 'Nothing recorded'
              : observations.chips.map((chip) => CHIP_LABELS[chip] ?? chip).join(', ')}
          </dd>
        </div>
      </dl>

      <ExportStep
        sessionId={sessionId}
        attachedName={exportName}
        busy={exportBusy}
        onAttached={onExportAttached}
        onBusy={onExportBusy}
      />

      <section className="ratings">
        <h2>The visit itself</h2>
        <div className="field">
          <label className="field__label" htmlFor="actuals-parking">
            Parking, in dirhams
          </label>
          <input
            id="actuals-parking"
            className="field__input numeric"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={parking}
            aria-invalid={parkingError ? true : undefined}
            aria-describedby={parkingError ? 'actuals-parking-error' : undefined}
            onChange={(event) => onParking(event.target.value)}
          />
          {parkingError ? (
            <div
              id="actuals-parking-error"
              className="field__hint small note--critical"
              role="alert"
            >
              {parkingError}
            </div>
          ) : null}
        </div>
        <div className="field">
          <label className="field__label" htmlFor="actuals-salik">
            Salik crossings
          </label>
          <input
            id="actuals-salik"
            className="field__input numeric"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={actuals.salikCrossings}
            onChange={(event) =>
              onActuals({ ...actuals, salikCrossings: Math.max(0, Number(event.target.value)) })
            }
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="actuals-access">
            Anything about getting in
          </label>
          <textarea
            id="actuals-access"
            className="field__input field__input--area"
            rows={2}
            maxLength={1000}
            value={actuals.accessIssues}
            onChange={(event) => onActuals({ ...actuals, accessIssues: event.target.value })}
          />
          <div className="field__hint small muted">
            The practice reads this and decides whether to keep it on the address.
          </div>
        </div>
      </section>

      <div className="step__dock">
        {/* The one fact the dock has to carry: the file cannot be added
            afterwards, and this is the last screen that can take it. Not a
            red alert — a line of note text, the tone this app uses for
            anything the practitioner should know and nothing they must do
            (.claude/rules/ui.md). */}
        {exportMissing ? (
          <p className="note small" role={exportBusy ? 'status' : undefined}>
            {exportBusy ? EXPORT_UPLOADING : NO_EXPORT}
          </p>
        ) : null}
        <Button
          variant="primary"
          className="step__primary"
          disabled={parkingError !== null}
          // Never refused, only asked twice. The second tap is always there,
          // so a visit with no export and no signal still checks out.
          onClick={() => (exportMissing && !armed ? setArmed(true) : onConfirm())}
        >
          {exportMissing && armed ? 'Tap again to check out' : 'Check out'}
        </Button>
      </div>
    </div>
  );
}
