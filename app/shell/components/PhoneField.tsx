import { useState } from 'react';
import { joinE164, splitE164, stripTrunkPrefix } from '@domain/shared';
import { Field } from './Controls';
import { COUNTRIES, DIALLING_CODES, type Country } from './countries';
import { flagsRender } from './flagSupport';

/**
 * A phone number as this control reads it: a country and the rest of it, one
 * row. `domain/shared`'s `splitE164`/`joinE164`/`stripTrunkPrefix` already
 * carry every rule about what a stored number means (see their docstrings);
 * this control's only job is to wear them — hold the two halves the person
 * sees, and turn every edit of either one back into the single E.164 string
 * a caller's `value`/`onChange` already speaks.
 */

/**
 * The only countries a locally-written trunk zero is stripped for. `joinE164`
 * is pure composition and never strips one itself — some countries'
 * national significant numbers legitimately keep a leading zero inside
 * E.164 (Italian mobiles are the standing example), and `joinE164` cannot
 * tell such a number apart from a UAE one someone forgot to trim. Stripping
 * is therefore this control's decision, and only for the handful of
 * countries the practice actually serves — for now, the GCC.
 *
 * The asymmetry that makes an explicit allow-list the only safe default:
 * under-stripping (a country left out that should strip) yields a number
 * with one digit too many, the server's E.164 check constraint refuses it
 * outright, and the operator notices and fixes it on the spot. Over-stripping
 * (a country stripped that should not) yields a number that is shorter, still
 * matches the constraint, still *looks* plausible, and quietly reaches a
 * different subscriber — nobody notices until it is someone's problem. A
 * missing country therefore fails loudly; a wrongly-added one fails
 * silently. Never add a country here on a guess.
 */
const STRIP_TRUNK_ZERO_FOR: readonly string[] = ['+971', '+966', '+974', '+973', '+965', '+968'];

function optionLabel(country: Country): string {
  return flagsRender()
    ? `${country.flag} ${country.dialling}`
    : `${country.iso} ${country.dialling}`;
}

/**
 * What this control emits for a given country and typed national number —
 * the one function both `onChange` and the resync guard below call, so the
 * two always speak the same representation of "nothing typed yet" (`''`).
 * A guard that computed this a different way (say, comparing the raw split
 * instead of this resolved string) could disagree with `onChange` about what
 * counts as empty and wipe a box mid-edit — the exact shape of bug this
 * control's sibling, `DateField`, shipped once already.
 */
function resolve(diallingCode: string, national: string): string {
  const stripped = STRIP_TRUNK_ZERO_FOR.includes(diallingCode)
    ? stripTrunkPrefix(national)
    : national;
  return joinE164(diallingCode, stripped);
}

export function PhoneField({
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
  const initial = splitE164(value, DIALLING_CODES);
  const [diallingCode, setDiallingCode] = useState(initial?.diallingCode ?? '+971');
  const [typed, setTyped] = useState(initial?.national ?? '');
  const [priorValue, setPriorValue] = useState(value);
  const countryId = `${id}-country`;

  // A value changed by the caller — a record loading, a form resetting — is
  // redrawn; a value this control merely echoed back through its own
  // `onChange` is left alone, so neither half jumps while someone is still
  // typing. Done during render, not an effect (react-hooks/set-state-in-effect
  // refuses a synchronous setState there): the documented "adjusting state
  // when a prop changes" pattern, keyed off a tracked prior value so this
  // fires only on an actual change.
  //
  // The comparison calls `resolve` — the exact function `onChange` itself
  // calls — rather than re-deriving "what did I just emit" some other way.
  // `resolve` always returns a definite string (`''` for no digits, the full
  // E.164 form otherwise; never `null`), so there is no second
  // representation of "empty" for this comparison to disagree with the one
  // `onChange` used. Comparing anything else here — the raw `typed` text, or
  // a `splitE164` of the current `value` — would reintroduce exactly the
  // trap `DateField` hit: two different spellings of "not complete yet"
  // read as a real change and the box gets wiped on the next keystroke.
  if (value !== priorValue) {
    setPriorValue(value);
    if (resolve(diallingCode, typed) !== value) {
      const split = splitE164(value, DIALLING_CODES);
      setDiallingCode(split?.diallingCode ?? '+971');
      setTyped(split?.national ?? '');
    }
  }

  function takeCountry(nextDialling: string) {
    setDiallingCode(nextDialling);
    onChange(resolve(nextDialling, typed));
  }

  function takeNumber(nextTyped: string) {
    setTyped(nextTyped);
    onChange(resolve(diallingCode, nextTyped));
  }

  return (
    <div className="phonefield">
      <span className="phonefield__code">
        <label htmlFor={countryId} className="visually-hidden">
          {label}: country code
        </label>
        <select
          id={countryId}
          className="field__input"
          value={diallingCode}
          disabled={disabled}
          onChange={(event) => takeCountry(event.target.value)}
        >
          {COUNTRIES.map((country) => (
            <option key={country.iso} value={country.dialling}>
              {optionLabel(country)}
            </option>
          ))}
        </select>
      </span>
      <Field
        id={id}
        label={label}
        value={typed}
        onChange={(event) => takeNumber(event.target.value)}
        hint={hint}
        error={error}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        disabled={disabled}
        className="phonefield__number"
      />
    </div>
  );
}
