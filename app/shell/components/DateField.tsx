import { useRef, useState } from 'react';
import { displayFromIso, groupDateDigits, isoFromDisplay } from '@domain/shared';
import { CalendarPanel } from './CalendarPanel';
import { bound, todayParts, type DateParts } from './calendar';
import { Field } from './Controls';
import { CalendarIcon } from './Icons';

/**
 * A date typed the way this country writes one: `DD/MM/YYYY`, always, on every
 * machine. A native `<input type="date">` draws itself in the browser's locale
 * and the page has no say, so the visible box is text.
 *
 * The calendar button opens `CalendarPanel`, drawn in the page. Until round 48
 * it opened the browser's own picker from a hidden native input, and on Safari
 * that picker fell off the outer edge of a right-docked drawer and was clipped
 * — a native picker's panel has no CSS surface in any browser, so there was
 * nothing to move and nothing to restyle. The whole native control is gone.
 *
 * Typing is unchanged and is still the primary way in; the calendar is an
 * alternative, not a replacement. The value in and out is the ISO `YYYY-MM-DD`
 * every caller already held.
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
  // Today as read from the clock at the moment the calendar was opened, and
  // `null` while it is shut. One piece of state rather than two, and the only
  // place the clock is read: a component that asked the clock while rendering
  // would be impure, and a calendar that recomputed "today" on every keystroke
  // could move its own hairline mid-session.
  const [openedOn, setOpenedOn] = useState<DateParts | null>(null);
  const field = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // What `typed` resolves to for *emission*: `''` for an incomplete or
  // impossible date, or for one that parses but sits outside `min`/`max`
  // (Finding 4 — the bound used to reach only the hidden native input, so a
  // date typed straight into the text box could sit outside it and still be
  // emitted). `min`/`max` are checked for truthiness rather than
  // definedness: both are legal as `''` (exactly what an unset from/to
  // range bound to component state holds before anything is picked), and
  // `iso > ''` is true for every date, so a definedness check would refuse
  // every typed date once a caller wired up an empty-string bound.
  //
  // Used by `take` only. The resync guard below asks a different question —
  // "has the caller's value changed under me", not "is the typed text
  // currently valid" — so it parses `typed` on its own rather than through
  // this bound-aware helper: folding the two together meant a value loaded
  // outside `min`/`max` and then genuinely reset to `''` left the stale,
  // out-of-bounds date on screen, because `resolve(typed)` was already `''`
  // and read as matching the new, equally empty `value`.
  function resolve(display: string): string {
    const iso = isoFromDisplay(display);
    if (iso === null) return '';
    if (min && iso < min) return '';
    if (max && iso > max) return '';
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
  // A parse-only comparison, not `resolve(typed)`: this used to compare
  // `isoFromDisplay(typed)` (`null` for an incomplete date) directly against
  // `value` (`''` once `take` empties it) and read `null !== ''` as a real
  // change, blanking a date mid-edit on the very next backspace. Folding in
  // `?? ''` fixes that without pulling in the bound check `resolve` also
  // does — see the comment on `resolve` for why the two must stay apart.
  if (value !== priorValue) {
    setPriorValue(value);
    if ((isoFromDisplay(typed) ?? '') !== value) setTyped(displayFromIso(value));
  }

  function take(next: string) {
    const grouped = groupDateDigits(next);
    setTyped(grouped);
    onChange(resolve(grouped));
  }

  function dismiss(returnFocus: boolean) {
    // Focus is moved before the panel unmounts: a focused element that is
    // removed leaves focus on the body, and the button would never get it.
    if (returnFocus) trigger.current?.focus();
    setOpenedOn(null);
  }

  function choose(iso: string) {
    setTyped(displayFromIso(iso));
    onChange(iso);
    dismiss(true);
  }

  return (
    <div className="datefield" ref={field}>
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
        ref={trigger}
        type="button"
        className="datefield__picker"
        aria-label={`${label}: open the calendar`}
        aria-expanded={openedOn !== null}
        onClick={() => setOpenedOn(openedOn === null ? todayParts() : null)}
        disabled={disabled}
      >
        <CalendarIcon />
      </button>
      {openedOn === null ? null : (
        <CalendarPanel
          label={label}
          value={value}
          today={openedOn}
          min={bound(min)}
          max={bound(max)}
          field={field}
          trigger={trigger}
          onChoose={choose}
          onDismiss={dismiss}
        />
      )}
    </div>
  );
}
