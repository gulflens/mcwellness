## Round 47 — the country's own formats (2026-09-12)

### Why the round happened

The console reads a date correctly everywhere and writes one wrong. Every
place the app *shows* a date already pins its locale — twenty-two sites in
`en-GB`, five in `en-CA` — and nothing displays a date in the browser's own
idea of a date. The display side was already right and is not touched by
this round.

Every place the app *takes* a date was the opposite defect. A native
`<input type="date">` and `<input type="time">` draw themselves in the
locale of the browser, not of the page: `lang` does not move it, and the
application has no say at all. On a machine whose browser is set to English
(United States) — the default on a Mac sold anywhere — the date-of-birth box
on the enrolment wizard read `MM/DD/YYYY`; the same record, opened on a
second machine, read `DD/MM/YYYY`. The stored value was identical and
correct in both; only the person reading it was misled. Twenty-six date
boxes and two time boxes carried this defect, confirmed by counting every
call site the round actually swapped rather than by re-quoting the design's
own estimate.

Beside that, a phone number was one free-text box asking for `+971…` to be
typed by hand and refused at the server without warning if the country code
was missing, and an Emirates ID was fifteen unbroken digits with no
grouping, so a transposition was invisible while it was being typed. This
round fixes the input side only.

### What landed in the shared zone

`app/shell/**`: the two new controls and their tests, `DateField.tsx` and
`TimeField.tsx`; the phone control, `PhoneField.tsx`, with its dialling-code
table `countries.ts` and the emoji-flag probe `flagSupport.ts`, each with its
test; the drawer-width memory, `useDrawerWidth.ts` and its test; the drag
handle, `DrawerResizeHandle.tsx`; `AdminLayout.tsx` (reads the remembered
width once and mounts the one handle for every drawer), `useDrawer.ts` (the
handle joins the focus cycle and survives the inert walk), `Icons.tsx`, and
`shell.css` and `tokens.css` for the handle's styling and the drawer's
clamped default.

`domain/shared/**`: the date and time rules added to `dates.ts` (and its
test); the new `phone.ts` (and its test) holding the join, split and
leading-zero rules; and `groupEmiratesIdDigits` added to `emirates-id.ts`
(and its test) beside the existing `formatEmiratesId`, which stays untouched
and still throws on anything but a complete, valid number.

The guard, `tests/lint/dates-and-times-use-the-controls.test.ts`, walks the
source and fails if `type="date"` or `type="time"` appears anywhere outside
the two controls that are now allowed to use them.

`app/admin/settings/**` is also this round's own paths, not a widening: that
directory has been named in `docs/SPEC/OWNERSHIP.md`'s shared-zone table
since trunk round 39, alongside `app/api/team/**` and the scheduler. Its
`PracticeDrawer.tsx` gained a `PhoneField` for the WhatsApp number and a
`DateField` for the licence-expiry date, and `PracticePage.test.tsx` was
updated for the new control's shape. `package.json` and `pnpm-lock.yaml`
gained one devDependency, `@testing-library/user-event`, for typing tests
against the masked controls — also this round's own, under the shared
zone's "build and deploy" row.

### Every file this round touched outside the trunk's own paths, by stream

**`accounting`** — `app/admin/accounting/AccountsSection.tsx`,
`EntryDrawer.tsx`, `JournalSection.tsx`, `LockDrawer.tsx`,
`StatementsSection.tsx`, and `tests/accounting/BooksPage.test.tsx`: the
ledger, entry, journal, lock and statement dates.

**`assessment`** — `app/admin/assessments/RecordDrawer.tsx`: one date field.

**`audit-ui`** — `app/admin/audit/AuditPage.tsx` and its test: the activity
report's From and To dates.

**`billing`** — `app/admin/billing/PackageDrawer.tsx`, `PriceDrawer.tsx`,
`SellPackageDrawer.tsx`, `SellSessionDrawer.tsx`, and
`tests/billing/PriceDrawer.test.tsx`: the dates a package, a price or a sale
carries.

**`client-record`** — `app/admin/clients/ContactForm.tsx` and its test
(phone), `EnrolmentWizard.tsx` and its test (date of birth, identity number,
phone), `IdentityForm.tsx` and its test (date of birth), `clients.css` (the
`.drawer__form` gap, 20px to 12px), and `formRules.ts` (the phone hint
constant deleted, its job now done by the control itself). Also new to this
stream: `EmiratesIdField.tsx` and its test, the field wrapper around
`groupEmiratesIdDigits`, used by the enrolment wizard and the contact form.

**`session-capture`** (`app/admin/kit/**`, owned by this stream since piece
eight's widening, 2026-09-05) — `app/admin/kit/KitPage.tsx` and its test: the
two calibration dates.

**`reports`** — `app/admin/reports/ReportEditor.tsx`: the progress report's
From and To dates.

**`scheduling`** — `app/admin/schedule/MoveAppointmentDrawer.tsx` and
`NewAppointmentDrawer.tsx` (date and time), `SchedulePage.tsx` and
`app/admin/schedule/map/DayMapPage.tsx` (date), and
`tests/scheduling/MoveAndCancelDrawers.test.tsx` and
`NewAppointmentDrawer.test.tsx`.

**`client-portal`** owns nothing this round touched. `app/client/**` was in
scope for one phone box and is deliberately untouched — see below.

Nothing in those paths is the trunk's beyond this round.

### The value contract is why a round this wide was safe

Each new control speaks exactly the string the control it replaced spoke.
`DateField` takes and returns `1988-09-12`; `TimeField` takes and returns
`14:30`; `PhoneField` takes and returns `+971500001234`. Only the drawing
changed. No route, no zod schema, no database column, no API test and no
database test moved for any of the thirty-one call sites this round
touched (twenty-six dates, two times, three phones) — each was a swap of
one control for another with its value unchanged. This is what makes it defensible to edit the screens where money
is taken (billing, accounting) in the same round as the enrolment screen.

### No migration, no policy file, no API route

Nothing this round decided is a database's to enforce. The stored value on
every column this round's controls write is identical in shape to what was
stored before it: an ISO date string, an `HH:MM` string, an E.164 phone
number. `db/migrations/**`, `db/policies/**` and `app/api/**` are untouched
in every stream this round reached.

### Two things deliberately not done

**`app/client/FamilyScreen.tsx` keeps its plain phone field.** It is the
bilingual household portal, and `PhoneField`'s country selector's label text
is English only. Swapping it would put the one untranslated control on a
screen where every other label comes from the i18n dictionary. Of the five
phone sites the design scoped, three were swapped this round — two on the
client record (`ContactForm.tsx`, `EnrolmentWizard.tsx`) and one in practice
settings (the WhatsApp number) — and this is one of the remaining two.

**`app/admin/settings/PracticeDrawer.tsx`'s "Telephone on documents" field
keeps its plain `Field`.** Per `app/api/practice/schema.ts` it is
deliberately a free-form local number for printing, not E.164, explicitly
contrasted there with `whatsappNumber`, and its own test asserts that spaces
a person types reach the server unchanged. Swapping it to `PhoneField` would
have changed a wire format the schema deliberately keeps loose. This is the
other of the two phone sites not swapped.

### One correction to the record

The spec and the plan for this round said the enrolment wizard's identity
step stood "about 1,315px" tall. That figure was arithmetic from token
values — row heights and gaps multiplied out — not a measurement, and it
approximated the form's own content rather than the element that actually
scrolls. The element that scrolls is `.drawer__body`, and its measured
height, in a real Chromium render at 1280×900 after this round's density
change (`.drawer__form`'s gap from 20px to 12px) and the value-contract
swaps above, is 972px. The before-figure was an estimate; treat the
difference between 1,315 and 972 as illustrative, not as an exact delta.

### Synthetic data used throughout

Every Emirates ID in a test or fixture this round touched is in the
`784-1900-*` range; every UAE mobile is `+971 50 000 xxxx`. Neither the
operator's own identity number nor their own mobile number appears anywhere
in this round's files, tests or commits.

### Gates on the branch head, in this worktree

Sixty-six files changed across twenty-three commits on
`worktree-uae-formats-enrolment`, from `d9f2a28` to `575cb71`: two new pure
rule modules and their tests (`dates.ts` additions, `phone.ts`), three new
shared controls and their tests (`DateField`, `TimeField`, `PhoneField`),
the dialling-code table and flag probe, the drawer-width memory and its drag
handle, one new client-record field (`EmiratesIdField`), the guard test, and
the call-site swaps listed above.
