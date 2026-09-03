import { useRef, useState } from 'react';
import { OBSERVATION_CHIPS } from '@domain/session';
import { Button } from '../../shell/components/Controls';
import { preparePhoto, type PreparedPhoto } from './photo';
import type { Answers, Observations, Reading, ServiceSettings } from './steps';

/**
 * End and post (docs/SPEC/session-capture.md section 3.5): the same
 * questions as before, the structured observations as chips with a note
 * beside them, and the optional setup photo.
 *
 * The photo is offered only when the household's `photo_video` consent is
 * active, and when it is not the screen says so plainly rather than hiding
 * the control and leaving the practitioner wondering. The server refuses one
 * either way (app/api/sessions/events.ts): the screen is the courtesy, the
 * database is the boundary.
 *
 * The summary reading appears only when nothing was recorded during the run
 * — section 3.4's "Phase 1 accepts a single end-of-session summary if
 * per-minute data isn't available".
 */

const CHIP_LABELS: Record<string, string> = {
  none: 'Nothing to note',
  headache: 'Headache',
  fatigue: 'Fatigue',
  irritability: 'Irritability',
  other: 'Something else',
};

const PHOTO_BLOCKED =
  'This household has not agreed to photographs, so no photo can be taken. The practice can ask them.';

export function PostStep({
  service,
  answers,
  onAnswer,
  observations,
  onObservations,
  needsSummaryReading,
  summaryReading,
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
  onSummaryReading: (reading: Reading) => void;
  photoConsent: boolean;
  photo: PreparedPhoto | null;
  onPhoto: (photo: PreparedPhoto | null) => void;
  onContinue: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [photoNote, setPhotoNote] = useState<string | null>(null);

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

  const takePhoto = async (file: File | undefined) => {
    if (!file) return;
    const prepared = await preparePhoto(file);
    if (!prepared) {
      setPhotoNote('That photo could not be prepared on this device. Try again.');
      return;
    }
    setPhotoNote(null);
    onPhoto(prepared);
  };

  return (
    <div className="step">
      <h1>After the session</h1>

      {service.ratingQuestions.length > 0 ? (
        <section className="ratings">
          {service.ratingQuestions.map((question) => (
            <div className="rating" key={question.key}>
              <label className="rating__label" htmlFor={`post-${question.key}`}>
                {question.labelEn}
              </label>
              <div className="rating__row">
                <input
                  id={`post-${question.key}`}
                  type="range"
                  className="rating__slider"
                  min={question.min}
                  max={question.max}
                  step={1}
                  value={answers[question.key] ?? Math.round((question.min + question.max) / 2)}
                  onChange={(event) => onAnswer(question.key, Number(event.target.value))}
                />
                <output className="rating__value numeric" htmlFor={`post-${question.key}`}>
                  {answers[question.key] ?? Math.round((question.min + question.max) / 2)}
                </output>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {needsSummaryReading ? (
        <section className="ratings">
          <h2>The session as a whole</h2>
          <div className="rating">
            <label className="rating__label" htmlFor="summary-reward">
              Time in reward
            </label>
            <div className="rating__row">
              <input
                id="summary-reward"
                type="range"
                className="rating__slider"
                min={0}
                max={100}
                step={5}
                value={summaryReading.timeInRewardPercent}
                onChange={(event) =>
                  onSummaryReading({
                    ...summaryReading,
                    timeInRewardPercent: Number(event.target.value),
                  })
                }
              />
              <output className="rating__value numeric" htmlFor="summary-reward">
                {summaryReading.timeInRewardPercent}
              </output>
            </div>
          </div>
          <div className="rating">
            <label className="rating__label" htmlFor="summary-artefact">
              Artefact
            </label>
            <div className="rating__row">
              <input
                id="summary-artefact"
                type="range"
                className="rating__slider"
                min={0}
                max={100}
                step={5}
                value={summaryReading.artefactPercent}
                onChange={(event) =>
                  onSummaryReading({
                    ...summaryReading,
                    artefactPercent: Number(event.target.value),
                  })
                }
              />
              <output className="rating__value numeric" htmlFor="summary-artefact">
                {summaryReading.artefactPercent}
              </output>
            </div>
          </div>
        </section>
      ) : null}

      <section>
        <h2>What did you see?</h2>
        <div className="chips">
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
        {photoConsent ? (
          <>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              capture="environment"
              className="visually-hidden"
              onChange={(event) => void takePhoto(event.target.files?.[0])}
            />
            <Button className="step__secondary" onClick={() => fileInput.current?.click()}>
              {photo ? 'Take it again' : 'Take a photo'}
            </Button>
            {photo ? (
              <p className="note small">
                Photo ready, <span className="numeric">{Math.round(photo.sizeBytes / 1024)}</span>{' '}
                kB.
              </p>
            ) : null}
            {photoNote ? <p className="note note--critical small">{photoNote}</p> : null}
          </>
        ) : (
          <p className="note small">{PHOTO_BLOCKED}</p>
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
