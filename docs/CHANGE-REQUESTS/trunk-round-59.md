## Round 59 — an act aimed at a household spares a colleague (2026-09-22)

Round 58 (`docs/CHANGE-REQUESTS/trunk-round-58.md`, "Found beside it") left
three items with one subject: what happens to a member of staff whose own
sign-in is also linked as a contact on a household's record, when that
household's access is ended — by the Portal screen's Revoke, or by erasing the
record. The operator approved the round on 21 September as the one to follow
round 58, and took its one decision on 22 September at 05:10 +04, half an hour
after round 58 went live. It was built the same morning.

### The decision

**Ending a household's access ends the link, not the colleague.** The contact
row is unlinked from their account and any portal-only role they held is
dropped; their sign-in, their working roles and their place in the team are
untouched. The account itself is ended only when it is a household's and
nothing else, which is what the Revoke button always did for households and
still does.

The alternative put to the operator was to refuse both acts with a clear
sentence and have the practice remove the person from the record's contacts
first. It was not taken because an erasure request on such a household could
then not be completed until somebody did that by hand, and an erasure is a
promise with a clock on it.

### How the case arises at all

Not from a screen. The invite route already refuses to issue a household link
against an account holding any role but `client_contact` and creates a separate
household account for the contact instead (`app/api/portal/access.ts`, piece
seven); Settings › Team grants working roles to staff alone (round 58). A
contact row pointing at a colleague's sign-in is therefore a data step's or a
seed's, and production had none on the morning of the pass that preceded this
round (the pre-pass read of the thirty-fourth pass, `docs/PRODUCTION.md`). The
schema is still made right about it, because an erasure has to be right about
every row it can meet, and because the same person can be linked that way
tomorrow by a step nobody has written yet.

### What it does now

**Migration `968_erasure_and_revoke_spare_a_colleague.sql`**, in the trunk's
range and numbered above 964, the last file that defined the erasure function
(964's own header sets that rule).

1. **`app.erase_client`**, restated as a diff of 964. Step 2, which archives the
   portal account behind every contact of the erased household, now skips any
   account holding a role other than `client_contact`. The contact rows are
   unlinked as before. A new step 2b then drops the `client_contact` role row of
   each spared colleague who no longer links to any contact of any household —
   the founder as a contact of two of her own children's records loses one link
   and keeps the portal for the other. Their `app_user` row is not touched. One
   new summary key, `staffAccountsSpared`; the client-record stream's readers
   pick keys by name and its tests use `toMatchObject`, so the key is additive.
2. **`app.unlink_household_contact(contact_id)`**, a security definer function
   for the Portal screen's Revoke on a colleague's contact row. Owner or admin
   only — read from `user_role` and not from the session's claim, for the reason
   923 gives — same practice, and the account must be a colleague's: a
   household's own account is refused with `that account is a household's, not
   a colleague's`, because for them the route's existing suspend is the right
   act and a function that quietly did two different things would be a function
   whose name lies about one of them. It nulls the link and drops the idle
   `client_contact` row the same way step 2b does. Every refusal is `42501`,
   told apart by its message, which is the family's shape.
3. **The lock order, dissolved rather than fixed.** Round 58's item 3 was that
   `app.revoke_staff_role` locks the colleague's `app_user` row and then the
   audit chain's, while `app.erase_client` took the chain first and the
   `app_user` row second — a deadlock on a person who is both. Once an erasure
   never touches a colleague's `app_user` row there is no second row for the two
   to disagree about. Not taken on trust: `tests/db/spare_a_colleague_race.test.ts`
   arranges the old geometry on three connections — the chain held by the
   erasure's side, the `app_user` row by the revoke's — and watches both finish.
   Run against 964 before the migration existed, the case took exactly the one
   second of `deadlock_timeout`, Postgres killed the revoke's side, and the
   erasure went on to archive the colleague. Against 968 both finish and the
   chain verifies.

   The new function's own place in that order: it locks the household's
   `client` row before it writes — the first lock `app.erase_client` takes — so
   an unlink and an erasure of the same household queue on that row rather than
   meeting in opposite orders on the contact row and the chain. It never locks
   `app_user`, so a revoke of the same colleague's working role has nothing here
   to wait on.

**The route**, `POST /api/portal/access/:contactId/revoke`. The branch that has
answered `409 staff_account` since round 58 calls the function, closes any open
invitation, writes one row to the trail — `portal.access.revoked` on the
account, with `means: unlinked` — and answers `state: none`: nobody has access
through that row any more, and nobody was suspended, which is what the list
shows when it reloads. `false` from the function means an erasure finished a
moment ago and already unlinked the row; the state is then what was wanted and
is answered as such, with nothing written. Households are unchanged, and their
trail row now says `means: suspended`. The narrative sentence, "ended this
household's access to the portal", is true of both acts and was left alone.

**The screen**, Settings › Portal. Error sentences are now one per refusal code
and a retry sentence per action for anything unnamed. The invite's
`not_a_household` — a contact whose account works at the practice — reads
"This person works at the practice, so a household link cannot be issued to
their sign-in." instead of "That invitation could not be issued. Try again.",
which it had said since piece seven and which no retry ever rewarded. "Try
again" is kept for failures the screen cannot name, because those are the ones
a retry can mend. With the route changed, Revoke no longer produces a 409 at
all.

### Proof

Tests first, every one watched red before the code that made it green:

- `tests/db/spare_a_colleague.test.ts` (new, the trunk's): an erasure completes
  for a household whose contact is an owner and leaves the owner's sign-in and
  roles alone; drops a spared colleague's portal role once no contact links to
  them and keeps it while another household does; still archives a household's
  own account exactly as before. The function: unlinks for an owner and for an
  admin, keeps the portal role while another link stands, writes the unlink and
  the dropped role to the trail under the actor, answers `false` for a contact
  with no account, refuses a household's account, a practitioner, an unnamed
  caller, a session that claims owner for an actor who holds finance, a contact
  of another practice and one that does not exist; is not callable by public.
  The chain verifies at the end.
- `tests/db/spare_a_colleague_race.test.ts` (new): the race above.
- `tests/db/owner_lock.test.ts`: the case round 58 pinned — "refuses an erasure
  that would archive an owner's sign-in" — failed the moment 968 was applied,
  which is what it was for, and now states the completing erasure.
- `tests/portal/db/routes.test.ts`: the case that pinned the 409 now asserts the
  unlink — 200, `state: none`, link gone, colleague active with sign-in and
  roles intact, invitation closed, one trail row with `means: unlinked`.
- `tests/portal/PortalAccessPage.test.tsx`: the colleague's sentence, and the
  retry sentence kept for an unnamed failure.

`pnpm verify` and `pnpm test:db` both green on the branch's head; the counts
are in the pull request.

### Every file this round touched outside the trunk's own paths

Four, all the client-portal stream's, riding in this round's pull request by
the integrator's widening for one round, as rounds 41, 51, 52 and 58 were
widened (`docs/SPEC/OWNERSHIP.md`):

- `app/api/portal/access.ts` — the revoke branch above, and one paragraph of
  the header comment.
- `app/admin/portal/PortalAccessPage.tsx` — the sentence table and the one line
  that reads it.
- `tests/portal/db/routes.test.ts` — one case rewritten.
- `tests/portal/PortalAccessPage.test.tsx` — two cases added.

The trunk's own half is migration 968, `tests/db/spare_a_colleague.test.ts`,
`tests/db/spare_a_colleague_race.test.ts`, `tests/db/owner_lock.test.ts`, and
the documents. `domain/shared/audit-narrative.ts` was read and deliberately
not changed. `docs/SPEC/00-data-model.md` is not edited: it lists neither
function.

### Found beside it, and not fixed here

1. **The founder cannot be given portal access to her own child's record from
   the screen.** The invite route's refusal (`not_a_household`) is piece
   seven's design and is correct for what it guards — a link rebinds the
   account it names, and hers is the console's. A colleague who is also a
   parent therefore reaches the portal only through a second, household-only
   account, which the screen will create for a contact row with no account
   behind it. That is a fact worth the operator knowing, not a fault; if the
   practice wants one sign-in to do both, that is a design of its own.
2. **Round 58's small deferred items stand where they were** (`trunk-round-58.md`
   "Found beside it", item 6): the race case's fixed 300 ms wait, the leaked
   connection, the `setEmail`-then-`deleteUser` chain on the fake provider, the
   three routes' roles-only target read, and the dropped press on a busy switch.
   None of them is this round's subject.

### Going live

**Merged is not live.** One migration and no policy file, so a small pass:

1. The hold protocol.
2. `968_erasure_and_revoke_spare_a_colleague.sql` by hand, staging first and
   then production, the file's statements whole and its bookkeeping row in the
   same call, with the sha256 of the file's text taken from `main` after the
   merge. Both ledgers then read **111**.
3. Fingerprint the two functions against a runner-built local database:
   `app.erase_client` and `app.unlink_household_contact`, each with its definer
   flag, its pinned search path, and who may execute it — `app_role` may run
   both, `public` neither — and the ledger. The grant on the new function is in
   the migration, so nothing else is re-applied.
4. Then the code, by the recipe, and the proof read out of the served bytes: the
   Portal screen's chunk carries "works at the practice" and the old chunk
   404s.

**Old code on the new function is safe in both directions.** The old route's
staff branch answers 409 before any write and never calls the new function; the
new erasure body is what the old route's erasure call reaches, and it is the
safer one. So the window between the migration and the build is the safe
direction, as it should be.

**Nothing to run on production's rows.** No colleague is linked as a contact
there today, so the migration changes no data, and the function is called only
by a button.
