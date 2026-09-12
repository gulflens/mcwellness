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

  // A value changed by the caller — a record loading, a form resetting — is
  // redrawn; a value the caller merely echoed back is left alone, so the caret
  // does not jump while someone is still typing. Done during render rather
  // than in an effect (react-hooks/set-state-in-effect refuses a synchronous
  // setState there): the documented "adjusting state when a prop changes"
  // pattern, keyed off a tracked prior value so this fires only on an actual
  // change and not on every render.
  if (value !== priorValue) {
    setPriorValue(value);
    if (isoFromDisplay(typed) !== value) setTyped(displayFromIso(value));
  }

  function take(next: string) {
    const grouped = groupDateDigits(next);
    setTyped(grouped);
    onChange(isoFromDisplay(grouped) ?? '');
  }

  function openPicker() {
    const element = native.current;
    if (element === null) return;
    if (typeof element.showPicker === 'function') {
      element.showPicker();
      return;
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
