import { useState } from 'react';
import { joinE164, splitE164, stripTrunkPrefix } from '@domain/shared';
import { Field } from './Controls';
import { COUNTRIES, DIALLING_CODES, countryForDialling, type Country } from './countries';
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

  // The select is keyed and driven by ISO code, not by `diallingCode` itself:
  // ~25 rows share `+1`, four share `+44`, and a few others repeat too, so a
  // controlled `<select>` given a shared value resolves to the FIRST option
  // in document order — table order — which drew Guernsey's flag beside a
  // London number and snapped a chosen "United Kingdom" back to Guernsey the
  // moment the select closed. `countryForDialling` exists precisely to name
  // the one country a shared code should display as; `diallingCode` stays
  // the value `resolve`/the guard above work with (a dialling code, not a
  // country, is what E.164 actually stores), and this is purely a display
  // projection of it.
  const selectedIso = countryForDialling(diallingCode)?.iso ?? 'AE';

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

  function takeCountry(nextIso: string) {
    // The select hands back an ISO code (see `selectedIso` above); mapped
    // back to a dialling code here by a direct `.find` on `iso`, which is
    // unique per row — unlike a dialling code, an ISO code never needs
    // `countryForDialling`'s tie-breaking.
    const country = COUNTRIES.find((c) => c.iso === nextIso);
    if (!country) return;
    setDiallingCode(country.dialling);
    onChange(resolve(country.dialling, typed));
  }

  function takeNumber(nextTyped: string) {
    // The whole number, typed or pasted straight into this box, is the
    // likeliest single mistake this control invites: for months the number
    // lived in one free-text box, and `+971 50 000 1234` is exactly the habit
    // that box trained. Concatenated blindly with whatever the selector
    // already holds, that produces `+971971500001234` — fifteen digits,
    // still inside `isValidPhone`'s and the server's E.164 range, still
    // undialable, and nothing downstream refuses it (fix round finding 1,
    // 2026-09-12). A leading `+` is unambiguous, so it is the one shape this
    // control re-splits rather than concatenates: `splitE164` on the typed
    // text decides both halves at once, and the selector moves with the
    // number rather than staying wherever it happened to be. A code typed
    // WITHOUT the plus (`971500001234`) is left as plain digits and folded
    // onto whatever country is already selected — bare digits are ambiguous
    // (a national number can legitimately start with the same digits as a
    // dialling code) and guessing wrong there would silently attach the
    // number to a different country, the more dangerous failure. When the
    // text does not yet resolve to a complete number (`+9`, still being
    // typed) `splitE164` returns null and this falls through to the existing
    // behaviour unchanged, so an incomplete paste is never treated as if it
    // were a doomed match.
    const trimmed = nextTyped.trim();
    if (trimmed.startsWith('+')) {
      const split = splitE164(trimmed.replace(/\s/g, ''), DIALLING_CODES);
      if (split) {
        setDiallingCode(split.diallingCode);
        setTyped(split.national);
        onChange(resolve(split.diallingCode, split.national));
        return;
      }
    }
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
          value={selectedIso}
          disabled={disabled}
          onChange={(event) => takeCountry(event.target.value)}
        >
          {COUNTRIES.map((country) => (
            <option key={country.iso} value={country.iso}>
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
