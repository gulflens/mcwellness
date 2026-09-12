import { useRef, useState } from 'react';
import { displayFromIso, groupDateDigits, isoFromDisplay } from '@domain/shared';
import { Field } from './Controls';
import { CalendarIcon } from './Icons';

/**
 * A date typed the way this country writes one: `DD/MM/YYYY`, always, on every
 * machine. A native `<input type="date">` draws itself in the browser's locale
 * and the page has no say, so the visible box is text and the native control is
 * kept beside it, hidden, purely to lend its calendar.
 *
 * The value in and out is the ISO `YYYY-MM-DD` every caller already held, so a
 * screen swapping to this control changes one import and its `onChange` shape,
 * and nothing about what it sends.
 */
export function DateField({
  id,
  label,
  value,
  onChange,
  hint,
  error,
  min,
  max,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
}) {
  const [typed, setTyped] = useState(() => displayFromIso(value));
  const [priorValue, setPriorValue] = useState(value);
  const native = useRef<HTMLInputElement>(null);

  // What `typed` actually resolves to: `''` for an incomplete or impossible
  // date, exactly as `''` for one that parses but sits outside `min`/`max`
  // (Finding 4 — the bound used to reach only the hidden native input, so a
  // date typed straight into the text box could sit outside it and still be
  // emitted). Shared by the resync guard below and by `take`, so the two
  // never disagree about what a given `typed` string is worth.
  function resolve(display: string): string {
    const iso = isoFromDisplay(display);
    if (iso === null) return '';
    if (min !== undefined && iso < min) return '';
    if (max !== undefined && iso > max) return '';
    return iso;
  }

  // A value changed by the caller — a record loading, a form resetting — is
  // redrawn; a value the caller merely echoed back is left alone, so the caret
  // does not jump while someone is still typing. Done during render rather
  // than in an effect (react-hooks/set-state-in-effect refuses a synchronous
  // setState there): the documented "adjusting state when a prop changes"
  // pattern, keyed off a tracked prior value so this fires only on an actual
  // change and not on every render.
  //
  // Finding 1: this used to compare `isoFromDisplay(typed)` (`null` for an
  // incomplete date) directly against `value` (`''` once `take` empties it)
  // and read `null !== ''` as a real change, blanking a date mid-edit on the
  // very next backspace. Comparing `resolve(typed)` — which folds `null` to
  // `''` the same way `take` already does — against `value` compares like
  // with like.
  if (value !== priorValue) {
    setPriorValue(value);
    if (resolve(typed) !== value) setTyped(displayFromIso(value));
  }

  function take(next: string) {
    const grouped = groupDateDigits(next);
    setTyped(grouped);
    onChange(resolve(grouped));
  }

  function openPicker() {
    const element = native.current;
    if (element === null) return;
    if (typeof element.showPicker === 'function') {
      // Finding 3: a real browser's showPicker() can throw — SecurityError
      // with no user activation, NotAllowedError in a cross-origin frame —
      // and the press must still land on the same fallback rather than
      // propagate.
      try {
        element.showPicker();
        return;
      } catch {
        // Fall through to focus().
      }
    }
    element.focus();
  }

  return (
    <div className="datefield">
      <Field
        id={id}
        label={label}
        value={typed}
        onChange={(event) => take(event.target.value)}
        hint={hint}
        error={error}
        inputMode="numeric"
        autoComplete="off"
        placeholder="DD/MM/YYYY"
        disabled={disabled}
        className="datefield__text"
      />
      <button
        type="button"
        className="datefield__picker"
        aria-label={`${label}: open the calendar`}
        onClick={openPicker}
        disabled={disabled}
      >
        <CalendarIcon />
      </button>
      <input
        ref={native}
        type="date"
        className="datefield__native"
        tabIndex={-1}
        aria-hidden="true"
        value={value}
        min={min}
        max={max}
        onChange={(event) => {
          setTyped(displayFromIso(event.target.value));
          onChange(event.target.value);
        }}
      />
    </div>
  );
}
