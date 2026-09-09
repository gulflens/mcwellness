import { Button } from '../../shell/components/Controls';
import { Slider } from './Slider';
import { midpoint, type Answers, type ServiceSettings } from './steps';

/**
 * Pre-flight (docs/SPEC/session-capture.md section 3.2): the checklist the
 * practice set for this service as large toggles, then the before-session
 * questions on 0-to-10 sliders. One decision at the end of it — everything is
 * ready, or it is not.
 *
 * A practice that has set no checklist and no questions gets neither, and
 * the step is a single confirmation. That is deliberate: the settings are
 * data (service_type), and an empty setting is a valid one, not a gap to be
 * papered over with defaults invented here.
 *
 */

export function PreflightStep({
  service,
  checked,
  onToggle,
  answers,
  onAnswer,
  onContinue,
}: {
  service: ServiceSettings;
  checked: Readonly<Record<string, boolean>>;
  onToggle: (key: string, done: boolean) => void;
  answers: Answers;
  onAnswer: (key: string, value: number) => void;
  onContinue: () => void;
}) {
  const outstanding = service.preflightChecklist.filter((item) => !checked[item.key]);

  return (
    <div className="step">
      <h1>Before you start</h1>

      {service.preflightChecklist.length === 0 ? (
        <p className="note">This service has no checklist set.</p>
      ) : (
        <ul className="checks">
          {service.preflightChecklist.map((item) => (
            <li key={item.key}>
              <label className="check">
                <input
                  type="checkbox"
                  className="check__input"
                  checked={checked[item.key] ?? false}
                  onChange={(event) => onToggle(item.key, event.target.checked)}
                />
                <span className="check__box" aria-hidden="true" />
                <span className="check__label">{item.labelEn}</span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {service.ratingQuestions.length > 0 ? (
        <section className="ratings">
          <h2>How are they today?</h2>
          {service.ratingQuestions.map((question) => (
            <Slider
              key={question.key}
              id={`pre-${question.key}`}
              question={question}
              value={answers[question.key] ?? midpoint(question)}
              onChange={(value) => onAnswer(question.key, value)}
            />
          ))}
        </section>
      ) : null}

      <div className="step__dock">
        {outstanding.length > 0 ? (
          <p className="note small">
            {outstanding.length === 1
              ? 'One item is still outstanding.'
              : `${outstanding.length} items are still outstanding.`}
          </p>
        ) : null}
        <Button variant="primary" className="step__primary" onClick={onContinue}>
          Check the signal
        </Button>
      </div>
    </div>
  );
}
