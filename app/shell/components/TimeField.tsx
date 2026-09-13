import { useState } from 'react';
import { groupTimeDigits, isValidTime } from '@domain/shared';
import { Field } from './Controls';

/**
 * A time on a twenty-four hour clock, typed. `Asia/Dubai` never shifts, so a
 * wall-clock time needs no zone beside it; what it must never carry is a
 * meridiem, which a native `<input type="time">` shows wherever the browser's
 * locale asks for one. Value in and out is `HH:MM`, unchanged.
 */
export function TimeField({
  id,
  label,
  value,
  onChange,
  hint,
  error,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string;
  disabled?: boolean;
}) {
  const [typed, setTyped] = useState(value);
  const [priorValue, setPriorValue] = useState(value);

  // What `typed` actually resolves to: `''` for anything short of a
  // complete twenty-four hour time. Shared by the resync guard below and by
  // `take`, so the two never disagree about what a given `typed` string is
  // worth.
  function resolve(display: string): string {
    return isValidTime(display) ? display : '';
  }

  // Done during render rather than in an effect
  // (react-hooks/set-state-in-effect refuses a synchronous setState there):
  // the documented "adjusting state when a prop changes" pattern, keyed off a
  // tracked prior value so this fires only on an actual change and not on
  // every render.
  //
  // Finding 1: this used to compare `typed` (still `'14:3'` mid-edit)
  // directly against `value` (`''` once `take` empties it) and read that as
  // a real change, blanking a time mid-edit on the very next backspace.
  // Comparing `resolve(typed)` — which folds an incomplete time to `''` the
  // same way `take` already does — against `value` compares like with like.
  if (value !== priorValue) {
    setPriorValue(value);
    if (resolve(typed) !== value) setTyped(value);
  }

  function take(next: string) {
    const grouped = groupTimeDigits(next);
    setTyped(grouped);
    onChange(resolve(grouped));
  }

  return (
    <Field
      id={id}
      label={label}
      value={typed}
      onChange={(event) => take(event.target.value)}
      hint={hint}
      error={error}
      inputMode="numeric"
      autoComplete="off"
      placeholder="HH:MM"
      disabled={disabled}
    />
  );
}
