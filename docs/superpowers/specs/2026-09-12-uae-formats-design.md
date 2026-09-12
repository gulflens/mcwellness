# The country's own formats: how a date, a time, a phone number and an identity number are typed

**Date:** 12 September 2026, 09:13 on the operator's clock (01:13 UTC). **Status:** design approved by the operator; spec for review.

## Why

The console reads dates correctly and writes them incorrectly. Every place the app *shows*
a date already pins its locale — twenty-two sites format with `en-GB`, which is
`DD/MM/YYYY`, and five with `en-CA`, which is the ISO form used for comparison rather than
for reading. No `toLocaleDateString` or `toLocaleTimeString` in the application omits its
locale. Nothing displays a date in the browser's own idea of a date.

Every place the app *takes* a date is the opposite. A native `<input type="date">` draws
itself in the locale of the browser, not of the page: `lang` does not move it, and the
application has no say at all. On a machine whose browser is set to English (United
States) — which is the default on a Mac sold anywhere — the date of birth box on the
enrolment wizard reads `MM/DD/YYYY`. The same record, opened on a second machine, reads
`DD/MM/YYYY`. The stored value is identical and correct in both; only the person reading
it is misled. There are twenty-seven such boxes. Two `<input type="time">` boxes have the
same defect in the twelve-hour form, and they sit on the screens where a visit is booked
and moved.

Beside that, three things the operator types every day are harder than they need to be. A
phone number is one free-text box that asks for `+971…` to be typed by hand, and refuses
the number at the server if the country code is missing — a rule the person cannot see
until it fails. An Emirates ID is fifteen unbroken digits with no grouping, so a
transposition is invisible while it is being typed. And the enrolment wizard's first step
stands about 1,315px tall inside a drawer fixed at no more than 480px wide, against
roughly 760px of laptop viewport: the operator scrolls nearly two screens to enrol one
person, and cannot widen the drawer to see more at once.

This round fixes the input side. The display side is already right and is not touched.

## Decisions already taken

| Decision | Choice | By |
|---|---|---|
| The scope | **Every** date, time and phone box in the console, in one sweep — not enrolment alone | operator, 12 Sep |
| How a date is typed | A masked `DD/MM/YYYY` box **with a calendar button** beside it | operator, 12 Sep |
| Country flags | **Emoji, every country**, with the Windows trade-off stated and accepted | operator, 12 Sep |
| The drawer's width | Draggable, **remembered**, and **one width for every drawer** | operator, 12 Sep |
| How dense | Tighten the rhythm and the words; **stay in one column**, no two-column pairing | operator, 12 Sep |
| Example values | The operator's own identity number and mobile are **not** used; the synthetic ranges are | Claude, from rule 2 |

## The design calls this spec makes

**The value contract does not change, and that is the whole safety argument.** Each new
control speaks exactly the string the control it replaces spoke: `DateField` takes and
returns `1988-09-12`, `TimeField` takes and returns `14:30`, `PhoneField` takes and returns
`+971500001234`. Only the drawing changes. No route, no zod schema, no database column, no
API test and no database test is touched by the sweep, and each of the thirty-four call
sites is a one-line import swap with its props unchanged. This is what makes it defensible
to edit the screens where money is taken in the same round as the enrolment screen.

**Splitting a phone number apart is lossless even when the country guess is wrong.** A
stored `+1…` cannot be attributed to a country: the United States, Canada and a couple of
dozen Caribbean and Atlantic territories all share `+1`, and E.164 keeps no record of which. The control therefore treats
the split as a *display* decision and never as a rewrite. It finds the longest dialling
code that prefixes the stored value, shows that country in the selector, and puts the
remainder in the number box; rejoining the two halves reproduces the original string byte
for byte. If the guess is wrong the flag beside a `+1` number is wrong and nothing else is,
and the moment the operator edits either half the value is rebuilt from what is on screen.
No stored number is ever silently rewritten by being looked at.

**The leading zero is a rule, not a formatting detail, so it lives in `domain/`.** A UAE
mobile is written `050 000 1234` on a business card and `+971500001234` in E.164. A split
control that simply concatenates its two halves produces `+9710500001234` — fifteen digits,
plausible to the eye, accepted by a naive check, and undialable. Stripping that zero is a
decision about what a phone number means, which rule 4 of `CLAUDE.md` puts in `domain/`
as a pure function with tests written first, not in a component.

**The Emirates ID mask is a pure function too, and it already has a home.** Grouping fifteen
digits as `784-1900-1234567-1` is `3-4-7-1`. The function goes in
`domain/shared/emirates-id.ts` beside `normaliseEmiratesId`, which already folds
Arabic-Indic digits; the field wrapper stays in `app/admin/clients/`. The existing checksum
validation, the `409` for an identity number already on file and the `503` when the identity
service is unconfigured are untouched — this round changes how the digits are grouped on
screen and nothing about what they mean.

**A guard test, not vigilance, keeps the formats from coming back.** The sweep is only
durable if the next screen written cannot reintroduce a raw `<input type="date">`. A test
walks the source and fails if `type="date"` or `type="time"` appears anywhere outside the
two new controls, in the manner of the existing `tests/lint/console-is-english.test.ts`.
Without it this round decays the first time a screen is added.

**The flag fallback is ten lines and preserves the operator's choice.** Emoji flags were
chosen with the Windows behaviour stated: Windows has never shipped flag glyphs and draws
the two regional-indicator letters instead. A single probe at startup measures whether a
flag renders as one glyph or two; where it does not, that column shows the ISO country code
instead of two stray letters. On the operator's Mac the probe passes and nothing changes.
This does not reverse the decision — every country still has a flag where flags exist.

**The drawer's remembered width is clamped on the way in, not only on the way out.** A width
in `localStorage` is a value a person can edit and a stale build can misread. It is clamped
to the legal range every time it is read, so a corrupt or absurd stored value yields a usable
drawer rather than one 4px or 9000px wide. It is stored on the machine and never sent to the
server; it carries nothing personal.

**The density change stops short of what would fit.** One column at a 12px rhythm lands the
identity step near 1,030px, which still scrolls a little on a laptop. Pairing fields into two
columns would have reached about 760px and was offered and declined in favour of the calmer
reading. This spec records that the remaining scroll is a chosen cost, so a later reader does
not mistake it for an oversight.

## Shape

Four pull requests on one branch, in the manner of round 43. Each is reviewable alone and
none depends on a later one.

### Pull request 1: the two controls that take a date and a time

`app/shell/components/DateField.tsx` and `TimeField.tsx`, with their rules as pure functions
in `domain/shared/` and tests written first.

- Typing: digits only; separators appear as the caret passes them; backspace steps over a
  separator rather than stranding the caret behind it.
- Paste accepts `12/09/1988`, `12-09-1988`, `1988-09-12` and bare digits, folding
  Arabic-Indic digits through the existing `toLatinDigits`.
- An impossible date is refused in place — `31/02/2026` never becomes a value.
- `onChange` emits `''` until eight digits form a real date, then the ISO string. An empty
  box stays empty, so an optional field remains optional.
- The calendar button holds a visually-hidden native date input and calls `showPicker()`;
  where that method is absent the button focuses the hidden input instead.
- `min` and `max` are honoured — the audit range and the activation gate both rely on them.
- `TimeField` is the same shape in `HH:MM`, twenty-four hour, with no meridiem anywhere.
- The twenty-seven date sites and two time sites are swapped, and the guard test lands here.

### Pull request 2: the control that takes a phone number

`app/shell/components/PhoneField.tsx` and its country table, with the join, the split and the
leading-zero rule as pure functions in `domain/shared/` and tests written first.

- Two controls reading as one row: a typeable country selector, and the rest of the number.
- The selector filters on dialling code, ISO code and country name, so `+971`, `ae` and
  `United` all reach the same row. The UAE is preselected and pinned to the top, the GCC
  follows, then alphabetical order.
- The five phone sites are swapped: two on the client record, two in practice settings, one
  on the household's own family screen.

### Pull request 3: the identity number, and the wizard's rhythm

- `formatEmiratesId` in `domain/shared/emirates-id.ts`, tests first, grouping `3-4-7-1` and
  capping at fifteen digits.
- `EmiratesIdField` in `app/admin/clients/`, used by the enrolment wizard and the contact
  form.
- `.drawer__form` gaps fall from 20px to 12px.
- The phone hint is deleted outright: the split control makes the format it described
  impossible to get wrong. The Emirates ID example moves inside the box as placeholder text.
  The date-of-birth note becomes `Needed to activate.`

### Pull request 4: the drawer's drag handle

- A grab strip down the drawer's inner edge, a 6px rule with a 12px hit area, `col-resize`.
- Pointer events, so a trackpad and a touch screen work as a mouse does.
- The handle is a `separator` with `aria-valuenow`, `aria-valuemin` and `aria-valuemax`;
  arrow keys move it, `Home` and `End` reach the bounds. It is not mouse-only.
- Range 320px to `min(90vw, 1100px)`, clamped on read as well as on write.
- Persisted under one key in `localStorage`, shared by every drawer in the console.
- The handle is hidden below the tablet tier, where the drawer is already the full width,
  and it sits on the mirrored edge under `:dir(rtl)`.

## Not in this round

- **Two-column field pairing.** Offered, declined; it is the move that would remove the last
  of the scroll, and it remains available.
- **The household portal's dates.** The portal renders no date or time input at all — only
  one phone box, which pull request 2 includes. Arabic date forms are untouched.
- **The practitioner face.** It has no date, time or phone input.
- **Display formatting.** Already correct everywhere; no `toLocaleDateString` in the app
  omits its locale.

## Risks stated

| Risk | What holds it |
|---|---|
| The sweep touches schedule, billing and books, where a misread date costs money | The value contract is unchanged, so no route, schema or database test moves; the guard test proves no raw input survives |
| A `+1` number shows the wrong flag | The split is display-only and rejoining is byte-identical; no stored value is rewritten |
| `showPicker()` is absent in jsdom and in older Safari | The fallback focuses the hidden native input; the absent-method path is tested rather than assumed |
| Emoji flags draw as two letters on Windows | Accepted by the operator with the behaviour stated; the probe substitutes the ISO code where glyphs are missing |
| A corrupt stored drawer width | Clamped on read, not only on write |
| The operator's real identity number and mobile were used as examples in the brief | Neither appears in any file, test or commit; the synthetic `784-1900-*` and `+971 50 000 xxxx` ranges are used throughout, and `.claude/hooks/no-real-identifiers.sh` enforces it on every `Write` and `Edit` |

## Ownership

`app/shell/**` and `domain/shared/**` are the shared zone, and the thirty-four call sites lie
in nine modules that different streams own. This is therefore a trunk round with a one-round
widening and a change request in `docs/CHANGE-REQUESTS/`, following rounds 31, 33, 34 and 41.
No migration, no policy file and no API route: nothing this round decides is a database's to
enforce.
