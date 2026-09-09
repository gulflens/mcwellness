import { OBSERVATION_CHIPS } from '@domain/session';
import { Button } from '../../shell/components/Controls';
import { PercentSlider, Slider } from './Slider';
import {
  midpoint,
  type Answers,
  type Observations,
  type Reading,
  type ServiceSettings,
} from './steps';

/**
 * End and post (docs/SPEC/session-capture.md section 3.5): the same
 * questions as before, and the structured observations as chips with a note
 * beside them.
 *
 * The setup photograph was the third thing on this screen until 2026-09-09,
 * when the practice's legal advisor recommended it take none. The camera, the
 * consent that authorised it and the wording that described it went together:
 * a control that cannot be permitted is not a control worth leaving on a
 * screen, and a promise about what is photographed is not worth printing when
 * nothing is.
 *
 * The summary reading appears only when nothing was recorded during the run
 * — section 3.4's "Phase 1 accepts a single end-of-session summary if
 * per-minute data isn't available" — and files nothing until the
 * practitioner actually moves it.
 */

const CHIP_LABELS: Record<string, string> = {
  none: 'Nothing to note',
  headache: 'Headache',
  fatigue: 'Fatigue',
  irritability: 'Irritability',
  other: 'Something else',
};

export function PostStep({
  service,
  answers,
  onAnswer,
  observations,
  onObservations,
  needsSummaryReading,
  summaryReading,
  summaryReadingTaken,
  onSummaryReading,
  onContinue,
}: {
  service: ServiceSettings;
  answers: Answers;
  onAnswer: (key: string, value: number) => void;
  observations: Observations;
  onObservations: (observations: Observations) => void;
  needsSummaryReading: boolean;
  summaryReading: Reading;
  summaryReadingTaken: boolean;
  onSummaryReading: (reading: Reading) => void;
  onContinue: () => void;
}) {
  const toggleChip = (chip: string) => {
    const has = observations.chips.includes(chip);
    // "Nothing to note" is an answer, not a filter: choosing it clears the
    // rest, and choosing anything else clears it.
    const next = has
      ? observations.chips.filter((c) => c !== chip)
      : chip === 'none'
        ? ['none']
        : [...observations.chips.filter((c) => c !== 'none'), chip];
    onObservations({ ...observations, chips: next });
  };

  return (
    <div className="step">
      <h1>After the session</h1>

      {service.ratingQuestions.length > 0 ? (
        <section className="ratings">
          {service.ratingQuestions.map((question) => (
            <Slider
              key={question.key}
              id={`post-${question.key}`}
              question={question}
              value={answers[question.key] ?? midpoint(question)}
              onChange={(value) => onAnswer(question.key, value)}
            />
          ))}
        </section>
      ) : null}

      {needsSummaryReading ? (
        <section className="ratings">
          <h2>The session as a whole</h2>
          <PercentSlider
            id="summary-reward"
            label="Time in reward"
            value={summaryReading.timeInRewardPercent}
            onChange={(value) =>
              onSummaryReading({ ...summaryReading, timeInRewardPercent: value })
            }
          />
          <PercentSlider
            id="summary-artefact"
            label="Artefact"
            value={summaryReading.artefactPercent}
            onChange={(value) => onSummaryReading({ ...summaryReading, artefactPercent: value })}
          />
          {summaryReadingTaken ? null : (
            <p className="note small">
              Leave these alone if you did not read them. Nothing is recorded until you move one.
            </p>
          )}
        </section>
      ) : null}

      <section>
        <h2 id="observations-heading">What did you see?</h2>
        <div className="chips" role="group" aria-labelledby="observations-heading">
          {OBSERVATION_CHIPS.map((chip) => {
            const on = observations.chips.includes(chip);
            return (
              <button
                key={chip}
                type="button"
                className={on ? 'chip chip--on' : 'chip'}
                aria-pressed={on}
                onClick={() => toggleChip(chip)}
              >
                {CHIP_LABELS[chip] ?? chip}
              </button>
            );
          })}
        </div>
        <div className="field">
          <label className="field__label" htmlFor="observation-note">
            Anything to add
          </label>
          <textarea
            id="observation-note"
            className="field__input field__input--area"
            rows={3}
            maxLength={1000}
            value={observations.note}
            onChange={(event) => onObservations({ ...observations, note: event.target.value })}
          />
        </div>
      </section>

      <div className="step__dock">
        <Button variant="primary" className="step__primary" onClick={onContinue}>
          See the summary
        </Button>
      </div>
    </div>
  );
}
