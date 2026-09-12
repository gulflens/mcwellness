# UAE formats (round 47) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every box in the console that takes a date, a time or a phone number uses the practice's own formats — `DD/MM/YYYY`, twenty-four hour, and a split country-code control — and the enrolment wizard groups an Emirates ID as it is typed inside a drawer whose width the operator can drag and keep.

**Architecture:** Three new controls in `app/shell/components/` wrap the existing `Field`, so label, hint, error and `aria-describedby` wiring is inherited rather than rebuilt. Each control speaks the exact string its predecessor spoke — ISO for dates, `HH:MM` for times, E.164 for phones — so all thirty-three call sites are one-line import swaps and no route, schema or database test moves. Every rule about what a value *means* is a pure, total function in `domain/shared/`, written test-first; the components hold only drawing and caret behaviour.

**Tech Stack:** TypeScript, React 18, Vite, Vitest + Testing Library (`environment: 'node'` with jsdom per-file), Prettier, ESLint.

**Spec:** `docs/superpowers/specs/2026-09-12-uae-formats-design.md` (commit `f4087ff`)

## Global Constraints

- **Synthetic identifiers only.** Emirates IDs must be in the `784-1900-*` range; UAE mobiles must be `+971 50 000 xxxx`. `.claude/hooks/no-real-identifiers.sh` blocks `Write`/`Edit` that violate this — but **not** shell heredocs, so never write fixtures with `cat >`.
- **No hex literals in components.** Colour comes only from `app/shell/tokens.css` (`CLAUDE.md`, visual system).
- **Console is English only.** No `lang="ar"` or `dir="rtl"` in `app/admin` or `app/therapist`; `tests/lint/console-is-english.test.ts` enforces it.
- **`domain/shared/**` is browser-safe.** No Node built-in may be imported, directly or transitively. `tests/lint/no-node-imports-in-browser-bundle.test.ts` walks the real import graph.
- **Business rules live in `domain/` as pure functions with tests written first** (`CLAUDE.md` rule 4).
- **Money is integer fils; VAT is computed, never typed.** Not touched by this round, but do not disturb.
- **Run `pnpm verify` before declaring work done.** It is `format:check && lint && typecheck && audit:secrets && audit:migrations && test`, and **prettier fails first**, so run `npx prettier --write .` before verifying.
- **No migration, no policy file, no API route in this round.**
- **Do not alter `formatEmiratesId` or `normaliseEmiratesId`.** `domain/shared/identity.ts` derives the keyed fingerprint and seal from their strictness.

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `domain/shared/dates.ts` (extend) | Date and time masking, parsing, validity — pure |
| `domain/shared/dates.test.ts` (extend) | Their tests |
| `domain/shared/phone.ts` | Split/join E.164, national-prefix rule — pure |
| `domain/shared/phone.test.ts` | Its tests |
| `app/shell/components/DateField.tsx` | The masked date box and its calendar button |
| `app/shell/components/DateField.test.tsx` | Its tests |
| `app/shell/components/TimeField.tsx` | The masked twenty-four-hour box |
| `app/shell/components/TimeField.test.tsx` | Its tests |
| `app/shell/components/PhoneField.tsx` | The split country-code + number control |
| `app/shell/components/PhoneField.test.tsx` | Its tests |
| `app/shell/components/countries.ts` | ISO code, name, dialling code, flag — presentation data |
| `app/shell/components/flagSupport.ts` | The one-time emoji-flag probe |
| `app/shell/components/useDrawerWidth.ts` | Read, clamp and persist the drawer width |
| `app/shell/components/useDrawerWidth.test.ts` | Its tests |
| `app/shell/components/DrawerResizeHandle.tsx` | The grab strip and its keyboard behaviour |
| `app/admin/clients/EmiratesIdField.tsx` | The grouped identity-number box |
| `tests/lint/dates-and-times-use-the-controls.test.ts` | Guard: no raw `type="date"`/`type="time"` |

**Modified:** `domain/shared/emirates-id.ts` and its test (add `groupEmiratesIdDigits`); `domain/shared/index.ts` (barrel exports); the twenty-six date sites, two time sites and five phone sites listed in Tasks 4 and 9; `app/admin/clients/clients.css` (rhythm); `app/shell/shell.css` (handle); `app/shell/tokens.css` (width variable); `app/admin/clients/EnrolmentWizard.tsx` and `ContactForm.tsx` (hints, identity field).

---

## Task 1: The date rules, as pure functions

**Files:**
- Modify: `domain/shared/dates.ts`
- Test: `domain/shared/dates.test.ts`

**Interfaces:**
- Consumes: `IsoDate` from `./actor`; `toLatinDigits` from `./emirates-id`
- Produces: `groupDateDigits(input: string): string`, `isRealDate(year: number, month: number, day: number): boolean`, `isoFromDisplay(display: string): string | null`, `displayFromIso(iso: string): string`

- [ ] **Step 1: Write the failing tests**

Append to `domain/shared/dates.test.ts`:

```ts
import { displayFromIso, groupDateDigits, isRealDate, isoFromDisplay } from './dates';

describe('groupDateDigits', () => {
  it('inserts the slashes as the digits arrive', () => {
    expect(groupDateDigits('')).toBe('');
    expect(groupDateDigits('1')).toBe('1');
    expect(groupDateDigits('12')).toBe('12');
    expect(groupDateDigits('120')).toBe('12/0');
    expect(groupDateDigits('1209')).toBe('12/09');
    expect(groupDateDigits('12091988')).toBe('12/09/1988');
  });

  it('reads the digits through whatever separators arrive, and folds Arabic-Indic', () => {
    expect(groupDateDigits('12/09/1988')).toBe('12/09/1988');
    expect(groupDateDigits('12-09-1988')).toBe('12/09/1988');
    expect(groupDateDigits('١٢٠٩١٩٨٨')).toBe('12/09/1988');
  });

  it('never exceeds eight digits', () => {
    expect(groupDateDigits('120919889999')).toBe('12/09/1988');
  });
});

describe('isRealDate', () => {
  it('accepts a day the calendar has', () => {
    expect(isRealDate(1988, 9, 12)).toBe(true);
    expect(isRealDate(2024, 2, 29)).toBe(true);
  });

  it('refuses a day it does not', () => {
    expect(isRealDate(2026, 2, 31)).toBe(false);
    expect(isRealDate(2026, 2, 29)).toBe(false);
    expect(isRealDate(2026, 13, 1)).toBe(false);
    expect(isRealDate(2026, 0, 1)).toBe(false);
    expect(isRealDate(2026, 4, 31)).toBe(false);
  });
});

describe('isoFromDisplay and displayFromIso', () => {
  it('turns a complete typed date into the stored form', () => {
    expect(isoFromDisplay('12/09/1988')).toBe('1988-09-12');
  });

  it('gives null while the date is incomplete or impossible', () => {
    expect(isoFromDisplay('')).toBe(null);
    expect(isoFromDisplay('12/09/19')).toBe(null);
    expect(isoFromDisplay('31/02/2026')).toBe(null);
  });

  it('turns a stored date back into the typed form, and survives a round trip', () => {
    expect(displayFromIso('1988-09-12')).toBe('12/09/1988');
    expect(displayFromIso('')).toBe('');
    expect(isoFromDisplay(displayFromIso('1988-09-12'))).toBe('1988-09-12');
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run domain/shared/dates.test.ts`
Expected: FAIL — `groupDateDigits is not a function` (and the same for the other three).

- [ ] **Step 3: Implement**

Append to `domain/shared/dates.ts`:

```ts
import { toLatinDigits } from './emirates-id';

const DATE_DIGITS = 8;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Every digit in the input, Arabic-Indic folded, capped at the eight a date has. */
function dateDigitsOf(input: string): string {
  return toLatinDigits(input).replace(/[^0-9]/g, '').slice(0, DATE_DIGITS);
}

/**
 * The typed form, grouped as far as the digits reach: `12`, `12/0`, `12/09/1988`.
 * Total — it never throws, because it formats a date that is still being typed.
 */
export function groupDateDigits(input: string): string {
  const d = dateDigitsOf(input);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

/** Whether the calendar actually has that day, leap years included. */
export function isRealDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const limit = month === 2 && leap ? 29 : (DAYS_IN_MONTH[month - 1] ?? 0);
  return day <= limit;
}

/** `12/09/1988` to `1988-09-12`, and null while it is incomplete or impossible. */
export function isoFromDisplay(display: string): string | null {
  const d = dateDigitsOf(display);
  if (d.length !== DATE_DIGITS) return null;
  const day = Number(d.slice(0, 2));
  const month = Number(d.slice(2, 4));
  const year = Number(d.slice(4));
  if (!isRealDate(year, month, day)) return null;
  return `${d.slice(4)}-${d.slice(2, 4)}-${d.slice(0, 2)}`;
}

/** `1988-09-12` to `12/09/1988`. An empty value stays empty. */
export function displayFromIso(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match === null) return '';
  return `${match[3]}/${match[2]}/${match[1]}`;
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run domain/shared/dates.test.ts`
Expected: PASS.

- [ ] **Step 5: Export from the barrel**

In `domain/shared/index.ts`, replace the `./dates` export line (or add one if absent) with:

```ts
export { ageOn, displayFromIso, groupDateDigits, isRealDate, isoFromDisplay } from './dates';
```

- [ ] **Step 6: Commit**

```bash
npx prettier --write domain/shared/dates.ts domain/shared/dates.test.ts domain/shared/index.ts
git add domain/shared/dates.ts domain/shared/dates.test.ts domain/shared/index.ts
git commit -m "feat(dates): the typed date's rules, as pure functions"
```

---

## Task 2: The time rules, as pure functions

**Files:**
- Modify: `domain/shared/dates.ts`
- Test: `domain/shared/dates.test.ts`

**Interfaces:**
- Consumes: `toLatinDigits`, `dateDigitsOf`'s sibling pattern from Task 1
- Produces: `groupTimeDigits(input: string): string`, `isValidTime(display: string): boolean`

- [ ] **Step 1: Write the failing tests**

Append to `domain/shared/dates.test.ts`:

```ts
import { groupTimeDigits, isValidTime } from './dates';

describe('groupTimeDigits', () => {
  it('inserts the colon as the digits arrive', () => {
    expect(groupTimeDigits('')).toBe('');
    expect(groupTimeDigits('1')).toBe('1');
    expect(groupTimeDigits('14')).toBe('14');
    expect(groupTimeDigits('143')).toBe('14:3');
    expect(groupTimeDigits('1430')).toBe('14:30');
  });

  it('reads through separators, folds Arabic-Indic, and stops at four digits', () => {
    expect(groupTimeDigits('14:30')).toBe('14:30');
    expect(groupTimeDigits('١٤٣٠')).toBe('14:30');
    expect(groupTimeDigits('143099')).toBe('14:30');
  });
});

describe('isValidTime', () => {
  it('accepts a twenty-four hour wall clock', () => {
    expect(isValidTime('00:00')).toBe(true);
    expect(isValidTime('14:30')).toBe(true);
    expect(isValidTime('23:59')).toBe(true);
  });

  it('refuses anything the clock does not have', () => {
    expect(isValidTime('24:00')).toBe(false);
    expect(isValidTime('14:60')).toBe(false);
    expect(isValidTime('14:3')).toBe(false);
    expect(isValidTime('')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run domain/shared/dates.test.ts -t 'Time'`
Expected: FAIL — `groupTimeDigits is not a function`.

- [ ] **Step 3: Implement**

Append to `domain/shared/dates.ts`:

```ts
const TIME_DIGITS = 4;

/** The typed time, grouped as far as the digits reach: `14`, `14:3`, `14:30`. Total. */
export function groupTimeDigits(input: string): string {
  const d = toLatinDigits(input).replace(/[^0-9]/g, '').slice(0, TIME_DIGITS);
  if (d.length <= 2) return d;
  return `${d.slice(0, 2)}:${d.slice(2)}`;
}

/** A complete twenty-four hour wall clock, `00:00` to `23:59`. No meridiem anywhere. */
export function isValidTime(display: string): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(display);
  if (match === null) return false;
  return Number(match[1]) <= 23 && Number(match[2]) <= 59;
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run domain/shared/dates.test.ts`
Expected: PASS (Task 1's tests still green).

- [ ] **Step 5: Export from the barrel**

Extend the `./dates` line in `domain/shared/index.ts`:

```ts
export {
  ageOn,
  displayFromIso,
  groupDateDigits,
  groupTimeDigits,
  isRealDate,
  isValidTime,
  isoFromDisplay,
} from './dates';
```

- [ ] **Step 6: Commit**

```bash
npx prettier --write domain/shared/dates.ts domain/shared/dates.test.ts domain/shared/index.ts
git add domain/shared/dates.ts domain/shared/dates.test.ts domain/shared/index.ts
git commit -m "feat(dates): the typed time's rules, twenty-four hour"
```

---

## Task 3: `DateField` and `TimeField`

**Files:**
- Create: `app/shell/components/DateField.tsx`, `app/shell/components/DateField.test.tsx`, `app/shell/components/TimeField.tsx`, `app/shell/components/TimeField.test.tsx`
- Read first: `app/shell/components/Controls.tsx` lines 25-62 (`Field`), and `PasswordField` beneath it — it is the precedent for a `Field` with a button inside.

**Interfaces:**
- Consumes: `groupDateDigits`, `isoFromDisplay`, `displayFromIso`, `groupTimeDigits`, `isValidTime` from `@domain/shared`; `Field` from `./Controls`
- Produces: `DateField` and `TimeField`, each taking `{ id: string; label: string; value: string; onChange: (value: string) => void; hint?: string; error?: string; min?: string; max?: string; disabled?: boolean }`

**Note the prop shape change.** `Field` passes an `onChange` an `Event`; these two take the **string** instead, because the control's whole job is that the typed text and the stored value differ. Every call site in Tasks 4 and 9 must therefore change `onChange={(e) => setX(e.target.value)}` to `onChange={setX}`. This is the one place the sweep is not a bare import swap, and it is why the guard test matters.

- [ ] **Step 1: Write the failing tests**

Create `app/shell/components/DateField.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DateField } from './DateField';

function Harness({ onChange }: { onChange?: (v: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <DateField
      id="d"
      label="Date of birth"
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}

describe('DateField', () => {
  it('draws the slashes as the digits are typed', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const box = screen.getByLabelText('Date of birth');
    await user.type(box, '12091988');
    expect(box).toHaveValue('12/09/1988');
  });

  it('emits the stored ISO form only once the date is complete', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.type(screen.getByLabelText('Date of birth'), '12091988');
    expect(onChange).toHaveBeenLastCalledWith('1988-09-12');
    expect(onChange).not.toHaveBeenCalledWith('1988-09-1');
  });

  it('refuses an impossible date and emits nothing for it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.type(screen.getByLabelText('Date of birth'), '31022026');
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('shows a stored value in the typed form', () => {
    render(
      <DateField id="d" label="Date of birth" value="1988-09-12" onChange={() => undefined} />,
    );
    expect(screen.getByLabelText('Date of birth')).toHaveValue('12/09/1988');
  });

  it('opens the native picker when the calendar button is pressed', async () => {
    const user = userEvent.setup();
    const showPicker = vi.fn();
    // jsdom implements no showPicker; the control must tolerate both worlds.
    Object.defineProperty(HTMLInputElement.prototype, 'showPicker', {
      configurable: true,
      value: showPicker,
    });
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: /calendar/i }));
    expect(showPicker).toHaveBeenCalled();
    Reflect.deleteProperty(HTMLInputElement.prototype, 'showPicker');
  });

  it('falls back to focusing the hidden input where showPicker is absent', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    // No showPicker defined: the press must not throw.
    await expect(
      user.click(screen.getByRole('button', { name: /calendar/i })),
    ).resolves.not.toThrow();
  });
});
```

Create `app/shell/components/TimeField.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TimeField } from './TimeField';

function Harness({ onChange }: { onChange?: (v: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <TimeField
      id="t"
      label="Start"
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}

describe('TimeField', () => {
  it('draws the colon as the digits are typed', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const box = screen.getByLabelText('Start');
    await user.type(box, '1430');
    expect(box).toHaveValue('14:30');
  });

  it('emits a complete twenty-four hour time and nothing before it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.type(screen.getByLabelText('Start'), '1430');
    expect(onChange).toHaveBeenLastCalledWith('14:30');
  });

  it('refuses an hour the clock does not have', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.type(screen.getByLabelText('Start'), '2500');
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('never shows a meridiem', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText('Start'), '1430');
    expect(screen.queryByText(/AM|PM/i)).toBe(null);
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run app/shell/components/DateField.test.tsx app/shell/components/TimeField.test.tsx`
Expected: FAIL — cannot resolve `./DateField`.

- [ ] **Step 3: Implement `DateField`**

Create `app/shell/components/DateField.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
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
  const native = useRef<HTMLInputElement>(null);

  // A value changed by the caller — a record loading, a form resetting — is
  // redrawn; a value the caller merely echoed back is left alone, so the caret
  // does not jump while someone is still typing.
  useEffect(() => {
    if (isoFromDisplay(typed) !== value) setTyped(displayFromIso(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

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
```

- [ ] **Step 4: Add `CalendarIcon`**

In `app/shell/components/Icons.tsx`, following the shape of the icons already there (no hex literals — `currentColor` only):

```tsx
export function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
```

- [ ] **Step 5: Implement `TimeField`**

Create `app/shell/components/TimeField.tsx` — the same shape without the picker, since a native time control adds nothing a masked box lacks:

```tsx
import { useEffect, useState } from 'react';
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

  useEffect(() => {
    if (typed !== value) setTyped(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function take(next: string) {
    const grouped = groupTimeDigits(next);
    setTyped(grouped);
    onChange(isValidTime(grouped) ? grouped : '');
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
```

- [ ] **Step 6: Add the styles**

In `app/shell/shell.css`, beside the `.password` rules which solve the same problem:

```css
/* A date box with its calendar button at the end, and the native control it
   borrows the calendar from kept out of the layout entirely. */
.datefield {
  position: relative;
  display: block;
}

.datefield__text .field__input {
  inline-size: 100%;
  padding-inline-end: calc(var(--s-2) + var(--row));
  font-variant-numeric: tabular-nums;
}

.datefield__picker {
  position: absolute;
  inset-inline-end: 0;
  inset-block-end: 0;
  inline-size: var(--row);
  block-size: var(--row);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--r-2);
  background: none;
  color: var(--ink-2);
  cursor: pointer;
}

.datefield__picker:hover {
  color: var(--ink);
}

.datefield__native {
  position: absolute;
  inset-inline-end: 0;
  inset-block-end: 0;
  inline-size: 1px;
  block-size: 1px;
  opacity: 0;
  pointer-events: none;
}
```

- [ ] **Step 7: Run the tests and watch them pass**

Run: `npx vitest run app/shell/components/DateField.test.tsx app/shell/components/TimeField.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
npx prettier --write app/shell/components app/shell/shell.css
git add app/shell/components app/shell/shell.css
git commit -m "feat(shell): a date and a time typed the way this country writes them"
```

---

## Task 4: Swap the twenty-six date sites and two time sites

**Files (each is a `Field type="date"` to become a `DateField`):**

| File | Lines |
|---|---|
| `app/admin/accounting/AccountsSection.tsx` | 104, 111 |
| `app/admin/accounting/StatementsSection.tsx` | 129, 136 |
| `app/admin/accounting/JournalSection.tsx` | 117, 124 |
| `app/admin/accounting/LockDrawer.tsx` | 117 |
| `app/admin/accounting/EntryDrawer.tsx` | 227 |
| `app/admin/clients/IdentityForm.tsx` | 149 |
| `app/admin/clients/EnrolmentWizard.tsx` | 395 |
| `app/admin/assessments/RecordDrawer.tsx` | 286 |
| `app/admin/schedule/SchedulePage.tsx` | 311 |
| `app/admin/schedule/NewAppointmentDrawer.tsx` | 334 |
| `app/admin/schedule/MoveAppointmentDrawer.tsx` | 215 |
| `app/admin/schedule/map/DayMapPage.tsx` | 250 |
| `app/admin/kit/KitPage.tsx` | 290, 298 |
| `app/admin/settings/PracticeDrawer.tsx` | 418 |
| `app/admin/billing/PackageDrawer.tsx` | 455 |
| `app/admin/billing/PriceDrawer.tsx` | 412 |
| `app/admin/billing/SellPackageDrawer.tsx` | 278 |
| `app/admin/billing/SellSessionDrawer.tsx` | 332 |
| `app/admin/audit/AuditPage.tsx` | 426, 433 |
| `app/admin/reports/ReportEditor.tsx` | 390, 403 |

**Time sites:** `app/admin/schedule/NewAppointmentDrawer.tsx:490`, `app/admin/schedule/MoveAppointmentDrawer.tsx:228`.

**Do not touch** `app/admin/kit/KitPage.tsx:58` — it is a doc comment quoting `<input type="date">` while explaining the `en-CA` formatter, not an input.

**Interfaces:**
- Consumes: `DateField`, `TimeField` from Task 3

- [ ] **Step 1: Swap one file and prove the pattern**

In `app/admin/clients/EnrolmentWizard.tsx`, change the import and the field. Before:

```tsx
<Field
  id="wizard-dob"
  label="Date of birth (optional)"
  type="date"
  value={dateOfBirth}
  onChange={(e) => {
    setDateOfBirth(e.target.value);
    clearIdentityError('dateOfBirth');
  }}
  hint="Not needed to save a lead, but needed before this client can be activated."
  error={identityErrors.dateOfBirth}
/>
```

After (the hint is trimmed in Task 11; leave the wording alone here):

```tsx
<DateField
  id="wizard-dob"
  label="Date of birth (optional)"
  value={dateOfBirth}
  onChange={(next) => {
    setDateOfBirth(next);
    clearIdentityError('dateOfBirth');
  }}
  hint="Not needed to save a lead, but needed before this client can be activated."
  error={identityErrors.dateOfBirth}
/>
```

Add `import { DateField } from '../../shell/components/DateField';`.

- [ ] **Step 2: Run that screen's existing tests**

Run: `npx vitest run app/admin/clients/EnrolmentWizard.test.tsx`
Expected: PASS. If a test drives the box with `fireEvent.change(..., '1988-09-12')` it will now fail, because the visible box holds `12/09/1988`. Change such a test to type the digits — that is the behaviour under test, not an incidental.

- [ ] **Step 3: Swap the remaining twenty-five date sites**

For each row of the table: add the import, change `<Field … type="date"` to `<DateField …`, drop the `type` prop, and change `onChange={(e) => f(e.target.value)}` to `onChange={(next) => f(next)}`. Keep `min`, `max`, `hint`, `error` and `disabled` exactly as they are.

- [ ] **Step 4: Swap the two time sites**

Same shape, `<TimeField`, dropping `type="time"`.

- [ ] **Step 5: Run the whole suite**

Run: `pnpm test`
Expected: PASS. Fix any test that asserted on the old raw value by typing digits instead.

- [ ] **Step 6: Commit**

```bash
npx prettier --write app/admin
git add app/admin
git commit -m "feat(console): every date and time box takes the practice's own format"
```

---

## Task 5: The guard that keeps the formats from coming back

**Files:**
- Create: `tests/lint/dates-and-times-use-the-controls.test.ts`
- Read first: `tests/lint/console-is-english.test.ts` — copy its walker and its fail-closed count assertion.

- [ ] **Step 1: Write the test**

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A native `<input type="date">` or `type="time"` draws itself in the browser's
 * locale, not the practice's: on a machine set to English (United States) a
 * date of birth reads MM/DD/YYYY and a visit time carries a meridiem. Round 47
 * replaced all twenty-eight of them with `DateField` and `TimeField`, which
 * always read DD/MM/YYYY and a twenty-four hour clock.
 *
 * Nothing in the code says that. The next screen written would reach for the
 * native control because every screen used to. So this walks the app and fails
 * on either type outside the two controls that are allowed to hold one.
 *
 * Fails closed: the visited-file count is asserted, so a walk that resolved
 * nothing cannot report zero violations and pass.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WALKED = ['app'] as const;

/** The two controls that own a native date input, and the comment that quotes one. */
const ALLOWED = new Set([
  'app/shell/components/DateField.tsx',
  'app/shell/components/TimeField.tsx',
]);

const OFFENCE = /type=["'](date|time)["']/;

function walk(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      walk(path, found);
      continue;
    }
    if (!['.ts', '.tsx'].includes(extname(entry.name))) continue;
    if (entry.name.includes('.test.')) continue;
    found.push(path);
  }
  return found;
}

describe('every date and time box is one of the two shared controls', () => {
  const files = WALKED.flatMap((directory) => walk(directory));

  it('visited the app, so a silent no-op cannot pass', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('finds no native date or time input outside the two controls', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (ALLOWED.has(file)) continue;
      const source = readFileSync(join(ROOT, file), 'utf8');
      for (const [index, line] of source.split('\n').entries()) {
        // A line inside a block comment is prose, not markup.
        if (line.trimStart().startsWith('*')) continue;
        if (OFFENCE.test(line)) offenders.push(`${relative('', file)}:${index + 1}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it pass**

Run: `npx vitest run tests/lint/dates-and-times-use-the-controls.test.ts`
Expected: PASS. If it names offenders, Task 4 missed those lines — swap them.

- [ ] **Step 3: Prove the guard actually bites**

Temporarily add `type="date"` to any prop in `app/admin/audit/AuditPage.tsx`, re-run, and confirm it FAILS naming that line. Then revert.

- [ ] **Step 4: Commit**

```bash
npx prettier --write tests/lint
git add tests/lint
git commit -m "test(lint): no screen may take a date or a time in the browser's format"
```

- [ ] **Step 5: Open pull request 1**

```bash
pnpm verify
git push -u origin worktree-uae-formats-enrolment
gh pr create --title "feat(console): dates and times in the practice's own format" --body "..."
```

---

## Task 6: The phone rules, as pure functions

**Files:**
- Create: `domain/shared/phone.ts`, `domain/shared/phone.test.ts`

**Interfaces:**
- Produces: `splitE164(value: string, codes: readonly string[]): { diallingCode: string; national: string } | null`, `joinE164(diallingCode: string, national: string): string`, `stripTrunkPrefix(national: string): string`

The country table is *presentation* and lives in `app/shell/components/countries.ts`; the dialling codes are passed in, so `domain/shared` stays free of it.

- [ ] **Step 1: Write the failing tests**

Create `domain/shared/phone.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { joinE164, splitE164, stripTrunkPrefix } from './phone';

// Synthetic throughout: +971 50 000 xxxx is the reserved fake range.
const CODES = ['+971', '+966', '+1', '+44', '+91'] as const;

describe('stripTrunkPrefix', () => {
  it('drops one leading zero, which is how a mobile is written locally', () => {
    expect(stripTrunkPrefix('0500001234')).toBe('500001234');
  });

  it('drops only one, and leaves a number without it alone', () => {
    expect(stripTrunkPrefix('00500001234')).toBe('0500001234');
    expect(stripTrunkPrefix('500001234')).toBe('500001234');
  });

  it('keeps only digits', () => {
    expect(stripTrunkPrefix('050 000 1234')).toBe('500001234');
  });
});

describe('joinE164', () => {
  it('builds the stored form, dropping the local trunk zero', () => {
    expect(joinE164('+971', '0500001234')).toBe('+971500001234');
    expect(joinE164('+971', '50 000 1234')).toBe('+971500001234');
  });

  it('gives an empty string when there is no number yet', () => {
    expect(joinE164('+971', '')).toBe('');
  });
});

describe('splitE164', () => {
  it('finds the longest dialling code that prefixes the value', () => {
    expect(splitE164('+971500001234', CODES)).toEqual({
      diallingCode: '+971',
      national: '500001234',
    });
  });

  it('gives null for anything that is not a stored E.164 value', () => {
    expect(splitE164('', CODES)).toBe(null);
    expect(splitE164('0500001234', CODES)).toBe(null);
    expect(splitE164('+99900000000', CODES)).toBe(null);
  });

  it('round-trips: splitting then rejoining reproduces the value exactly', () => {
    for (const value of ['+971500001234', '+442079460000', '+919999900000']) {
      const parts = splitE164(value, CODES);
      expect(parts).not.toBe(null);
      expect(joinE164(parts!.diallingCode, parts!.national)).toBe(value);
    }
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run domain/shared/phone.test.ts`
Expected: FAIL — cannot resolve `./phone`.

- [ ] **Step 3: Implement**

Create `domain/shared/phone.ts`:

```ts
/**
 * A phone number's two halves, and the one rule that makes joining them safe.
 *
 * Stored numbers are E.164 — a plus, then seven to fifteen digits — which is
 * what `contact.phone`'s check constraint holds (db/migrations/060_client.sql)
 * and what the routes accept. Nothing here rewrites a stored value: the split
 * is a display decision, and rejoining what was split reproduces the original
 * byte for byte, so a number whose country was guessed wrong is still the same
 * number.
 *
 * Pure and browser-safe: no I/O, no Node built-in.
 */

/**
 * A national number with its trunk prefix removed. A UAE mobile is written
 * `050 000 1234` on a card and `+971500001234` in E.164; concatenating the
 * written form yields `+9710500001234`, which looks plausible and cannot be
 * dialled. Exactly one leading zero goes, because a second is a typo rather
 * than a convention.
 */
export function stripTrunkPrefix(national: string): string {
  const digits = national.replace(/[^0-9]/g, '');
  return digits.startsWith('0') ? digits.slice(1) : digits;
}

/** The stored form. Empty in, empty out — an optional number stays optional. */
export function joinE164(diallingCode: string, national: string): string {
  const rest = stripTrunkPrefix(national);
  if (rest === '') return '';
  return `${diallingCode}${rest}`;
}

/**
 * The stored value as a country and a remainder, by longest matching dialling
 * code. `+1` is shared by more than twenty places and E.164 records which one
 * nowhere, so the country shown beside such a number is a guess; the number is
 * not, and `joinE164` puts it back unchanged.
 */
export function splitE164(
  value: string,
  codes: readonly string[],
): { diallingCode: string; national: string } | null {
  if (!/^\+[1-9][0-9]{6,14}$/.test(value)) return null;
  let best: string | null = null;
  for (const code of codes) {
    if (value.startsWith(code) && (best === null || code.length > best.length)) best = code;
  }
  if (best === null) return null;
  return { diallingCode: best, national: value.slice(best.length) };
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run domain/shared/phone.test.ts`
Expected: PASS.

- [ ] **Step 5: Export from the barrel**

Add to `domain/shared/index.ts`:

```ts
export { joinE164, splitE164, stripTrunkPrefix } from './phone';
```

- [ ] **Step 6: Commit**

```bash
npx prettier --write domain/shared
git add domain/shared
git commit -m "feat(phone): a number's two halves, and the trunk-zero rule"
```

---

## Task 7: The country table and the flag probe

**Files:**
- Create: `app/shell/components/countries.ts`, `app/shell/components/flagSupport.ts`

**Interfaces:**
- Produces: `COUNTRIES: readonly Country[]` where `Country = { iso: string; name: string; dialling: string; flag: string }`; `DIALLING_CODES: readonly string[]`; `flagsRender(): boolean`

- [ ] **Step 1: Write the table**

Create `app/shell/components/countries.ts`. The UAE first, the GCC next, then alphabetical. Every entry's `flag` is the two regional-indicator code points for its ISO pair, computed rather than pasted:

```ts
export type Country = { iso: string; name: string; dialling: string; flag: string };

/** The two regional-indicator code points an ISO pair maps to. */
function flagOf(iso: string): string {
  return String.fromCodePoint(
    ...Array.from(iso.toUpperCase()).map((c) => 0x1f1e6 + (c.charCodeAt(0) - 65)),
  );
}

const ROWS: readonly [iso: string, name: string, dialling: string][] = [
  ['AE', 'United Arab Emirates', '+971'],
  ['SA', 'Saudi Arabia', '+966'],
  ['QA', 'Qatar', '+974'],
  ['BH', 'Bahrain', '+973'],
  ['KW', 'Kuwait', '+965'],
  ['OM', 'Oman', '+968'],
  // …then every remaining country, alphabetical by name.
];

export const COUNTRIES: readonly Country[] = ROWS.map(([iso, name, dialling]) => ({
  iso,
  name,
  dialling,
  flag: flagOf(iso),
}));

export const DIALLING_CODES: readonly string[] = COUNTRIES.map((c) => c.dialling);
```

Fill `ROWS` with the full ITU-T E.164 assignment list. Where several countries share a code (`+1`, `+7`), list each; `splitE164` takes the longest match and ties resolve to the first row, which is why the UAE and the GCC lead.

- [ ] **Step 2: Write the probe**

Create `app/shell/components/flagSupport.ts`:

```ts
/**
 * Whether this browser draws a flag emoji as a flag.
 *
 * Windows has never shipped flag glyphs: it renders the two regional-indicator
 * letters instead, so a country column there reads as two grey letters rather
 * than a picture. The operator chose emoji flags with that stated
 * (docs/superpowers/specs/2026-09-12-uae-formats-design.md), so this does not
 * replace them — it substitutes the ISO code only where the glyph is missing.
 *
 * Measured, not sniffed: a supported flag renders narrower than the two letters
 * it is built from. Canvas is unavailable under jsdom, so the measurement is a
 * DOM one and the whole thing answers `false` if anything is missing.
 */
let answer: boolean | null = null;

export function flagsRender(): boolean {
  if (answer !== null) return answer;
  if (typeof document === 'undefined') return (answer = false);
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;font-size:32px;white-space:nowrap';
  document.body.appendChild(probe);
  probe.textContent = '\u{1F1E6}\u{1F1EA}'; // AE as a flag
  const asFlag = probe.getBoundingClientRect().width;
  probe.textContent = '\u{1F1E6}\u{1F1E6}'; // AA — assigned to no country, never a flag
  const asLetters = probe.getBoundingClientRect().width;
  document.body.removeChild(probe);
  // jsdom measures everything as zero; that reads as "no flags", which is the safe answer.
  return (answer = asFlag > 0 && asFlag < asLetters);
}
```

- [ ] **Step 3: Commit**

```bash
npx prettier --write app/shell/components
git add app/shell/components/countries.ts app/shell/components/flagSupport.ts
git commit -m "feat(shell): the dialling codes, and whether this machine draws flags"
```

---

## Task 8: `PhoneField`

**Files:**
- Create: `app/shell/components/PhoneField.tsx`, `app/shell/components/PhoneField.test.tsx`

**Interfaces:**
- Consumes: `joinE164`, `splitE164` from `@domain/shared`; `COUNTRIES`, `DIALLING_CODES` from `./countries`; `flagsRender` from `./flagSupport`
- Produces: `PhoneField` taking `{ id: string; label: string; value: string; onChange: (value: string) => void; hint?: string; error?: string; disabled?: boolean }`

- [ ] **Step 1: Write the failing tests**

Create `app/shell/components/PhoneField.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PhoneField } from './PhoneField';

function Harness({ initial = '', onChange }: { initial?: string; onChange?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <PhoneField
      id="p"
      label="Phone"
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}

describe('PhoneField', () => {
  it('defaults to the UAE', () => {
    render(<Harness />);
    expect(screen.getByLabelText(/country/i)).toHaveValue('+971');
  });

  it('builds E.164 and drops the locally written leading zero', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.type(screen.getByLabelText('Phone'), '0500001234');
    expect(onChange).toHaveBeenLastCalledWith('+971500001234');
  });

  it('splits a stored number back into its two halves', () => {
    render(<Harness initial="+971500001234" />);
    expect(screen.getByLabelText(/country/i)).toHaveValue('+971');
    expect(screen.getByLabelText('Phone')).toHaveValue('500001234');
  });

  it('rebuilds the value when the country changes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial="+971500001234" onChange={onChange} />);
    await user.selectOptions(screen.getByLabelText(/country/i), '+966');
    expect(onChange).toHaveBeenLastCalledWith('+966500001234');
  });

  it('emits an empty string when the number is cleared, so optional stays optional', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial="+971500001234" onChange={onChange} />);
    await user.clear(screen.getByLabelText('Phone'));
    expect(onChange).toHaveBeenLastCalledWith('');
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run app/shell/components/PhoneField.test.tsx`
Expected: FAIL — cannot resolve `./PhoneField`.

- [ ] **Step 3: Implement**

Create `app/shell/components/PhoneField.tsx`. Two controls reading as one row: a `<select>` labelled for screen readers, and the number box. Where `flagsRender()` is false, each option's text is `AE +971` rather than `🇦🇪 +971`. The country's initial value comes from `splitE164(value, DIALLING_CODES)?.diallingCode ?? '+971'`, the number from that split's `national`. Both halves feed `joinE164` on every change, and the result goes to `onChange`.

- [ ] **Step 4: Add the styles**

In `app/shell/shell.css`:

```css
/* The code and the rest of the number as one row: the selector takes its own
   width, the number takes the remainder. */
.phonefield {
  display: flex;
  gap: var(--s-2);
}

.phonefield__code {
  flex: none;
  inline-size: 9rem;
}

.phonefield__number {
  flex: 1 1 auto;
}

.phonefield__number .field__input {
  inline-size: 100%;
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 5: Run and watch it pass**

Run: `npx vitest run app/shell/components/PhoneField.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
npx prettier --write app/shell
git add app/shell
git commit -m "feat(shell): a phone number as a country and the rest of it"
```

---

## Task 9: Swap the five phone sites

**Files:**
- Modify: `app/admin/clients/EnrolmentWizard.tsx:432`, `app/admin/clients/ContactForm.tsx:303`, `app/admin/settings/PracticeDrawer.tsx:359` and `:374`, `app/client/FamilyScreen.tsx:84`

**Interfaces:**
- Consumes: `PhoneField` from Task 8

- [ ] **Step 1: Swap all five**

Each is a `<Field type="tel" … hint={PHONE_HINT}>`. Replace with `<PhoneField>`, dropping `type` and `hint` — the hint is deleted outright in Task 11, because the control it described is gone. `onChange` takes the string.

- [ ] **Step 2: Remove the now-unused constant**

Delete `PHONE_HINT` from `app/admin/clients/formRules.ts` and its imports in `EnrolmentWizard.tsx` and `ContactForm.tsx`. Keep `PHONE_ERROR`, `isValidPhone` and `normalisePhone` — the server still refuses a bad number and the form still names which field is wrong.

- [ ] **Step 3: Run the suite**

Run: `pnpm test`
Expected: PASS. Tests that typed a whole `+971…` into one box must now type the national part.

- [ ] **Step 4: Commit and open pull request 2**

```bash
npx prettier --write .
pnpm verify
git add -A
git commit -m "feat(console): every phone box takes a country and a number"
gh pr create --title "feat(console): a phone number as a country and the rest of it" --body "..."
```

---

## Task 10: `groupEmiratesIdDigits`

**Files:**
- Modify: `domain/shared/emirates-id.ts`, `domain/shared/emirates-id.test.ts`, `domain/shared/index.ts`

**Interfaces:**
- Produces: `groupEmiratesIdDigits(input: string): string`

**Do not alter `formatEmiratesId` or `normaliseEmiratesId`.** They throw by design and `domain/shared/identity.ts` depends on it.

- [ ] **Step 1: Write the failing tests**

Append to `domain/shared/emirates-id.test.ts`:

```ts
import { groupEmiratesIdDigits } from './emirates-id';

describe('groupEmiratesIdDigits', () => {
  it('inserts the dashes as the digits arrive', () => {
    expect(groupEmiratesIdDigits('')).toBe('');
    expect(groupEmiratesIdDigits('784')).toBe('784');
    expect(groupEmiratesIdDigits('7841')).toBe('784-1');
    expect(groupEmiratesIdDigits('7841900')).toBe('784-1900');
    expect(groupEmiratesIdDigits('78419000000001')).toBe('784-1900-0000001');
    expect(groupEmiratesIdDigits('784190000000017')).toBe('784-1900-0000001-7');
  });

  it('never throws on a partial run, unlike formatEmiratesId', () => {
    expect(() => groupEmiratesIdDigits('7')).not.toThrow();
    expect(() => groupEmiratesIdDigits('123')).not.toThrow();
  });

  it('reads through separators, folds Arabic-Indic, and stops at fifteen digits', () => {
    expect(groupEmiratesIdDigits('784-1900-0000001-7')).toBe('784-1900-0000001-7');
    expect(groupEmiratesIdDigits('٧٨٤١٩٠٠٠٠٠٠٠٠١٧')).toBe('784-1900-0000001-7');
    expect(groupEmiratesIdDigits('7841900000000179999')).toBe('784-1900-0000001-7');
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run domain/shared/emirates-id.test.ts`
Expected: FAIL — `groupEmiratesIdDigits is not a function`.

- [ ] **Step 3: Implement**

Append to `domain/shared/emirates-id.ts`:

```ts
/**
 * The display grouping of however many digits have been typed so far:
 * `784`, `784-1900`, `784-1900-0000001-7`.
 *
 * Total where `formatEmiratesId` is strict. That one normalises first and
 * throws unless handed all fifteen digits, which is right for the value that is
 * hashed and sealed and useless for a box someone is still typing into. Both
 * group `3-4-7-1`; only their tolerance differs.
 */
export function groupEmiratesIdDigits(input: string): string {
  const d = toLatinDigits(input).replace(/[^0-9]/g, '').slice(0, EMIRATES_ID_DIGITS);
  const parts = [d.slice(0, 3), d.slice(3, 7), d.slice(7, 14), d.slice(14)];
  return parts.filter((part) => part !== '').join('-');
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run domain/shared/emirates-id.test.ts`
Expected: PASS, including the existing `formatEmiratesId` tests.

- [ ] **Step 5: Export and commit**

Add `groupEmiratesIdDigits` to the `./emirates-id` line in `domain/shared/index.ts`, then:

```bash
npx prettier --write domain/shared
git add domain/shared
git commit -m "feat(emirates-id): group the digits as they are typed"
```

---

## Task 11: `EmiratesIdField`, and the wizard's rhythm

**Files:**
- Create: `app/admin/clients/EmiratesIdField.tsx`
- Modify: `app/admin/clients/EnrolmentWizard.tsx`, `app/admin/clients/ContactForm.tsx`, `app/admin/clients/clients.css`

**Interfaces:**
- Consumes: `groupEmiratesIdDigits` from `@domain/shared`; `Field` from `../../shell/components/Controls`

- [ ] **Step 1: Write the component**

`EmiratesIdField` holds the grouped text, emits the grouped text (the wizard already folds and validates before sending), takes `{ id, label, value, onChange, hint, error }`, and sets `inputMode="numeric"` and `placeholder="784-1900-1234567-1"`.

- [ ] **Step 2: Wire it into both forms**

In `EnrolmentWizard.tsx:445` and `ContactForm.tsx`'s equivalent, replace the `<Field id="wizard-emirates-id" …>` with `<EmiratesIdField …>` and delete the `hint` — the example now lives in the placeholder.

- [ ] **Step 3: Trim the two remaining hints**

In `EnrolmentWizard.tsx`, change the date-of-birth hint to `Needed to activate.` The phone hint is already gone with Task 9.

- [ ] **Step 4: Tighten the rhythm**

In `app/admin/clients/clients.css`, change `.drawer__form`'s `gap: var(--s-5)` to `gap: var(--s-3)`.

- [ ] **Step 5: Run the suite and measure**

Run: `pnpm test`
Then run the app (`pnpm dev`), open enrolment, and confirm in the browser's inspector that the identity step's form is near 1,030px rather than 1,315px. Record the real number.

- [ ] **Step 6: Commit and open pull request 3**

```bash
npx prettier --write .
pnpm verify
git add -A
git commit -m "feat(clients): an identity number that groups itself, in a tighter step"
gh pr create --title "feat(clients): the identity number, and the wizard's rhythm" --body "..."
```

---

## Task 12: The drawer's width, read and clamped

**Files:**
- Create: `app/shell/components/useDrawerWidth.ts`, `app/shell/components/useDrawerWidth.test.ts`
- Modify: `app/shell/tokens.css`

**Interfaces:**
- Produces: `MIN_DRAWER_WIDTH: 320`, `maxDrawerWidth(viewport: number): number`, `clampDrawerWidth(value: number, viewport: number): number`, `readDrawerWidth(viewport: number): number | null`, `writeDrawerWidth(value: number): void`, `DRAWER_WIDTH_KEY: string`

- [ ] **Step 1: Write the failing tests**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DRAWER_WIDTH_KEY,
  MIN_DRAWER_WIDTH,
  clampDrawerWidth,
  maxDrawerWidth,
  readDrawerWidth,
  writeDrawerWidth,
} from './useDrawerWidth';

describe('clampDrawerWidth', () => {
  it('keeps a sensible width', () => {
    expect(clampDrawerWidth(720, 1440)).toBe(720);
  });

  it('refuses to go below the floor or above the ceiling', () => {
    expect(clampDrawerWidth(4, 1440)).toBe(MIN_DRAWER_WIDTH);
    expect(clampDrawerWidth(9000, 1440)).toBe(maxDrawerWidth(1440));
  });

  it('lets a narrow viewport lower the ceiling', () => {
    expect(maxDrawerWidth(800)).toBe(720);
    expect(maxDrawerWidth(4000)).toBe(1100);
  });

  it('answers the floor for a value that is not a number', () => {
    expect(clampDrawerWidth(Number.NaN, 1440)).toBe(MIN_DRAWER_WIDTH);
  });
});

describe('readDrawerWidth', () => {
  beforeEach(() => localStorage.clear());

  it('is null when nothing was ever stored', () => {
    expect(readDrawerWidth(1440)).toBe(null);
  });

  it('clamps on the way in, not only on the way out', () => {
    localStorage.setItem(DRAWER_WIDTH_KEY, '9000');
    expect(readDrawerWidth(1440)).toBe(maxDrawerWidth(1440));
  });

  it('is null for a stored value that is not a number', () => {
    localStorage.setItem(DRAWER_WIDTH_KEY, 'wide please');
    expect(readDrawerWidth(1440)).toBe(null);
  });

  it('round-trips a width it wrote', () => {
    writeDrawerWidth(720);
    expect(readDrawerWidth(1440)).toBe(720);
  });
});
```

Add `// @vitest-environment jsdom` at the top — `localStorage` needs it.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run app/shell/components/useDrawerWidth.test.ts`
Expected: FAIL — cannot resolve `./useDrawerWidth`.

- [ ] **Step 3: Implement**

`maxDrawerWidth` is `Math.min(Math.round(viewport * 0.9), 1100)`. `clampDrawerWidth` returns the floor for a non-finite value, else `Math.min(Math.max(value, 320), maxDrawerWidth(viewport))`. `readDrawerWidth` returns null when the key is absent, unparseable, or storage throws — a private window and a browser set to block site data both throw on access, so wrap every read and write in `try`/`catch`. `writeDrawerWidth` swallows a throw the same way.

- [ ] **Step 4: Run and watch it pass, then commit**

```bash
npx prettier --write app/shell
git add app/shell
git commit -m "feat(shell): the drawer's width, clamped on the way in"
```

---

## Task 13: The drag handle

**Files:**
- Create: `app/shell/components/DrawerResizeHandle.tsx`
- Modify: `app/shell/shell.css`, and the drawer's own markup where `.drawer` is rendered

**Interfaces:**
- Consumes: everything from Task 12

- [ ] **Step 1: Write the component**

A `div` with `role="separator"`, `aria-orientation="vertical"`, `aria-label="Drawer width"`, `aria-valuenow`, `aria-valuemin={320}` and `aria-valuemax={maxDrawerWidth(window.innerWidth)}`, `tabIndex={0}`. On `pointerdown` it captures the pointer and tracks `pointermove` until `pointerup`, setting the width from the pointer's distance to the viewport's inline end. `ArrowLeft`/`ArrowRight` move it 32px, `Home` and `End` reach the bounds. Every set goes through `clampDrawerWidth`, then `document.documentElement.style.setProperty('--drawer', \`${width}px\`)` and `writeDrawerWidth`.

- [ ] **Step 2: Style it**

```css
/* The drawer's inner edge, draggable. A 6px rule with a 12px reach, so it is
   findable without being a wall. */
.drawer__resize {
  position: absolute;
  inset-block: 0;
  inset-inline-start: calc(-1 * var(--s-1));
  inline-size: var(--s-3);
  cursor: col-resize;
  touch-action: none;
}

.drawer__resize::after {
  content: '';
  position: absolute;
  inset-block: 0;
  inset-inline-start: var(--s-1);
  inline-size: var(--hairline);
  background: var(--rule);
}

.drawer__resize:hover::after,
.drawer__resize:focus-visible::after {
  background: var(--brand);
  inline-size: 2px;
}

/* Below the tablet tier the drawer is already the full width; there is nothing
   to drag. */
@media (max-width: 767px) {
  .drawer__resize {
    display: none;
  }
}
```

- [ ] **Step 3: Read the stored width at startup**

Where the shell mounts, call `readDrawerWidth(window.innerWidth)` once and, when it is not null, set `--drawer` on the document element. Never read `window.innerWidth` for the viewport meta — `docs/SPEC` forbids it; this is a layout read, which is different, but keep it out of any meta tag.

- [ ] **Step 4: Test and commit**

Run: `pnpm verify`
Then drive it in a browser: drag the handle, reload, confirm the width survives; open a billing drawer and confirm it opens at the same width; tab to the handle and move it with the arrow keys.

```bash
npx prettier --write .
git add -A
git commit -m "feat(shell): drag the drawer wider, and it stays"
gh pr create --title "feat(shell): a drawer whose width you choose" --body "..."
```

---

## Task 14: The change request, and the round's record

**Files:**
- Create: `docs/CHANGE-REQUESTS/trunk-round-47.md`

- [ ] **Step 1: Write it**

Following the shape of the round 41 entry in `docs/CHANGE-REQUESTS/trunk-notes.md`: what the round changed in the shared zone (`app/shell/**`, `domain/shared/**`), every file touched outside the trunk's own paths grouped by stream (accounting, clients, assessments, schedule, kit, settings, billing, audit, reports, portal), and the sentence that nothing in those paths is the trunk's beyond this round. State explicitly: no migration, no policy file, no API route.

- [ ] **Step 2: Commit**

```bash
npx prettier --write docs
git add docs
git commit -m "docs: round 47 in the shared zone, and what it touched outside it"
```

---

## Self-review notes

- **Spec coverage:** every section of the spec maps to a task — value contract (Tasks 1, 2, 6, and the swap tasks), lossless split (Task 6), trunk zero (Task 6), Emirates ID mask (Task 10), guard test (Task 5), flag fallback (Task 7), clamped width (Task 12), density (Task 11), ownership (Task 14).
- **Known gap, deliberately left:** Task 7's `ROWS` is the one place a task says "fill in the rest" rather than giving the content. The full E.164 list is roughly 250 rows of public reference data; writing it out here would treble the plan's length without adding a decision. The *shape* of a row, the ordering rule and the tie-break are all specified.
- **Type consistency:** `groupDateDigits`, `isoFromDisplay`, `displayFromIso`, `isRealDate`, `groupTimeDigits`, `isValidTime`, `splitE164`, `joinE164`, `stripTrunkPrefix`, `groupEmiratesIdDigits`, `clampDrawerWidth`, `maxDrawerWidth`, `readDrawerWidth`, `writeDrawerWidth` are each defined once and referred to by the same name everywhere after.
- **The one prop-shape change** — `onChange` taking a string rather than an event — is called out in Task 3 and repeated in Tasks 4 and 9, because an executor may read those out of order.
