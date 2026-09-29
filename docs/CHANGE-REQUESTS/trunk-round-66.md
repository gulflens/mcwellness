## Round 66 — a session given free stays out of the books (2026-09-30)

On 29 September 2026 the Books page stopped opening on production. The
runtime log held the same two lines each time the owner tried it:
`/api/accounting/post` and `/api/accounting/overview`, each answering 500 with
`UnbalancedEntryError`. The thirty-eighth pass saw them in passing and reported
them; the operator agreed to start there. This round finds the cause, proves
it, and mends it. It also answers the second thing that pass saw, the
scheduler's hourly line written twice.

### The cause

One invoice. A single session had been sold at a whole-price discount — a
session given free — so its invoice was for nought and the credit it granted
was worth nought. `postingsFor` (`domain/accounting/posting.ts`) built the
entry it builds for every invoice, a debit to receivable and a credit to
contract liability, each of nought; and `assertBalanced` refused it, rightly,
because the journal holds no line of nought (`docs/SPEC/accounting.md` section
4.2). The refusal's own message was "Each line carries exactly one side,
greater than zero."

That would have been one invoice the books could not place. What made it the
whole page is that both routes walk **every** event not yet in the books: the
overview to count what is waiting (`classifyPending`), the poster to write it.
The error left each of them at the first event it met, so the overview
answered nothing at all, and the poster's transaction was rolled back with
everything in it — two ordinary events dated the same day were left unposted
behind the free one, and the nightly run would have failed on it every night.
Nothing was lost and nothing wrong was written: the journal on production
held two entries, numbered 1 and 2 with no gap, and no source posted twice.

The credit was a second fault waiting for its day. Used at a visit, it becomes
`credit.consumed` with an allocated net of nought, and the same refusal.

### How it was proved before it was mended

Production was read, not written: the events not yet in the books, as flags
and never as figures. Three were waiting; one invoice had a total, a net and a
VAT of nought and a discount equal to its whole price, and its one credit was
worth nought.

Then the fault was made to happen here. Seven new cases in
`domain/accounting/posting.test.ts` failed with production's own message. And
in `tests/accounting/db/posting.test.ts`, through billing's own route, a
session was sold with a discount of 10,000 basis points: the sale answered
201 with a total of nought, and the two Books routes then answered 500, as on
production.

### The rule

**An event worth nothing posts nothing** (`docs/SPEC/accounting.md` section 6,
rule 18, and a row in section 7's table). `postingsFor` answers null when
every figure the event carries is nought: an invoice of nought, a waived fee
of nought, a payment of nought, a credit worth nought that is used, restored,
expired or refunded. Null is what the rules already answer for a waived credit
with no replacement, so both callers knew what to do with it: the overview
does not count it as waiting, the poster writes nothing for it, and neither
calls it unknown.

**Every figure, and not the total alone.** An invoice with a total and nothing
sold behind it, or with a net and a total that disagree, is a fault in the row
and is still refused; two cases pin that, so the mend cannot become a way for
a bad row to pass quietly.

Billing is untouched. A free session is still sold, numbered, issued and filed
as any other invoice, with a total of nought, and its credit is still used at
the visit. Whether the practice should be able to give a session free is not
this round's question; it could, it did, and the books must not fall over when
it does.

### The scheduler's line, written twice

The host keeps two worker processes of the API alive, and each runs the
scheduler. Both jobs are safe to run twice and were built to be: the poster
takes a per-practice lock and writes through the journal's unique key, and the
sweep asks the store what is still there. Production's journal bears that
out. **Nothing was changed for it.** `docs/SPEC/hosting.md` section 12, which
was written for one process, now says what the host runs and what follows.

One thing does follow that is not harmless, and it is recorded there for the
operator's decision: the rate limiter's counters are each process's own, so
every budget of `docs/SECURITY.md` layer 3 is in effect multiplied by the
number of workers. It follows from the code; it was not measured against
production.

### Found beside it, and not fixed here

- **One bad event still takes the whole page with it.** Rule 18 removes the
  only such event the rules can produce from a row the database accepts, but
  the shape remains: an error in one event's posting stops the overview and
  every posting behind it. Counting such an event and carrying on would need a
  line on the overview to say so, since `unknownCount` is answered by the
  route and shown by no screen. A decision for the operator.
- **The overview asks four questions of one connection at once**
  (`app/api/accounting/overview.ts`, `Promise.all`). The database driver
  warns that it will stop allowing this in its next major version; the
  warning is in production's runtime log.
- **The host installs without the repository's lockfile**, so the driver and
  everything else run at versions no test ran
  (`docs/PRODUCTION.md`, the thirty-eighth pass).

### The tests

- `domain/accounting/posting.test.ts` — 24 (15 before): an invoice of nought
  of each of the four kinds that post, a waived fee, a payment, and a credit
  worth nought in each of its four events, each answered with null; an invoice
  whose figures do not add up, and one with a total and nothing sold, each
  still refused.
- `tests/accounting/db/posting.test.ts` — 23 (18 before), run with
  `pnpm test:db`: a session sold for nought through billing's route; the
  poster answers and writes nothing for the invoice; the overview answers
  with nothing counted as waiting; the visit uses the credit and nothing is
  written for it, while a payment taken afterwards is posted; a second run
  answers nothing and the books balance.

### Every file this round touched outside the trunk's own paths

Five, all the accounting stream's, riding in this round's own pull request by
the integrator's widening for one round (`docs/SPEC/OWNERSHIP.md`):
`domain/accounting/posting.ts` and its test; `tests/accounting/db/posting.test.ts`
and `fixture.ts` (one function exported); and `docs/SPEC/accounting.md`
sections 6, 7 and 12. The trunk's own half is `docs/SPEC/hosting.md` and the
documents. No migration, no policy file.

### Going live

**Merged is not live.** No migration and no policy file: a build only, by the
recipe, on the operator's word.

**Proof is not the client bundle**, because the rule runs on the server. The
proof is production's own journal and log, read and not written. Before the
pass the journal holds two entries and three events wait. After it, the first
time the Books page is opened, or at 03:00 that night, the two ordinary events
are posted and the journal holds four; the free session and its credit are
written nowhere; and the runtime log carries no `UnbalancedEntryError`.

**For the owner.** The Books page opens again. The session given free shows
on its invoice as it did, with a total of nought, and appears nowhere in the
books, because it moved no money.
