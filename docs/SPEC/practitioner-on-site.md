# SPEC — The practitioner works on site (pieces twenty and twenty-one)

*Worktree: any free one (`scripts/worktree.mjs add`, or the `scheduling` checkout once its branch has merged), on a branch of its own; the paths this piece owns are listed in section 15 rather than by a row in the ownership table, because it adds no folder of its own. Entities: none new. It
re-shapes the client record, contacts, locations, goals and consent for the
phone, over the routes that already serve them, and widens one database rule.
Part A is piece twenty; Part B is piece twenty-one and is listed in section 14
rather than specified. Approved by `docs/PLAN/practitioner-on-site.md` when
the operator approves it.*

## 1. Purpose

A practitioner standing in a client's home can find any client of the
practice, open their record, correct their details, contacts and addresses,
enrol a new client on the spot, and take a consent with a signature — on the
phone, in the phone's own shape. And a practitioner who is not also the owner
is allowed to, which is what makes it true the day the practice employs
somebody.

The operator's decisions of 8 September 2026, 04:50: on the phone, not the
console; a practitioner sees the whole practice; every practitioner.

## 2. What exists on `main`, and what this adds

**Exists, and is reused rather than rewritten.** The whole client record and
everything under it: `GET/POST /api/clients`, `GET/PATCH /api/clients/:id`,
`/contacts`, `/locations`, `/goals`, `/consents`, `/consent-wording`,
`/consent-witnesses`, `/lookup`, and the rules behind them
(`domain/client/**` — activation, the consent gate, the erasure letter). The
console's own components for each: `EnrolmentWizard` (identity, contacts,
location, goals, consent, summary), `ContactForm`, `LocationForm`,
`GoalForm`, `RecordConsentForm`, `ConsentText`, `SignaturePad`, and
`CoordinateFields`, which pull request 126 moves to
`app/shell/components/` — **this piece depends on that one landing**, and if
it has not, the component is still under `app/admin/clients/` and moving it is
this piece's job rather than a second copy's.
The practitioner ground: `app/therapist/**`, the dark single column, the
outbox, the installable worker.

**Adds.** One widening of `app.client_visible_to_practitioner` and one line in
`domain/shared/actor.ts`; a client search, a client record, an enrolment and a
consent capture in the practitioner's own face; and nothing else. **No new
table, no new column, no new route** — every screen here talks to a route that
already exists and is already tested.

## 3. Who uses it

A practitioner, on their phone. The office's console is untouched, and so is
every other role's reach.

## Part A — piece twenty

## 4. The widening, and exactly what it opens

**4.1 The rule.** `app.client_visible_to_practitioner(client_id)` (migration
201) answers today: *this client has a visit with me, agreed by the household,
in the last ninety days or the next thirty*. It becomes: *this caller is an
active practitioner of this practice*. The client argument stays, because nine
migrations and six policy files pass it and the signature must not move; the
body stops reading `appointment` at all. A new migration in the trunk's
`900–949` half replaces the body and carries, in its own comment, the
operator's decision, its date, what it opens (4.2) and the one-line change
that would narrow it again.

**4.2 What it opens, named.** Every read that consults the function opens for
every practitioner, over every client of the practice. This list is the
piece's own account of the decision and belongs in the migration's comment,
in `docs/SECURITY.md` and in `docs/COMPLIANCE/`:

| Where | What a practitioner may now read |
|---|---|
| `db/policies/client/readers.sql` | every client's record, contacts, addresses, access notes, goals and consents |
| `db/policies/client/writers.sql` | and, with section 4.3, write them |
| `db/policies/scheduling/appointment_access.sql` | every client's visits, past and future, whoever delivers them |
| `db/migrations/301`, `304`, `305` | every session and what was recorded in it |
| `db/policies/assessment/access.sql`, `500`, `501`, `503` | every brain map, every measurement, and the files behind them |
| `db/policies/reports/reports.sql` | every report, drafts included |
| `db/policies/billing/ledger.sql` | every client's purchases, balance and payments |
| `db/migrations/203` | the diary rules that consult it |

**Nothing else changes.** The office's roles keep their reach; finance and a
client contact are untouched; `app.client_erasure_gate` still hides an erased
record from everybody.

**4.3 The action.** `client.write` in `domain/shared/actor.ts` gains
`practitioner` and `lead_practitioner` beside the owner and an admin, with the
decision written into the case. `client.list` and `client.read` already admit
a practitioner and need no change; what changes is how far the rows reach.
Every other action is untouched — in particular **`billing.waiver.write` stays
with the office** (the plan's default) and the selling and payment actions are
piece twenty-one's, not this one's.

**4.4 The write policy.** `db/policies/client/writers.sql` admits a
practitioner to the writes this piece needs — the client row, contacts,
locations, goals and consents — and to no others: no status change, no
erasure request, no consent withdrawal, no document unlink. Those stay the
office's, and the piece's tests prove each refusal.

**4.5 What the trail records.** Nothing new. Every route these screens call
already writes its own audit row, and the widened rule changes who may read,
never what is recorded. One thing is worth pinning with a test: a practitioner
reading a client they have no visit with now writes a `read` row exactly as
the office's does, so the trail shows the widening being used.

## 5. The screens

The practitioner ground of `docs/DESIGN-BRIEF.md` 6.1 throughout: dark, one
column, one decision per screen, the primary action 56 pixels in the thumb's
reach, English only, logical properties, tokens only.

**5.1 Clients** — `/clients`. A search field, and beneath it the results:
first name, family initial, record number, and the emirate of their primary
address. It searches the same way the console's does (`GET /api/clients?q=`)
and shows nothing until something is typed, because a list of every household
is not a thing to leave open on a phone in someone's living room. One button
beneath: **Enrol a client**. Reached from Today's own header.

**5.2 One client** — `/clients/:id`. Their name and record number, their age,
and then four plain sections in the phone's own rhythm, each opening one at a
time: **Details** (name, date of birth, status), **Contacts**, **Addresses**,
**Consent**. Each carries an edit control that opens the console's own form,
re-laid for one column; the forms themselves are the same components over the
same routes. Goals sit under Details, because a practitioner adds one at a
door and reads it before knocking.

**5.3 Enrolling** — `/clients/new`. The console's six steps
(`EnrolmentWizard`: identity, contacts, location, goals, consent, summary) as
six screens rather than six panes, each with one question and a single way
onward, the progress shown as "Step 3 of 6" and nothing more. The location
step uses `CoordinateFields` and its **Use my current position**, which is
exactly right: the practitioner is standing at the door being recorded. The
consent step is 5.4. The summary says what was created and offers the record.

A wizard abandoned halfway leaves what it has already written — the console
behaves the same way, and `ActivationSummary` already says what a client still
needs before anything can be delivered to them.

**5.4 Consent, taken and signed.** `RecordConsentForm`'s own sequence, in one
column: which consent, who is giving it, the wording in full in the language
that household reads, and only then the pad. `SignaturePad` takes a finger as
it takes a mouse. The three methods stay as they are — the pad, a photographed
paper form, and a verbal confirmation with the second member of staff who
heard it — and every refusal the route can give already has its sentence.

**5.5 Online only, and it says so.** Enrolment, consent and (in twenty-one)
money need a bar of signal: a consent files the exact wording as evidence and
an invoice takes a number nobody else may have. Each screen checks
`navigator.onLine` before it opens and says `This needs a signal. The day and
the session work without one.` The service worker caches none of these
addresses — a client's record is not a thing to leave on a device — and
section 3.4 of `docs/SPEC/practitioner-phone.md` gains that sentence.

## 6. Rules

None new. Everything these screens decide is decided already, in
`domain/client/**` and the routes above, and is reached rather than
re-implemented. The one line of logic this piece owns is which sections of a
record a practitioner may open, and it lives in `domain/shared/actor.ts`.

## 7. Data

No new table, no new column, no new index.

## 8. API

No new route. The screens call, unchanged: `GET /api/clients?q=`,
`POST /api/clients`, `GET/PATCH /api/clients/:id`, the contacts, locations,
goals and consents routes beneath it, `GET /api/clients/consent-wording`,
`GET /api/clients/consent-witnesses`, `GET /api/clients/goal-categories`.
Every one of them already checks `canActor` and already writes its audit row;
what this piece changes is who those checks admit.

If a route turns out to refuse a practitioner for a reason section 4 has not
named, **stop and record it** rather than widening it: an unlisted refusal is
either a rule this piece must respect or a decision the operator has not
taken.

## 9. Permissions and row security

Section 4. One migration, one policy file edited, one action widened. The
piece's own tests drive `app_role` directly and prove, with the policy in
place and again with it removed: a practitioner reads and writes a client they
have no visit with; a practitioner is refused a status change, an erasure
request, a consent withdrawal and `billing.waiver.write`; finance and a client
contact reach exactly what they reached before; and another practice reaches
none of it.

## 10. Audit, erasure, retention

Unchanged, and section 4.5 pins the one thing worth pinning. Erasure still
hides a record from every role including this one.

## 11. Deliberately left out

Working with no signal (5.5). Deleting anything: erasure, withdrawal,
cancelling an invoice and changing a client's status stay the office's. The
console, which does not change. The day map and the practice's diary, which
stay the office's. A practitioner's own reach into another practitioner's
schedule. Arabic on the practitioner's face, which has none by the operator's
decision of 7 September.

## 12. Decisions taken by default

1. *The widening is one function, not nine policies.* Changing the rule the
   policies already consult keeps every policy honest and reversible in one
   line; editing nine policy files would leave the practice unable to narrow
   it again without a second round of the same size.
2. *The signature is the pad first.* The three methods stay, and the pad is
   what the screen offers, because a phone in the hand is the reason this
   piece exists.
3. *Search shows nothing until something is typed.* A list of every household,
   left open on a phone in a client's home, is a disclosure nobody asked for.
4. *A record opens one section at a time.* The phone's rule is one decision per
   screen; four sections stacked open is the console's shape on a small screen.
5. *`billing.waiver.write` stays with the office.* The plan's default.
6. *No offline queue for any of this.* 5.5.

## 13. Seed, tests, done when

**Seed.** Nothing new: twenty synthetic households, their contacts, addresses,
consents and the planning day are already there.

**Tests.** The database tests of section 9, each confirmed to fail with the
policy or the migration reverted. The screens in jsdom: search finding a
household and showing nothing before a query; a record opening each section;
an enrolment running its six screens and creating what it says; a consent
signed on the pad and filed with its wording; every online-only screen
refusing with the right sentence when `navigator.onLine` is false. The lint
guards that already hold — English only, no hex, no Node import in the browser
bundle — must keep holding.

**Done when.** On the seeded laptop, in a phone-sized viewport, signed in as a
practitioner who is **not** an owner or an admin: they find a household they
have no visit with, open it, correct a contact, add an address with the
current position, enrol a new client through six screens, and take a consent
signed on the pad — and the trail shows every one of those acts under their
name. The console, opened as the owner, is exactly as it was. `pnpm verify`,
`pnpm test:db` and `pnpm build` green.

## 14. What piece twenty-one adds, so nothing here pre-builds it

Selling and being paid at the door: `billing.sale.write` and
`billing.payment.write` widened to a practitioner; the price list and the
packages on the phone; a sale with its discount shown before it is agreed; a
payment in cash, by transfer or by link; and the receipt handed over or sent.
It needs a client findable and openable on a phone, which is this piece.
Nothing here builds any of it, and no screen here mentions money beyond the
balance a stop card already shows.

## 15. Change requests to the shared zone

`docs/CHANGE-REQUESTS/practitioner-onsite-01.md`, riding in the piece's own
pull request by the precedent of pieces seven to nineteen: the migration in the
trunk's `900–949` half; `domain/shared/actor.ts`'s `client.write`;
`db/policies/client/writers.sql` and `readers.sql` (the client-record
stream's); the routes in `app/shell/App.tsx`; the worker's exclusions in
`app/shell/sw.ts`; and `docs/SECURITY.md`, `docs/COMPLIANCE/`,
`docs/SPEC/practitioner-phone.md`, `docs/SPEC/client-record.md` and
`docs/SPEC/OWNERSHIP.md`.
