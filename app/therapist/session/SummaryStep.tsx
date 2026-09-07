import { useState } from 'react';
import { Button } from '../../shell/components/Controls';
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

export function SummaryStep({
  durationSeconds,
  setupQuality,
  sessionQuality,
  ratingDeltas,
  observations,
  actuals,
  onActuals,
  onConfirm,
}: {
  durationSeconds: number | null;
  /** The mean quality of the sites at setup (section 3.3). */
  setupQuality: number | null;
  /** The score of the run itself, cleanliness times time in target (section 5 rule 3). */
  sessionQuality: number | null;
  ratingDeltas: readonly Delta[];
  observations: Observations;
  actuals: VisitActuals;
  onActuals: (actuals: VisitActuals) => void;
  onConfirm: () => void;
}) {
  // The field holds what the practitioner typed; the state holds exact fils.
  // Nothing between them is ever a decimal number (./dirhams.ts).
  const [parking, setParking] = useState(() =>
    actuals.parkingCostFils === 0 ? '' : formatFilsAsAed(actuals.parkingCostFils),
  );
  const [parkingError, setParkingError] = useState<string | null>(null);

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
        <div className="summary__row">
          <dt>Signal at setup</dt>
          <dd>{describeQuality(setupQuality)}</dd>
        </div>
        <div className="summary__row">
          <dt>Session quality</dt>
          <dd>{describeQuality(sessionQuality)}</dd>
        </div>
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
        <Button
          variant="primary"
          className="step__primary"
          disabled={parkingError !== null}
          onClick={onConfirm}
        >
          Check out
        </Button>
      </div>
    </div>
  );
}
