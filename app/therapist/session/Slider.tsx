import type { RatingQuestion } from '../../api/sessions/schema';

/**
 * One 0-to-10 question (docs/SPEC/session-capture.md sections 3.2 and 3.5):
 * the practice's own wording, the Arabic beneath it, a wide track and the
 * value large enough to read at arm's length.
 *
 * The Arabic label is on the wire already (service_type.rating_questions
 * carries `label_ar`) and the day sheet renders Arabic beside English
 * everywhere else; the runner had been dropping it. Marked `lang` and `dir`
 * so it is shaped and read correctly rather than laid out as though it were
 * English (docs/DESIGN-BRIEF.md section 4.1).
 */
export function Slider({
  id,
  question,
  value,
  onChange,
}: {
  id: string;
  question: RatingQuestion;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="rating">
      <label className="rating__label" htmlFor={id}>
        {question.labelEn}
      </label>
      {question.labelAr ? (
        <span className="rating__label-ar small muted" lang="ar" dir="rtl">
          {question.labelAr}
        </span>
      ) : null}
      <div className="rating__row">
        <input
          id={id}
          type="range"
          className="rating__slider"
          min={question.min}
          max={question.max}
          step={1}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <output className="rating__value numeric" htmlFor={id}>
          {value}
        </output>
      </div>
    </div>
  );
}

/** The same control for a plain 0-to-100 reading, which has no practice wording. */
export function PercentSlider({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Slider
      id={id}
      question={{ key: id, labelEn: label, labelAr: '', min: 0, max: 100 }}
      value={value}
      onChange={onChange}
    />
  );
}
