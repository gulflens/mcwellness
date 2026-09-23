## Round 61 — bank details and the discount percentage on the invoice (2026-09-23)

The owner's ask of 23 September 2026, in two parts: the invoice should carry
the practice's own bank details, so a family can pay by transfer straight off
the page, and a discounted line should carry "the % value for the discount in
addition to the discounted amount" — the figure the two amounts already
implied, spelled out rather than left for a reader to work out. Built the same
day, in four tasks, each reviewed before the next began. Real values are never
in this document or in the repository the round touched: an account holder,
an IBAN and a BIC live only in the practice's own row, entered once by the
owner in Settings › Practice; everywhere below that would name them it says
"the practice's account" instead.

### The two decisions

**The bank account is read live, like the mark, and never snapshotted.**
Every other supplier fact on an invoice — the legal name, the address, the
registration — is stamped onto the row at the moment it is numbered
(`supplier_*` columns, migration 402), on purpose: a document has to keep
saying what it said, and a family should never see last year's invoice
describe this year's registration. A bank account is the one fact that rule
must not cover. First, practically: this round's own migration adds the
columns today, so a snapshot taken at insert time could never reach the one
invoice that already exists on production (`INV-000001`, see the note for the
operator below) — every invoice issued before the account existed would file
with an empty block for ever, which is not what "the practice records its
account" is meant to produce. Second, and the reason that holds even for
every invoice issued after: an account the practice has left is the one place
a family must not be sent money. If the practice ever changes banks, every
invoice still open ought to say so, not repeat an account that no longer
takes the practice's transfers. So `InvoiceDocument.bank` is read from
`tenant` at render time (`app/api/billing/document-source.ts`, `BANK_SQL`),
exactly as the practice's logo already is, and it carries the same price the
logo already pays: a filed invoice's PDF is immutable once it exists, and if
its stored bytes are ever lost, recovery re-renders from the row — but a
re-render after the account has changed produces different bytes than the
ones that were filed, so the recovery path refuses it,
`409 document_bytes_differ`, rather than put a different document under the
filed one's hash. This is not a new rule invented for a bank account; it is the
rule the mark already lives by, applied to the one other live-read field.
Printing the discount's percentage is a renderer change too, and the same
refusal reaches further than the bank account alone: any discounted invoice
filed before this round's deploy whose stored bytes are later lost will
re-render with the percentage the old bytes never carried, and be refused the
same `409 document_bytes_differ`, whether or not the practice has ever
recorded a bank account.

**The percentage prints on the line, and in the totals only when every line
agrees.** A discounted line already carried the two figures a family actually
wants — `List AED 700.00 · less AED 105.00` — and `docs/SPEC/billing.md`
section 2.4 had said "with the percentage when there was one" since it was
first written; the renderer simply had not printed it yet. It now appends
`(25%)` when the line's own `discount_basis_points` was typed as a share
(`domain/billing/document/strings.ts`, `discountLine`), and leaves it off when
the discount was typed as a sum — a discount typed as a fixed amount carries
no share to invent, and printing one would be arithmetic the practice never
did. The totals row is where "agrees" matters: it reads "Discount 25%" only
when every discounted line on the invoice shares that one percentage
(`sharedDiscountBasisPoints`, `domain/billing/document/model.ts`); a line with
no discount at all does not break the agreement, but two discounted lines at
different shares, or one typed as a sum, leave the totals saying "Discount"
and the figure alone, because a total of different shares has no share of its
own to print. `docs/SPEC/billing.md` §2.4 and §5.6 are amended to describe
both rules as built.

### The compliance note

The four new columns — `bank_account_holder`, `bank_iban`, `bank_bic`,
`bank_address` — are business facts of the practice, the same standing as its
legal name, its licence number or its address: not personal data of a client
or of anyone else. They are audited exactly as every other `tenant` column
is, through the ordinary write trigger (`app.audit_row`), and they are
**not** added to the list `app.audit_redact` drops before a row reaches
`audit_log` (the Emirates ID columns, GPS check-in points, and — since
migration 967 — five `staff_profile` columns naming a colleague or a third
person). That list exists for values that must never leave a durable trace
in an append-only, five-year trail; a bank account the practice has recorded
for itself is not one of them, and an owner or admin reading the audit trail
should be able to see when the account changed and to what, the same as any
other setting. Nothing in this round touches `app.audit_redact`.

An owner or admin is not the only reader of that trail: a lead practitioner
may read it too (`audit_log_readers`, `db/policies/core/audit_log.sql`), but
only through `GET /api/audit/activity`, which answers `ActivityEvent` rows —
one composed sentence and the fields listed in `app/api/audit/schema.ts` —
and never `old_values` or `new_values`. A lead practitioner reading the
activity feed after the practice changes its bank details would see WHICH
fields changed (the sentence names them, as it names any other setting), and
never the account holder, the IBAN, the BIC or the address themselves. That
is the extent of it, and it is acceptable for the practice's own business
facts, the same standing this section already gives them.

### The mod-97 check, and where it runs

Migration 924's own shape check — `bank_iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'`
— catches a wrongly-shaped string but not a mistyped digit inside a
well-shaped one. The IBAN's own check digits (ISO 13616 / ISO 7064 mod
97-10) catch exactly that, and they run **only in application code**:
`isValidIban` (`domain/shared/iban.ts`) is a pure function — uppercase,
spaces removed, the first four characters moved to the end, each letter read
as its two-digit value, the whole number taken modulo 97 a few digits at a
time so nothing overflows, valid when the remainder is 1.
`app/api/practice/schema.ts` refines `BankInput.iban` with it, after the
shape regex has already passed so a malformed IBAN is refused once, in one
sentence, not twice; `PracticeDrawer.tsx` runs the identical check
client-side, from the same `domain/shared` function, before any request
leaves the browser. **The database keeps the shape check only** —
`tenant_bank_iban_shape` — and
deliberately does not repeat the checksum: business rules live in `domain/`
(CLAUDE.md rule 4), and a mod-97 remainder computed a second time in `plpgsql`
would be a second implementation of a rule that already has one, with no
migration path to keep the two in step. A single mistyped digit on the
practice's own IBAN would otherwise reach every invoice printed until
somebody noticed; the checksum is what a reasonable owner expects the screen
to catch before that happens.

### The `coalesce` clearing defect, fixed for seven columns

`PATCH /api/practice`'s update statement wrote three of `tenant`'s existing
columns — `contact_phone`, `contact_email`, `website` — as
`coalesce($n, contact_phone)` and so on: whatever the body sent, substituted
for the column's current value only when the body sent SQL `null`. That is
exactly backwards for a form with an empty box. A caller that means to clear
a phone number sends `null`; `coalesce(null, contact_phone)` returns
`contact_phone`, unchanged — the column could never be cleared once it held a
value, only ever overwritten with something else. (`record_readings`, the
fourth column that used the same `coalesce($n, col)` text, was not actually
affected: it is `boolean not null`, so its optional input is never really
"send null to clear," and `review_url` already worked, through its own
`case when $n::boolean then … else review_url end`, built when migration 920
needed "send nothing to switch the review line off" to actually work.) The
route now builds its `set` list from the keys the body actually carries
(`setIfPresent`, `app/api/practice/routes.ts`): present, possibly null, and
the column is written; absent, and the column is left exactly as it stands.
Seven columns move through that rule today — the three that were broken,
`contact_phone`, `contact_email` and `website`, now genuinely clearable, and
the four new ones, `bank_account_holder`, `bank_iban`, `bank_bic` and
`bank_address`, built correctly from their first day rather than inheriting
the bug a copy-pasted `coalesce` would have repeated. `review_url` and
`record_readings` ride the same mechanism now too, for one rule instead of
three, but neither one's behaviour changes.

### The Arabic `%25`

The percentage on the Arabic side of a discounted line reads `(%25)`, not
`(25%)`: `domain/shared/document/arabic.ts`'s shaper treats `%` as a
right-to-left character and does not apply Unicode's European-number
exception (UAX #9 rule W5) the way a full bidi implementation would, so the
sign is drawn before the digits in visual order. Copied text still reads
`25%`, and `%25` after a number is the ordinary way a percentage is set in
Arabic typography across the Gulf, so this was accepted rather than treated
as a fault — the same rule that would already apply to a VAT rate column, had
one existed on the Arabic side. Changing it, if it is ever wanted, is a
change to the trunk-owned shaper, not to billing.

### Two small tidy-ups, on the way through

`groupIban` — `AE360000000000000000001` as `AE36 0000 0000 0000 0000 001` —
existed twice, once in `domain/billing/document/strings.ts` (Task 3, for the
invoice) and once, privately, in `app/admin/settings/PracticePage.tsx` (Task
2, for the settings screen), both the same one line. Moved to
`domain/shared/iban.ts`, beside `isValidIban`, and exported from the
`domain/shared` barrel;
both callers import it from there, and `strings.ts` re-exports it so
`render.ts` and the billing barrel's own callers need not know it moved. Its
tests moved to `domain/shared/iban.test.ts`, with a foreign IBAN and an empty
string added to what the document tests already proved indirectly.

**A long foreign IBAN can wrap at a group boundary, and it is tested and
pinned, not merely noticed.** The bank block's value column already wraps a
long account holder and a long bank address rather than cutting them
(`sheet.wrap`); the IBAN, grouped in fours by `groupIban` before it reaches
that column, wraps the same way when it is long enough — `sheet.wrap` only
ever breaks on a space, and `groupIban`'s are the only spaces in the string,
so a wrapped IBAN always breaks between whole groups, never inside one. A UAE
IBAN is 23 characters, five groups, and never reaches this width; the longest
IBAN migration 924's shape check admits is 34 characters (two letters, two
digits, thirty more), nine groups, which does. `tests/billing/geometry.test.ts`
pins this (`ea0b7234`) with an invented 34-character IBAN — it need not pass
the mod-97 check, which a pure render test never runs — asserting every
fragment the wrap produces reassembles to the grouped string in order and
stays inside the bank block's box, clear of the totals box by the gutter.

### Found beside it, and not fixed here

- **Two private helpers are both named `bankCode`.**
  `app/api/practice/routes.ts` defines one that maps a zod issue to the
  refusal code the route answers with (`iban_invalid` and the rest);
  `app/api/practice/schema.ts`
  defines an unrelated one that builds a zod field for a bank code column
  (uppercase, spaces out, blank stored as nothing). Nothing collides at
  runtime — each is module-scoped — but a reader grepping the file for one
  can land on the other. Worth a rename; not done here.
- **`tests/db/practice.test.ts`'s database assertion matches `/tenant_bank/`
  loosely.** "holds the same rules in the database, beneath the route" only
  proves that some constraint whose name starts `tenant_bank` fired, not
  which of the six migration 924 adds; it should clear the holder too and
  match `tenant_bank_details_need_iban` by name.
- **The bank account's `describe` block depends on test order.** "is absent
  until somebody records it" only holds because it runs before "records the
  bank account and answers it back" writes one; nothing resets the row
  between the file's own tests. The file's existing style, not a fault
  introduced here.
- **No test types an 11-character BIC.** Every case in the suite uses the
  8-character shape; the regex's optional three-character branch
  (`([A-Z0-9]{3})?`) has never been exercised.
- **`cleanText(…, 64)` caps the IBAN and BIC before the shape check runs.**
  Harmless today — the shape regex already refuses anything past 34
  characters, well inside the cap — but it means the "refused rather than
  cut" promise made of the holder and the address above does not, in fact,
  extend to these two.
- **The clear-one-field test clears the bank address, not the BIC.**
  `PracticePage.test.tsx`'s "clears a bank field by emptying its box" sends
  `bankAddress: null` with the BIC left as it stands; the two fields are
  handled identically in code, so this is a gap in what the test proves,
  not in what the code does.
- **The IBAN and BIC shape regexes are duplicated between `schema.ts` and
  the drawer.** `PracticeDrawer.tsx` repeats both patterns literally, ahead
  of any request, rather than importing them — the file's existing pattern
  for every other client-side check it runs.
- **The page-break geometry test's floor is `GEOMETRY.MARGIN`, not
  `GEOMETRY.BAND`.** "never splits from the totals across a page break"
  checks every box on the holding page against the page's own top margin,
  a looser bound than the band the bank block and the totals actually
  share.
- **`document-source.ts` maps `lines.rows` twice**: once to build
  `InvoiceDocument.lines`, and again, narrower, to feed
  `sharedDiscountBasisPoints`. Duplicated work, not a correctness fault —
  the second pass reads the same rows the first pass already held.

### The tests

- `domain/shared/iban.test.ts` — 9 (Task 1's 6 for `isValidIban`, plus 3 for
  `groupIban` moved here in Task 4's tidy-up).
- `tests/db/practice.test.ts` — 29, run with `pnpm test:db`: the bank account
  recorded and answered back with the IBAN stored without spaces and both
  case-folded to uppercase; refused for a wrong IBAN shape, a wrong-digit
  IBAN (the mod-97 check), a BIC without an IBAN, an account holder without
  an IBAN; cleared when every field is sent null; a contact field cleared by
  sending null, the defect's own case; the reason written onto the audit row.
- `app/admin/settings/PracticePage.test.tsx` — 26 (20 before this round, 6
  added by Task 2): the four values shown, the IBAN grouped in fours, "Not
  recorded" against each when the practice holds none, a save that sends all
  four keys, clearing one field to null, a client-refused malformed IBAN
  before any request, and a server-refused `iban_invalid` landing the error
  on the IBAN field.
- `tests/billing/document.test.ts` — 49: the percentage beside a discounted
  line and in the totals when every line shares it; none for a discount typed
  as a sum; each line's own percentage and none in the totals when two lines
  disagree; the totals still reading a shared 25% beside an undiscounted
  line; "Pay by bank transfer" with the account, the grouped IBAN, the BIC
  and the bank address; the BIC and address left out when neither was
  recorded; no block and the pre-existing golden's bytes unchanged when the
  practice has recorded no account; no block on a receipt, by the type and by
  the page.
- `tests/billing/geometry.test.ts` — 46 (45 before this round, the long-IBAN
  case added by Task 4): the bank block's heading level with the totals
  box's first row; every block line inside the left margin and clear of the
  totals box by the gutter; a 120-character holder and a 200-character
  address wrapping rather than being cut; the block and the totals never
  split across a page break from 1 to 40 lines; no block on a receipt; and
  now, the 34-character IBAN wrapping at a group boundary while staying
  inside the block.
- `tests/billing/db/supplier_contact.test.ts` — 6, run with `pnpm test:db`:
  the bank null and the page blockless when the practice has recorded none;
  an issued invoice re-rendered after the account changes prints the new
  details — named as the intended drift, not a bug.
- `tests/billing/db/documents.test.ts` — 22, run with `pnpm test:db`: a filed
  invoice's stored PDF carries the block, the IBAN grouped in fours; recovery
  refuses (`409 document_bytes_differ`) to restore an invoice filed before
  the account changed.

`pnpm -s format`, `pnpm verify` (prettier, eslint, `tsc --noEmit`, the
secrets scan over 1,604 tracked files, the migration audit over 112 files
against `origin/main`, and `vitest run`: 258 files, 3,117 tests) and
`pnpm test:db` (111 files, 1,592 tests) all green on the branch's head, no
skips. Commands and tails are in this task's own report.

### Every file this round touched outside the trunk's own paths

Ten, all the billing stream's, riding in this round's own pull request by the
integrator's widening for one round, as rounds 41, 51, 52, 58 and 59 were
widened (`docs/SPEC/OWNERSHIP.md`): `domain/billing/document/index.ts`,
`model.ts`, `render.ts` and `strings.ts`; `app/api/billing/document-source.ts`;
`tests/billing/document.test.ts` and `geometry.test.ts`;
`tests/billing/db/documents.test.ts` and `supplier_contact.test.ts`; and
`docs/SPEC/billing.md` §2.4 and §5.6. The trunk's own half is migration
`924_practice_bank_account.sql`, `app/api/practice/**`, `app/admin/settings/**`,
`domain/shared/iban.ts` with its test, `tests/db/practice.test.ts`, one fixture
line in `app/shell/App.test.tsx`, and the documents. Nothing in those paths is
the trunk's beyond this round.

### Going live

**Merged is not live.** One migration in the trunk's first half (900–949, it
alters `tenant`), no policy file — `app.guard_tenant_identity` (905) already
restricts every `tenant` update to an owner or admin, and `app_role` already
holds a table-level update grant (090), so migration 924 changes no grant and
no policy file needs re-applying.

1. The hold protocol.
2. `924_practice_bank_account.sql` by hand, staging first and then
   production, the file's statements whole and its bookkeeping row in the
   same call, with the sha256 of the file's text taken from `main` after the
   merge. Production's ledger reads **111** as of round 59's pass
   (`docs/PRODUCTION.md`, the thirty-fifth pass, migration 968); this round's
   is the next row, so both ledgers should read **112** once it is applied —
   check the number rather than trust it, in case another round reaches
   staging or production first.
3. Fingerprint `tenant` against a runner-built local database: the four new
   columns (`bank_account_holder`, `bank_iban`, `bank_bic`, `bank_address`,
   all nullable `text`) and the six constraints migration 924 adds
   (`tenant_bank_iban_shape`, `tenant_bank_bic_shape`,
   `tenant_bank_holder_length`, `tenant_bank_address_length`,
   `tenant_bank_holder_with_iban`, `tenant_bank_details_need_iban`), each
   constraint's definition identical on all three databases.
4. Then the code, by the recipe.

**Proof is not the API bundle.** `WORDS.payByTransfer` and the rest of what
an invoice prints live in `domain/billing/document`, which renders on the
server (`app/api/billing/document-source.ts`) — a served client bundle never
carries "Pay by bank transfer" to check for, the way a screen's own sentence
would. The proof is two other things: the Settings screen's own chunk
carrying "Bank account" — the group heading Task 2 added — with the old
chunk answering 404, read the way every pass in `docs/PRODUCTION.md` reads a
changed screen; and, once the owner has entered the account in Settings ›
Practice on the live site, an invoice rendered afterwards actually carrying
the "Pay by bank transfer" block, read back the way the golden bytes are
read in the tests above — off the file, not off a claim about the code.

**Nothing to run on production's rows.** No `tenant` row has a bank account
recorded yet, so the migration changes no data; the four columns start null,
exactly as every row already answers `bank: null` today, and the block
appears on nothing until the owner records the account.

**For the operator.** The one real invoice on production, `INV-000001`,
gains the "Pay by bank transfer" block only if its PDF has not yet been
filed by the time the account is recorded — once a PDF is filed it is
immutable, read back byte for byte from storage rather than re-rendered, so
recording the account afterwards changes nothing about a document already
on file. If it has not yet been filed, it will carry the block the next time
it is, the same as any invoice issued from then on. Check with "has the
invoice been sent?" first, before assuming either answer — the same question
that renumbered it to `INV-000001` in the first place asked, so it is worth
asking again rather than assuming it was answered once and for all.
