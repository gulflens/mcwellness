import type { RatingQuestion } from '../../api/sessions/schema';

/**
 * One 0-to-10 question (docs/SPEC/session-capture.md sections 3.2 and 3.5):
 * the practice's own wording, a wide track and the value large enough to read
 * at arm's length.
 *
 * English only, on purpose. The Arabic label is on the wire already
 * (service_type.rating_questions carries `label_ar`) and `RatingQuestion`
 * still carries it, but the practitioner app is a staff tool and staff tools
 * are English (operator's decision of 7 September 2026, docs/DESIGN-BRIEF.md
 * section 10 item 4). What a household reads — the portal, the reports, the
 * documents — is still bilingual.
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
