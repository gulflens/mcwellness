import { Button } from '../../shell/components/Controls';
import { describeSignal } from './SignalDots';
import type { Delta, Observations, VisitActuals } from './steps';

/**
 * The summary (docs/SPEC/session-capture.md section 3.6): how long, how
 * clean, what changed, what was seen — then what the visit itself cost.
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

function minutes(seconds: number | null): string {
  if (seconds === null) return 'Not recorded';
  return `${Math.round(seconds / 60)} min`;
}

export function SummaryStep({
  durationSeconds,
  signalQuality,
  ratingDeltas,
  observations,
  actuals,
  onActuals,
  onConfirm,
}: {
  durationSeconds: number | null;
  signalQuality: number | null;
  ratingDeltas: readonly Delta[];
  observations: Observations;
  actuals: VisitActuals;
  onActuals: (actuals: VisitActuals) => void;
  onConfirm: () => void;
}) {
  return (
    <div className="step">
      <h1>Summary</h1>

      <dl className="summary">
        <div className="summary__row">
          <dt>Length</dt>
          <dd className="numeric">{minutes(durationSeconds)}</dd>
        </div>
        <div className="summary__row">
          <dt>Signal</dt>
          <dd>
            {describeSignal(signalQuality)}
            {signalQuality === null ? null : (
              <span className="numeric summary__score"> {Math.round(signalQuality * 100)}</span>
            )}
          </dd>
        </div>
        {ratingDeltas.map((delta) => (
          <div className="summary__row" key={delta.key}>
            <dt>{delta.label}</dt>
            <dd className="numeric">
              {delta.before === null ? 'not asked' : delta.before} to{' '}
              {delta.after === null ? 'not asked' : delta.after}
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
            Parking, in fils
          </label>
          <input
            id="actuals-parking"
            className="field__input numeric"
            type="number"
            inputMode="numeric"
            min={0}
            step={100}
            value={actuals.parkingCostFils}
            onChange={(event) =>
              onActuals({ ...actuals, parkingCostFils: Math.max(0, Number(event.target.value)) })
            }
          />
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
        <Button variant="primary" className="step__primary" onClick={onConfirm}>
          Check out
        </Button>
      </div>
    </div>
  );
}
