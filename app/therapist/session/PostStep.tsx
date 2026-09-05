import { useRef } from 'react';
import { OBSERVATION_CHIPS } from '@domain/session';
import { Button } from '../../shell/components/Controls';
import { PercentSlider, Slider } from './Slider';
import {
  midpoint,
  type Answers,
  type Observations,
  type PhotoConsent,
  type PhotoState,
  type Reading,
  type ServiceSettings,
} from './steps';

/**
 * End and post (docs/SPEC/session-capture.md section 3.5): the same
 * questions as before, the structured observations as chips with a note
 * beside them, and what became of the setup photo.
 *
 * The photo has three states, not two. `given` offers the camera; `refused`
 * says the household has not agreed; `unknown` — a visit resumed with no
 * signal — says the device cannot check, because telling a practitioner a
 * family refused something nobody has asked them is a lie about a person.
 * Only `given` shows the control (docs/SPEC/practitioner-phone.md section
 * 4.1); the wording above it does not change in any of the three, because the
 * promise the practice makes about what is photographed is the same promise
 * whether or not a picture is taken.
 *
 * The picture never waits for the network. It is shrunk and digested on the
 * device, the `photo_captured` event is queued, and the bytes follow the event
 * through the outbox — so a photograph taken in a basement is kept exactly as
 * a rating is, and the line below says so rather than showing a spinner.
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

const PHOTO_PROMISE = 'The sensor placement only: not the face, and not the room.';
const PHOTO_REFUSED =
  'This household has not agreed to photographs, so no photo can be taken. The practice can ask them.';
const PHOTO_UNKNOWN =
  'This device cannot check whether the household has agreed to photographs until it is back online.';
const PHOTO_TAKEN = 'Kept on this device. It goes when the visit has synced.';
const PHOTO_FAILED =
  'That picture could not be prepared on this device. Try again, or carry on without one.';

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
  photoConsent,
  photo,
  onPhoto,
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
  photoConsent: PhotoConsent;
  photo: PhotoState;
  onPhoto: (file: File) => void;
  onContinue: () => void;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
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

      <section>
        <h2>Setup photo</h2>
        <p className="note small">{PHOTO_PROMISE}</p>
        {photoConsent === 'given' ? (
          <>
            {/*
              `capture="environment"` asks the rear camera directly, which is
              the one pointed at the electrodes. A device without one falls
              back to its own picker, which is the right degradation: the
              practitioner still gets a photograph in.
            */}
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="visually-hidden"
              aria-label="Take the setup photo"
              onChange={(event) => {
                const file = event.target.files?.[0];
                // The value is cleared so choosing the same file twice still
                // fires: a retake of an identical picture is a real thing.
                event.target.value = '';
                if (file) onPhoto(file);
              }}
            />
            <Button
              onClick={() => cameraRef.current?.click()}
              disabled={photo.kind === 'preparing'}
            >
              {photo.kind === 'kept' ? 'Take it again' : 'Take the photo'}
            </Button>
            <p className="note small" role="status">
              {photo.kind === 'kept'
                ? PHOTO_TAKEN
                : photo.kind === 'failed'
                  ? PHOTO_FAILED
                  : photo.kind === 'preparing'
                    ? 'Preparing the picture.'
                    : ''}
            </p>
          </>
        ) : (
          <p className="note small">{photoConsent === 'refused' ? PHOTO_REFUSED : PHOTO_UNKNOWN}</p>
        )}
      </section>

      <div className="step__dock">
        <Button variant="primary" className="step__primary" onClick={onContinue}>
          See the summary
        </Button>
      </div>
    </div>
  );
}
