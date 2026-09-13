import { useState } from 'react';
import { groupEmiratesIdDigits } from '@domain/shared';
import { Field } from '../../shell/components/Controls';

/**
 * An Emirates ID typed the way it's printed: `784-1900-1234567-1`, its
 * dashes appearing as they're earned rather than demanded up front. The
 * value in and out is the same grouped text this control shows on screen —
 * the enrolment wizard and the contact form each fold it to digits with
 * `toLatinDigits` and validate it with `validateEmiratesId` before sending,
 * exactly as they did before this control existed, so nothing about what
 * leaves the form changes here.
 *
 * That single representation is also why this control's resync guard is
 * simpler than `DateField`'s sibling one: `DateField` holds a `DD/MM/YYYY`
 * display next to a caller-facing ISO value and has to parse one to compare
 * it with the other, which is exactly how it once confused a parse's `null`
 * with an emitted `''` and wiped a box on a single Backspace. Here `typed`
 * and `value` are always the *same* grouped string — there is no parse step
 * to disagree with itself — so a plain `typed !== value` is the whole
 * comparison, and no `null`/`''` mismatch is possible.
 */
export function EmiratesIdField({
  id,
  label,
  value,
  onChange,
  hint,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string;
}) {
  const [typed, setTyped] = useState(value);
  const [priorValue, setPriorValue] = useState(value);

  // A value changed by the caller — a record loading, a form resetting — is
  // redrawn; a value the caller merely echoed back through this control's
  // own `onChange` is left alone, so the caret doesn't jump mid-edit. Done
  // during render rather than in an effect (react-hooks/set-state-in-effect
  // refuses a synchronous setState there): the documented "adjusting state
  // when a prop changes" pattern, keyed off a tracked prior value so it
  // fires only on an actual change.
  if (value !== priorValue) {
    setPriorValue(value);
    if (typed !== value) setTyped(value);
  }

  function take(next: string) {
    const grouped = groupEmiratesIdDigits(next);
    setTyped(grouped);
    onChange(grouped);
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
      placeholder="784-1900-1234567-1"
    />
  );
}
