## Round 52 — the review line on the household portal (2026-09-17)

### Why the round happened

The owner asked for the app to send a client to the practice's Google review
page "after brain mapping, or after a number of sessions or the end of a
package". `docs/SPEC/client-portal.md` section 4 says "no nudges", and the
rule was right for everything the portal said until now. On 16 September the
owner decided the exception on her own terms: one quiet line on the portal
home, shown once per milestone, dismissable, never repeated, opening the
practice's own Google page rather than a rating widget inside the app. The
decision is recorded in that spec's section 4 beside the rule it amends, and
the design is `docs/superpowers/specs/2026-09-17-review-prompt-design.md`.

Sequence, also the owner's: its own pull request, after the expo's (round 50)
and the past sessions' (round 51).

### What landed in the shared zone

**Two milestones, one pure rule, nothing stored.** `reviewMilestones`
(`domain/portal/reviewPrompt.ts`) reads the visits, purchases and credits
the portal already reads and answers with at most one milestone per client:
a completed visit whose service carries the code `brain-map`, or a purchase
whose `packageProgress` reads used equals total. Four calls the design note
records: ninety days, so a history the office logs from paper (round 51)
never raises a line for a visit from a year ago; one line per client, the
most recent; adults only, by the same rule that shows a client's money; and
nothing at all where the practice has recorded no review page.

**Migration `920_practice_review_url.sql`**, trunk first half: `tenant.review_url`,
the shape of 912's website column. `PATCH /api/practice` writes it whenever
the body carries it, null included — unlike the three footer fields, whose
`coalesce` stands — because clearing the link is how the line is switched
off for every household. On the Practice settings drawer as "Google review
link (optional)".

**Migration `704_portal_review_prompt.sql`**, the portal's range: one
append-only row per answer — the client, the milestone by kind and id, who
answered, which way, when — unique per client and milestone, so a household
is asked once whichever adult answers. Select and insert only. The policy in
`db/policies/portal/access.sql`: a contact writes for their own client, the
office reads, nobody else writes, nobody updates or deletes.

**`domain/shared/actor.ts`**: `portal.review.answer`, the shape of
`portal.request.write`. **`domain/shared/audit-narrative.ts`**: the sentences
for the answer, both languages.

**The vendor register**: a row for the practice's own review page as a
hand-off, beside the WhatsApp one: nothing from this server; the household's
browser opens the practice's public page on a deliberate press with no
referrer. The Google Maps Platform row is not widened by it.

**Documents**: `docs/SPEC/client-portal.md` sections 3.1, 4, 5, 6.4, 6.5,
6.6, 7, 9 and 12 (amended in place, dated), `docs/SPEC/00-data-model.md`
(`tenant`, and a `portal_review_prompt` entry), `docs/SPEC/OWNERSHIP.md`
(the widening), the design record, and this note.

### Every file this round touched outside the trunk's own paths, by stream

**`client-portal`** — `domain/portal/reviewPrompt.ts` (new) with its test
and the barrel. `db/migrations/704_portal_review_prompt.sql` (new), in the
stream's own range. `db/policies/portal/access.sql`: the third table in the
isolation loop and section 4. `app/api/portal/schema.ts`: `reviewUrl` on
the practice, the `review_prompt` notice kind, the answer's body and reply.
`household.ts`: the column. `home.ts`: `reviewNoticesFor`, three reads and
the rule, appended after what is waiting. `review-prompt.ts` (new): the
answer route. `mount.ts`: one line. `app/client/HomeScreen.tsx`: the review
line as its own block between what is waiting and how to ask for a visit,
with the local state that removes it the moment it is answered.
`app/client/portal.css`: one class. `app/client/i18n/dictionary.ts`: three
entries in both languages. `tests/portal/fixtures.ts`, `screens.test.tsx`,
`db/support.ts` (a brain-map service and a service on `seedAppointment`),
`db/routes.test.ts` (the line absent, offered, aged out, refused to a young
person, answered once, idempotent, gone; one expectation widened where the
new fixture visit appears in the past list) and `db/policies.test.ts` (one
deny test per grant).

The trunk's own: `app/api/practice/schema.ts` and `routes.ts`,
`app/admin/settings/PracticeDrawer.tsx` and `PracticePage.tsx` with the
page's test, `tests/db/practice.test.ts`, one fixture line in
`app/shell/App.test.tsx`, `domain/shared/actor.ts` and
`audit-narrative.ts` with their tests, migration 920 and the documents.

No new dependency, no seed change.

### The two migrations, and which half each sits in

920 alters `tenant`, a core table, so it is a trunk migration a stream may
build on: the `900–949` half, the next free number after round 50's 919.
704 creates the portal's own table and sits in that stream's range, as 700
to 703 do; its `-- Needs:` names 000, 010, 020, 060, 080, 097 and 099 and
nothing above its own number. `pnpm audit:migrations` finds no merged file
edited; each rollback block runs as pasted.

### The three reviews, and what they changed

`compliance-reviewer`, `security-reviewer` and `schema-reviewer` each passed
the round; every finding was taken before the pull request opened:

- **An answer names a line the home is offering** (the security review's
  one medium finding). The route first computed nothing and accepted any
  uuid, so a signed-in household could write permanent rows — the table's,
  the trigger's and the action's — for milestones it was never shown, one
  per random id. Now `reviewStateFor`, the home's own computation, decides:
  a milestone neither offered nor already answered is a 404 and nothing is
  written. Tested with a forged id. It also makes "never a young person's
  own login" true twice over, since that login is offered nothing.
- **The answering contact is the person signed in**, at the table as well
  as in the route: the writers policy binds `contact_id` to a contact row
  on that client carrying `app.current_actor_id()`. Tested.
- **704's header says why `contact_id` sits beside `created_by` and why
  `outcome` is kept** (the compliance review's two stated-need gaps), and
  why the two closed sets are text with a check (the schema review). The
  redundant `answered_at` is gone; `created_at` is when the answer was
  given. The `(client_id, created_at)` index the neighbours carry is added,
  and the rollback prose names the isolation loop's entry.
- **The vendor row names the owner and says "whichever host"**, since the
  column accepts any page with a scheme and the register must cover the
  destination the owner actually records.

Decisions written down for the reviews:

- **A second answer is idempotent, not refused.** Two phones pressing "not
  now" on the same evening is not an error anybody needs to hear about; the
  action row is written once, on the insert that landed.
- **No consent purpose is checked.** Nothing leaves the record and nothing
  is sent to the household; the line is a sentence on a screen they opened
  and a link their own browser follows. The `marketing` purpose the push
  round will need (round 50's note) is not this.
- **Adults only, by the money rule.** `moneyVisibleTo` is already "not a
  young person's own login", and the purchase and credit rows are refused to
  that login beneath the route in any case; a second rule would say the same
  thing twice and could drift.

### Deliberately not done

A star rating inside the app; a reminder by any channel; a second line after
a "not now"; an office view of who answered beyond the audit trail; the line
for a young person's own login; any prompt where the practice has recorded
no review page. The push-notification round's prerequisites stand as round
50 recorded them.
