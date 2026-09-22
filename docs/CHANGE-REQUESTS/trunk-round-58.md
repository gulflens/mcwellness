## Round 58 — a profile for each member of staff, and access that can be switched off (2026-09-22)

The operator asked on 21 September 2026 for Settings › Team to stop being a
list of rows and become an employee's profile: details that can be corrected,
four role switches that go on **and off**, and two people — the founder and one
other — holding full access that nobody can take away. Reading the team's
routes to design that turned up a fault in one of them; it was fixed first, in
its own pull request, as round 57 (`docs/CHANGE-REQUESTS/trunk-round-57.md`),
and is live. This is the piece the operator called A. He also asked for staff
documents and for pay on the same profile; those are pieces **B** and **C**,
sequenced after this one and deliberately not built here — C is the books' own
piece fourteen (`docs/SPEC/accounting.md` section 14), because every pay run
posts. The round began on the 21st and finished overnight.

### The six decisions

Every one is the operator's, taken on 21 September 2026 as the design was put
to him; the spec's own table is the source
(`docs/superpowers/specs/2026-09-21-team-profiles-and-access-design.md`).

| Decision | Choice | When |
|---|---|---|
| What a switch controls | a **role** — Admin, Finance, Practitioner, Lead practitioner. Not an area of the app, and not a single action | 21 September, as the design was settled |
| The second person with full access | becomes a second **owner**; both owners are locked — from admins, from each other, and from themselves | 21 September |
| Who manages the team | **owners only**. An admin still sees the list, and nothing else | 21 September |
| The temporary password | the owners' too, so an admin mints one for nobody | 21 September, the same evening, on reading round 57's security review |
| What the profile holds | name, email address, telephone, language and status; and job title, start date, an emergency contact and the owners' private notes | 21 September |
| Sequence | this piece (A), then staff documents (B), then pay (C, the books' piece fourteen) | 21 September |

The fourth needs its reason recorded, because it reverses the operator's own
first answer. That answer left the temporary password with admins for a
colleague who is not an owner. Round 57's security review pointed out that its
fix protected ownership and nothing else: a temporary password **is** a
sign-in, so an admin who mints one for a colleague holding Finance has the
books, and for one holding Lead practitioner has the trail and the reports, by
one remove. A narrower rule was considered — an admin may, for somebody holding
no role the admin lacks — and not taken, because it is exact and cannot be
explained across a desk. With two owners there is always somebody to ask.

### What it does now

#### The rules, which both layers quote

`domain/shared/staff.ts` gained `isLocked(roles)` — any row that holds
ownership, whatever else it holds — and two rules built on it. `canSwitchRole`
answers either `null` or the reason it is no, in the order a person would want
telling: `not_a_working_role` (ownership and a household's contact row are
neither of them offered, in either direction), `not_yourself`, `locked`, and —
only when switching off — `last_role`. `canEditProfile` says an owner may edit
anybody who is not an owner, and that an owner's row is that owner's alone.
`STAFF_ROLE_OPENS` is one plain sentence per role, so the bundle a switch moves
is not a mystery to the person flipping it. `canResetPassword` keeps round 57's
signature and narrows its meaning to an owner, and still refuses outright when
the target's roles could not be read, because a check that cannot see must not
answer yes.

`domain/shared/actor.ts` gained the action `staff.access.manage`, the owner's
alone: adding a person, opening and saving a profile, switching a role,
suspending, reactivating and minting a temporary password. `staff.manage` keeps
the team **list** for an owner and an admin, and nothing else. `user_role.grant`
narrowed in the same breath: a `client_contact` row stays an admin's to hand
out, because an admin invites a household, and every other role is the owner's.

`canGrantTo` was deleted. `canSwitchRole` subsumes it, the route that called it
is gone, and the reasoning its comment carried — round 39's security review
finding that nobody widens their own access — now sits on `canSwitchRole`'s
`not_yourself` line, with its test widened to both directions: narrowing your
own access is the same act from the other side.

#### The database floor

**`staff_profile`, the owners' alone** (migration `922`). One row per member of
staff, keyed on `user_id`: `job_title`, `started_on`,
`emergency_contact_name`, `emergency_contact_phone` (E.164, as `app_user.phone`
is), `private_notes`. It exists because `app_user` is read practice-wide — a
name appears on every screen — and a third person's telephone number and an
owner's notes about a colleague must not be there.
`db/policies/core/staff_profile.sql` is one restrictive policy, `for all to
app_role`, `using` and `with check` both `app.actor_has_role('owner')`; the
table joins the tenant fence in `tenant_isolation.sql`; and it carries the audit
trigger. **Not the person themselves**, deliberately: a note about somebody
that they can read is a different thing from the one the operator asked for. It
also carries `unique (tenant_id, id)`, which `099_tenant_scoped_keys.sql`
requires of every tenant-scoped table and a database test enforces, and — added
on the round's final review — the same rule pointing outwards: `foreign key
(tenant_id, user_id) references app_user (tenant_id, id)`, so a profile cannot be
about another practice's colleague. It stands beside the plain `user_id`
reference rather than replacing it, because `unique (user_id)` is what the save's
`on conflict (user_id)` depends on and is what makes one row per **person**
rather than one row per pair.

**Two triggers that bind every caller** (migration `923`).
`guard_owner_role`, before update or delete on `user_role`, refuses any change
to a row whose role is already `owner` — judged on `OLD` alone, so granting
ownership is untouched and everything afterwards is refused.
`guard_owner_identity`, before update on `app_user`, refuses for a row holding
ownership four things: any move of the row itself — its `tenant_id` or its `id` —
any status other than `active`, any move of a non-null `auth_id`, and any change
to the name, the email address or the telephone unless the actor is that same
person. The first of the four was added on the round's final review and comes
first because the rest depend on it: this trigger asks `user_role` whether the
row holds ownership, by `(user_id, tenant_id)`, so a row whose `tenant_id` had
moved would leave its ownership row behind in the practice it came from and the
next update of it would find no ownership and refuse nothing. The lock would have
unlocked itself, quietly. Both triggers are `enable always`, so `session_replication_role`
cannot switch them off, and **neither carries a bypass setting**: a setting the
API role could set is not a lock. Linking a sign-in for the first time, null to
a value, is allowed, because that is how an owner arrives and how the bootstrap
and the test harness give one their sign-in.

Nothing deletes an owner's `app_user` row either, and no trigger says so:
`user_role.user_id` references `app_user (id)` with no `on delete`, so the
delete raises a foreign key violation while the ownership row stands — and that
row is the one `guard_owner_role` will not let go. The two facts lean on each
other on purpose. Where the lock ends is written in the migration rather than
left to be found: a row trigger does not fire on `TRUNCATE`, and nothing here
stops a caller who can drop the trigger; both need the truncate privilege or the
table's ownership, which `app_role` holds neither of, so both are the same act
as the migration itself. **Undoing this is a migration's act**, which is exactly
where the design puts the undo.

**`app.revoke_staff_role(uuid, role_kind)`** is the one way a working role
leaves the table. The API role holds no delete grant on `user_role` and gains
none, so the function is security definer and therefore states every rule in
full: the actor must be named; the actor must be an owner; the role must be one
of the four working roles, **and not null** — `null not in (…)` is null rather
than false, so without saying so the function read every rule below it as unknown
too, reached its own delete, removed nothing and answered `false`, which is the
word it uses for "they did not hold that role" (the round's final review); not
oneself; the target must be in this practice; the target must not hold ownership;
and the target must be left with at least one working role. Each of the seven
refusals is `42501` with its own sentence. **Deleted, not
marked revoked.** A `revoked_at` column was considered and not taken: roles are
read in several places — `app.resolve_actor`, the team list,
`owner_keeps_identity`, the portal's own functions — and a reader that forgot
the new column would treat a revoked role as live, so the design would fail
open. A row that is gone fails closed, and `app.audit_row` keeps the old values
in the trail, which is where history lives on this platform.

**One row lock, and why it is needed.** Between the colleague-exists check and
the count that decides, the function takes `for update` on that colleague's
`app_user` row. Nothing in this repository sets an isolation level, so every
request runs `READ COMMITTED`: without the lock, two owners taking two
*different* roles from the same person at the same moment each read the other's
role as still present, delete different rows, conflict over nothing, and both
commit — leaving that person with no working role at all, which is the one state
the last-role rule exists to prevent and the one the app cannot undo, because a
person with no working role falls out of the team list and is refused
everything. The lock is on the person and not on the role rows, so it serialises
every revoke against one colleague and leaves revokes against different
colleagues concurrent. It was found by the round's schema review and is covered
by a test described under Proof.

**Who is an owner is read from the rows, not from the session.** The first
version asked `app.actor_has_role('owner')`, which reads `app.actor_roles`,
while the line beside it read a different setting, `app.actor_id`, for who the
caller is. Two settings that can disagree are two answers to one question, and
inside a security definer function the answer is the whole boundary rather than
a courtesy above one. The check is now the database's own fact: a `user_role`
row for this actor, in this tenant, saying `owner`.

**`role_guard.sql`, with the portal's one carve-out.** `app_user` and
`user_role` came out of the two-table loop and are written table by table,
because the rule on them is no longer the same for both verbs or both tables:
insert on `app_user` unchanged (a row with no role is inert); update on
`app_user` an owner, or an admin for a row holding no role but `client_contact`;
insert on `user_role` an owner, or an admin for a `client_contact` row; update
on `user_role` an owner. The carve-out is what the household portal depends on —
an admin invites a household, which inserts an `app_user` and a
`client_contact` row and later suspends it (`app/api/portal/access.ts`).
`credential` and `service_type` keep the rule they have always had, the owner or
an admin, because Settings › Practitioners is not this piece.
`owner_keeps_owner` and `owner_keeps_identity` stand as
the courtesy above the triggers and agree with them: row security answers a
refusal as "nothing to update", which is what a screen should show, and the
trigger answers it as an error, which is what a lock must do.

**And ownership is not written by the API role at all**, an owner's own request
included. `owner_grants_owner` and `owner_keeps_owner` admitted an ownership row
from an owner until the round's final security review, which pointed out what
that left standing: `isStaffRole`, one line of TypeScript in
`app/api/team/roles.ts`, was then the whole barrier between a screen and a
permanent grant of full access to the practice — permanent in the strict sense,
because `guard_owner_role` refuses every later update and delete of that row for
every caller, so a mistake is corrected by a migration and by nothing smaller.
Both policies are unconditional now, for insert and for update alike, and the
insert is the act migration `923` deliberately says nothing about, so this policy
is the whole of the floor rather than the polite half of it. Nothing legitimate
loses anything: the runbook's `do` block runs as the connecting role and never
`set local role app_role`, and `app.bootstrap_practice` is security definer and
writes the first owner as its own owner. Ownership is granted by an audited data
step and by nothing else.

**Redaction is migration `967`, not `924`, and the number is the point.**
`app.audit_redact` gains all five of `staff_profile`'s own columns —
`job_title`, `started_on`, `emergency_contact_name`, `emergency_contact_phone`
and `private_notes` — so the trail records that they changed and never what they
said.

**Five and not three**, which the round's final security review settled. The row
rule says the owners and nobody else and means it; but `audit_log` admits an
owner, an admin **and** the lead practitioner, and `app/api/audit/activity.ts`
answers old and new values for every entity type it is asked about. A job title
and a start date left off the list therefore reached two of the three people this
table was created to keep them from, through
`GET /api/audit/activity?entityType=staff_profile` — a walk around the row rule
rather than through it. Both are generic column names, so the check 965's header
makes was made again here: no other table in the schema has a column called
`job_title` or `started_on` (every migration read on 22 September 2026), and
whoever adds one elsewhere should know it will not reach the trail.

Migration `965` restates the same function in full, because
`create or replace` resets every attribute and a migration that adds a key must
restate the whole of it; the runner applies pending files in numeric order; so
on a fresh database a file numbered below 965 would run first and then be
silently overwritten by 965's own restatement, and the five columns would go
straight back to being legible in the log. 967 sorts after 965, so its
restatement is the one left standing.

#### The API

`app/api/team/routes.ts` was one file and is now four: `routes.ts` (the list, a
new colleague, suspending, the temporary password, and the mount), `profile.ts`,
`roles.ts` and `target.ts`, the last of which is how every route reads the
person it is about. `schema.ts` is the wire, as it was. The split changed no
behaviour and was made because the one file had passed 550 lines.

| Route | Who | What |
|---|---|---|
| `GET /api/team` | owner, admin | as before, plus `locked` on every row; `jobTitle` selected for an owner only |
| `POST /api/team` | owner | as before |
| `GET /api/team/:id` | owner | the row and its profile, logged as a read of a person |
| `PATCH /api/team/:id` | owner; for an owner's row, that owner alone | name, address, telephone, language and the five profile fields |
| `PUT /api/team/:id/roles/:role` | owner | switch on, idempotent |
| `DELETE /api/team/:id/roles/:role` | owner | switch off, through `app.revoke_staff_role` |
| `POST /api/team/:id/status` | owner | as before; an owner's row answers `locked` before the update, not after it |
| `POST /api/team/:id/password` | owner | as before; anybody else is refused, and the refusal is a row |

`POST /api/team/:id/roles` is gone; the screen was its only caller. A refusal
carries a code the screen turns into a sentence: `locked` and `last_role` are
409, `not_yourself` and `not_a_working_role` are 400, `email_in_use` is 409 and
`sign_ins_unavailable` is 503. One more, `conflict` (409), is not a rule but a
race: the refusals inside `app.revoke_staff_role` all share one SQLSTATE, and
guessing which of them spoke would put a sentence on the screen that may be
untrue, so the screen says the profile has changed and to open it again.

**An address is two writes, and the boundary is said honestly.**
`app_user.email` is what the practice reads, and the sign-in service holds the
same address as the way in, so the service changes first
(`AuthAdminProvider.setEmail`, confirmed without a message as `createUser` is)
and the row second. If a statement then fails, the address is put back and the
failure is rethrown, which is what rolls the row back with it. **What that does
not cover is a failed commit.** The commit happens after the route has
returned, so a commit that fails afterwards leaves the sign-in holding the new
address and `app_user.email` holding the old one, with nothing marking it. It is
deliberately not compensated, and the consequence is bounded: the fence resolves
a person by `auth_id` and never by their address, so they can still sign in, and
sending the same save again repairs the row. An address that was null before
cannot be put back at all, because nothing in the seam unsets one; the code says
so where it happens.

**The password route keeps the wider first guard on purpose.** It asks
`staff.manage`, not `staff.access.manage`, so that an admin's attempt reaches
`canResetPassword`, is refused there, and is written to the trail as
`password_reset_refused`. A bare 403 at the first guard would refuse the same
request and leave no row, and the screen offers no such button, so an attempt
that reaches here was made by hand — which is the act the trail exists for.

Every update in the folder reads its row count and none answers success on
none. That is the floor beneath the guards, and it is needed because row
security now answers a forbidden update with **silence** rather than an error:
it matches no row and raises nothing.

#### The trail says it in words

Five sentences in `domain/shared/audit-narrative.ts`, each naming no role, no
field value and no person, because the trail's own columns already carry who and
whom:

| Act | English | Arabic |
|---|---|---|
| `user_role.delete` | took a role away from a colleague | أزال دورًا عن موظف |
| `staff_profile.insert` | recorded a colleague's staff profile | سجّل ملف موظف |
| `staff_profile.update` | changed a colleague's staff profile | غيّر ملف موظف |
| `app_user.password_reset` | minted a temporary password for a colleague | أصدر كلمة مرور مؤقتة لموظف |
| `app_user.password_reset_refused` | was refused a temporary password for a colleague | رُفض له إصدار كلمة مرور مؤقتة لموظف |

The Arabic was written after the round's review of the first attempt, which
had put the English words in both slots on the argument that these five acts
belong to an English-only console screen. That argument was wrong: every
comparable staff-only sentence in the catalogue — the activity feed, the
equipment register, the books — carries real Arabic, and the lint rule that
makes the console English governs `app/admin` and `app/therapist` markup, not
`domain`, where a sentence is still stored, served and printed. Every word
reuses vocabulary the repository already holds: `موظف` is the word the Arabic
consent documents use for the practice's own staff, chosen over `زميل`
("colleague"), which has no precedent anywhere in the catalogue. Until this
round, `password_reset` had no sentence at all and the timeline showed the raw
code.

#### The screen

The list keeps name, email address, roles and status, gains the job title under
the name, and loses its row of "Add …" presses for one **Open**. An owner sees Open
on every row and "Add a person" in the header. **An admin sees the rows and no
button anywhere** — and no actions column at all, rather than an empty one with
a heading and a hairline.

Open is a right-side drawer with two tabs. **Profile** holds the fields under
three quiet subheads, the telephone through `PhoneField`, the date through
`DateField`, saved with one button; the boxes are checked against `ProfileBody`
itself, the parser the route parses with, so there is no second copy of the
contract to drift. A profile that is not the reader's to change reads back as
facts with no Save, rather than as disabled boxes, which cannot be focused and
so cannot be read out. Beneath Private notes it says: "Contract terms and
reminders. Nothing about health. The person may ask to see what is written
here."

**Access** is four switches and, beneath them, the sign-in. Each switch is a
real control — `<button role="switch" aria-checked>` — with its
`STAFF_ROLE_OPENS` line as its description, and `canSwitchRole`, the same pure
rule the route asks, decides what is pressable. A switch that will not move is
`aria-disabled` and stays in the tab order rather than being `disabled`,
because the sentence under it is the only explanation and a disabled button can
never be landed on to hear it; the press is refused in the handler. **A refusal
is said beside the switch it is about**, in a live region that exists from the
first render, not at the top of the tab where at a narrow width it would be off
the screen; and the switch goes back to where it was. An owner's drawer shows
"Owner. Full access. Cannot be changed." with four greyed switches beneath it
and no Suspend. On an owner's **own** row there is no sign-in section at all:
Settings has a Password screen for a person's own password, and a reset beside a
colleague's controls is a surprise — the API still allows it, and this is a
decision about what the screen offers. On the **other** owner's row, New
temporary password stands, because that is how a locked-out owner gets back in.

### Proof

Every task was watched failing before it was watched passing, and the failures
are recorded where they are not the obvious one.

- **The rules.** `domain/shared/staff.test.ts` and `actor.test.ts` were run
  against the old implementation: seventeen failures, from
  `isLocked is not a function` to `canResetPassword(['admin'], ['finance'])`
  answering true where the narrowed rule answers false.
- **The table.** `tests/db/staff_profile.test.ts` failed with
  `relation "staff_profile" does not exist`, then passed: an owner reads the row
  and each of admin, finance, lead practitioner and practitioner reads nothing;
  an admin's update touches no row and an admin's insert is refused; another
  practice sees nothing; one row per person; a telephone number that is not
  E.164 is refused; and a row whose person belongs to another practice is refused
  `23503` by the composite key, which was red as a plain success before that key
  existed. The redaction case proves its own search expression works — the row's
  own `user_id` **is** found in the trail by the same expression that finds none
  of the five values — so a zero is redaction and not a typo. That control was
  the job title until the final review put the job title on the redaction list;
  the case then went red on the job title's own text, which is what a control
  that has become a subject looks like.
- **The lock.** `tests/db/owner_lock.test.ts`, twenty-three cases — nineteen when
  the task was built, four more on the final review — of which the
  first sixteen were written before the migration and thirteen of them were red,
  including the one that matters: the ownership row was deleted successfully.
  Afterwards: an ownership row refuses update and delete for every
  caller, the superuser included; an owner cannot be suspended, archived or
  moved to another sign-in; an owner may correct their own details and not the
  other owner's; a colleague who is not an owner is still editable and
  suspendable; and `app.revoke_staff_role` refuses each of its cases, each
  assertion naming the message as well as the code, because seven refusals share
  one SQLSTATE and the case has to say which one spoke. Four cases were added on
  the final review, each red first in the shape that matters: moving the second
  owner's `tenant_id` **succeeded**, which is the lock unlocking itself;
  `app.revoke_staff_role(…, null)` returned `false` rather than raising; and
  inserting an ownership row as `app_role` with an owner's roles **succeeded**,
  as did turning a finance row into one. The same insert as the superuser still
  works, which is the runbook's path and is asserted beside them.
- **The race.** The test asserts **which row** the second owner is queued on,
  and that detail is the whole test. Every audited write already queues on one
  row of `app.audit_chain` until the previous writer commits, so with the lock
  absent the second owner blocks anyway — on the audit trail, which proves
  nothing about this rule. A bare "has it not settled?" assertion would have
  passed with the fix missing. `pg_locks` says which tuple a waiter is queued
  for, so the case asks it: with the lock commented out it reported
  `app.audit_chain` where `app_user` was expected. Run from a throwaway script
  with both transactions allowed to commit, the lock-less function left the
  colleague holding no working role at all.
- **The API.** `tests/db/team.test.ts` was rewritten first and run against the
  old routes: twelve of twenty red, in the two shapes expected — 404 where a
  route did not exist yet, and 200 or 500 where 403 or 409 is now right. Two of
  those 500s carried SQLSTATE `42501`: the old routes, still letting an admin
  through, meeting the new floor. The file now holds twenty-four cases and
  nothing skipped. The twin cases that drive every act as an admin read the row
  and its roles back in full afterwards, because beneath the route a forbidden
  update is silence and only the read-back tells a missing guard from a working
  one. The put-back case asserts the exact two calls — the new address, then the
  old — and that `app_user.email` never moved.
- **The sign-in seam.** `tests/portal/auth-admin.test.ts` failed with
  `setEmail is not a function` and now covers six branches across both
  implementations: the request shape, a taken address, an outage, and the fake's
  move, collision and self-address cases.
- **The sentences.** `domain/shared/audit-narrative.test.ts` failed three times
  over, once with `recorded password_reset on the user` — the generic fallback,
  caught on tape — and again, four red, when the Arabic was asserted against the
  English-in-both-slots version.
- **The screen.** `TeamPage.test.tsx` and `TeamMemberDrawer.test.tsx` were
  written first: the drawer's file would not resolve and four of the page's
  cases failed. Twenty-six cases now, and three of them exist because a review
  found that the three guards standing between a typo and a silent save as
  "nothing recorded" had no test at all; they were made red by breaking the
  guard, and they are what turns red the day either shell control moves its `id`
  onto a wrapper.
- **The whole gate.** `pnpm verify`: prettier, lint, types, the secrets scan and
  the migration audit clean, and **3,075 tests across 257 files**, with one
  skip that is not this round's (`tests/security/static.test.ts`, pre-existing).
  `pnpm test:db`: **1,559 tests across 109 files, none skipped** — the two cases
  parked while the API was being written were un-skipped and rewritten, and the
  suite ends with `app.verify_audit_chain()` answering null.
- **The final fix wave**, whose own changes were watched failing first wherever
  they change behaviour. The portal's revoke answered **200** where 409 is now
  right. The list reload behind an open drawer put the keyboard on the drawer's
  **close button** — the one fault of this round that a browser found and no test
  could, now
  pinned by a case in `TeamPage.test.tsx` that opens the drawer, focuses the
  Finance switch, flips it, waits for the list to really reload and then asks
  where the keyboard is; made red once by inlining `onClose` again, which is the
  one edit that would break it. `staff_profile` narrated in Arabic as
  "اطّلع على staff profile" — an English table name in the middle of an Arabic
  sentence. And `GET /api/team/:id` wrote one read where two are owed.
- **Looked at, twice.** The screen was driven in a browser against a real
  database and a real API at 1440, 1200, 768 and a drawer dragged to its 320px
  floor, and again at 768 after the review's fixes. Six faults were found by
  looking and not by a test: focus thrown to the close button on every list
  reload, a switch losing focus the moment it was pressed, a sentence about
  suspending under a row with no Suspend, a greyed "off" switch that was all but
  invisible, an admin's empty actions column, and a Profile draft silently
  thrown away by a glance at Access. A refusal was provoked for real — a role
  deleted in the database behind the screen's back, then the switch flipped —
  and the sentence stood under that switch, on screen, 650 pixels down.

### Every file touched outside the trunk's own paths

Seven, in two streams, and each for a reason this round could not avoid.

- **`app/api/portal/access.ts`** and **`tests/portal/db/routes.test.ts`** (the
  client-portal stream's). The household portal's revoke path, because **this
  round broke it**. `role_guard.sql` now leaves a member of staff's `app_user`
  row to the owners, so the revoke's `update app_user set status = 'suspended'`
  matches no row for an admin and raises nothing: for a household contact whose
  account is also a member of staff, the household kept its access while the
  trail recorded that the access had been revoked. A round does not hand another
  stream a fault it caused, and the fix is the smallest one that removes it —
  the same question the invite path a few lines above already asks, asked before
  any write, answered `409 staff_account`, writing nothing and logging nothing;
  plus the row count on the update, so no row suspended is never answered as
  `revoked`. **What revoking a member of staff's household access should MEAN is
  not decided here** and is round 59's, with the erasure of the same shape.
- **`app/api/portal/auth-admin.ts`** and **`tests/portal/auth-admin.test.ts`**
  (the client-portal stream's). `AuthAdminProvider` gained `setEmail`. The seam
  is shared — trunk round 39 built the team routes on it — and a provider method
  cannot live anywhere else. The addition is additive and breaks no caller: the
  one hand-rolled provider elsewhere in the tests spreads the fake and inherits
  the method.
- **`tests/portal/db/support.ts`** (the same stream's). One line: the harness's
  `callAs` accepts `PUT` and `DELETE`, which the two new role routes need.
- **`app/admin/clients/Tabs.tsx`**, moved to **`app/shell/components/Tabs.tsx`**,
  and the one import line in **`app/admin/clients/ClientDrawer.tsx`** (the
  client-record stream's). Two modules now need the same tab strip, which is
  `docs/SPEC/OWNERSHIP.md`'s own rule for a thing two modules share; the
  precedent is trunk round 36's move of `CoordinateFields`. The component moved
  unaltered but for one sentence of its own doc comment that the move made
  false; once it was the shell's it gained one optional `label` prop, defaulting
  to the value it always had, because a staff profile's tab strip announced as
  "Record sections" names the wrong record — and that is an edit to a trunk path
  rather than to the client record's.
  `app/admin/clients/clients.css` was deliberately not touched: its
  `.tabs__panel` rule is identical to the one now in `app/shell/shell.css`, so
  that stream removes it when it is next in the file.

Everything else is the trunk's own: `domain/shared/**`, `app/api/team/**`,
`app/admin/settings/**`, `app/shell/**`, `db/migrations/922`, `923` and `967`,
`db/policies/core/**`, `tests/db/**`, one comment in
`scripts/audit-secrets.mjs` naming the second placeholder password's new file,
and the documents. `docs/SPEC/OWNERSHIP.md` records both widenings.

### Found beside it, and not fixed here

**Three belong to round 59, which the operator approved on 21 September** — the
first of them before this round's first line of code was written, and the other
two added to its scope as they were found. They are one subject: an act aimed at
a household reaching an account that is also a member of staff. The second of
them had a half this round caused, and that half was fixed here rather than
handed on. **All three were answered by round 59 on 22 September**
(`docs/CHANGE-REQUESTS/trunk-round-59.md`, migration 968): ending a household's
access ends the link and never the colleague; the third dissolved once an
erasure stopped touching a colleague's `app_user` row, and a race test holds it.

1. **Client erasure unlinks the sign-in of every contact of the erased client,
   staff included.** `app.erase_client` archives and unlinks the `app_user` row
   of every contact, with no check that the account belongs to somebody who
   works at the practice. **Before this round that would have silently and
   terminally archived an owner's sign-in**, with no way back. Now
   `guard_owner_identity` refuses it loudly with `42501` and the whole erasure
   rolls back, so nothing is half done — but an erasure whose household contact
   holds ownership cannot complete until erasure learns to skip an account
   holding any role other than `client_contact`. Neither behaviour is right and
   the new one is the safe one. Pinned by a database test in
   `tests/db/owner_lock.test.ts` so the day it changes is a day somebody
   notices. Erasure is a large, compliance-critical function in another round's
   care, and a wrong edit there is worse than a loud refusal, which is why this
   round did not touch it.
2. **The portal's revoke path had no practice-role check — fixed here, because
   this round is what made it wrong.** `app/api/portal/access.ts` suspends an
   `app_user` row by id when a household's access is revoked. Under this round's
   `role_guard.sql` an **admin**'s update of a member of staff's row matches no
   row and raises nothing, so the route answered `revoked` and logged it while
   the household kept its access: nobody suspended who should not have been, and
   a row in the append-only trail that is not true. That is a regression this
   round caused, so it was not left for the next one. The route now asks, before
   any write, whether the contact's account holds any role but `client_contact` —
   the same question the invite path a few lines above asks, and
   `app.portal_invite_state` asks beneath both — and answers `409 staff_account`,
   writing nothing and logging nothing; and the update reads its own row count,
   so none suspended is a thrown error and never `revoked`. An owner pressing
   Revoke on a contact who is also an owner now meets the same 409 instead of the
   trigger's 500.
   **The screen's own wording is not fixed here, and that is the one wart left.**
   `app/admin/portal/PortalAccessPage.tsx` answers this refusal with its generic
   "That access could not be ended. Try again." — which will never succeed on a
   retry; the invite half of the same screen has said "That invitation could not
   be issued. Try again." for `not_a_household` since piece seven, and for the
   same reason. That screen maps one sentence per action and not one per code, so
   a sentence for either is a redesign of its wording rather than a line added,
   and round 59 owns both, because it owns what revoking a member of staff's
   household access should mean.

   **What round 59 still owns is the question this deliberately does not answer:
   what revoking a member of staff's household access should MEAN.** Ending it
   without touching their sign-in needs a way to say so that this schema does not
   have yet, and it is the same decision as item 1's, about the same pair of
   people, so the two are taken together or neither.
3. **A revoke and an erasure take two rows in opposite orders.**
   `app.revoke_staff_role` locks the colleague's `app_user` row and then the
   audit chain's; `app.erase_client` writes its first audited row and so takes
   the audit chain's first and `app_user` second. On a person who is both a
   household's contact and a member of staff the two can therefore deadlock.
   Postgres aborts one of them whole, so nothing is left half done, and the
   pair is rare enough that it was recorded rather than serialised.

**Then, separately.**

4. **"New temporary password" never worked from the screen on production.** The
   old list sent that `POST` with no `content-type`, and the API answers every
   such `POST` with 415 before a route sees it. The button therefore did nothing
   on the real API; the database harness adds the header itself, so no test
   caught it. Found by pressing it in a browser. The new drawer sends
   `content-type: application/json`, and a password was minted against a running
   API to prove it.
5. **Recovering an owner's sign-in is now a narrower path, and the bootstrap's
   own hint no longer describes it.** An owner's linked sign-in cannot be moved
   by anybody, which is the decision. So the way back in for a locked-out owner
   is **the other owner minting a temporary password**, which is why that act
   was kept when every other one was taken from admins. If the sign-in account
   itself were deleted at the sign-in service, relinking the row to a new
   account is a migration's act. `956_bootstrap_practice.sql` raises a hint
   telling whoever hits it to "relink the practice's existing `app_user` row to
   the new Auth user id"; that sentence no longer applies to an owner, and it is
   a hint rather than a code path. Worth the operator knowing before the second
   owner's row is written, and worth a line in `docs/PRODUCTION.md` at the pass.
6. **Small things the round's reviews raised and deferred, each one line.**
   - Every refusal inside `app.revoke_staff_role` is `42501`, told apart only by
     its message. If a route ever needs to tell them apart, the shape is
     `detail = '<a stable tag>'`; the screen asks the pure rule first, so one
     generic 409 is right today.
   - `tests/db/owner_lock.test.ts`'s closing `verify_audit_chain()` case now
     covers the seeds and the race's rows only, because the race closes and
     reopens the file's transaction before it. Move the chain check above the
     race, or give the race a file of its own.
   - The race case waits a fixed 300 ms before reading `pg_locks`. It fails red
     and never falsely green, but it is flaky under load: poll until the waiter
     is blocked instead. And its first connection leaks if the second throws
     while being created.
   - No test chains `setEmail` and then `deleteUser` on the fake sign-in
     provider; it was traced by hand as correct. The fake's self-address branch
     deletes and re-sets the same key instead of returning early.
   - ~~`mountTeamRoles` carries a default clock, `() => new Date()`, which
     nothing uses.~~ **Done in the final fix wave:** the default is gone and
     `routes.ts` passes the clock, which was already the folder's convention.
   - ~~`tests/db/team.test.ts` adds its one test-only constraint **outside** the
     `try` whose `finally` drops it.~~ **Done in the final fix wave:** the
     `alter` is inside the `try` now, so a failure between the two statements
     cannot leave the constraint on the table and take every later case with it.
   - Nothing pins the two clauses of the roles-only target read on the three
     routes that use it: a household contact's id should be asserted as 404 on
     `/status`, `PUT` and `DELETE`.
   - A press on one switch while another switch's request is in the air is
     silently dropped. It is safe, and it reads as broken; mark the others busy,
     or queue.

### What the practice keeps about its own staff

**This is now `docs/COMPLIANCE/data-inventory.md`**, which the round's final fix
wave created for it: an inventory of the categories of personal data the practice
holds, begun on 22 September 2026 with this one entry. The register beside it is
of vendors, not of categories, which is why there was nowhere for this to live
when the round was written. The inventory is the record; what follows is kept
here because it is the round's own account of the decision, and the two say the
same thing. The household categories are owed in that file and are described in
`docs/SPEC/client-record.md` and `docs/SECURITY.md` until they are moved.

**The category.** What the practice keeps about a member of its own staff
beyond the sign-in: a **job title**, a **start date**, an **emergency contact** —
a third person's name and telephone number — and the **owners' notes**. It is
held in `staff_profile` (migration `922`), one row per person.

**Why the emergency contact is kept, since it is somebody else's data.** It is
entered by the practice about its own staff, for the safety of somebody working
alone in a household's home. It is removed by editing the field to empty;
nothing else removes it and nothing deletes it on a timer, as everywhere on this
platform.

**Who may read it.** The owners, and nobody else — not an admin, not the lead
practitioner, and not the person themselves. That is the row rule, not only the
screen's (`db/policies/core/staff_profile.sql`).

**What the trail keeps.** That any of the five fields **changed** — who changed
it, when and why — and never what it said (migration `967`). All five and not
only the three that read as private: the audit trail admits an owner, an admin
and the lead practitioner, and the activity feed answers old and new values for
every kind of row, so a job title and a start date left in it reached two of the
three people this table exists to keep them from. The log is append-only and kept
five years, and no erasure reaches it, so a value written there would outlive the
row it was copied from, and outlive the person leaving.

**Private on the screen is not private in law.** A member of staff has the same
right of access and correction as anybody else the practice holds data about,
and a request from them reaches these notes. The field says so beneath itself —
"Contract terms and reminders. Nothing about health. The person may ask to see
what is written here." — which is minimisation done where the typing happens.

### Going live

**Merged is not live.** Nothing in this round reaches production until the
operator says so, and then in this order.

**Before the day.** Tell the two admins. Every button on Settings › Team goes
away for them: adding a person, granting a role, suspending a sign-in and
minting a temporary password all become the owners' on the day this lands, and
the list is what they keep. They should hear it from the practice and not from a
screen.

**The API and the screen are one pull request, and nothing from this branch is
deployed between them.** The API alone leaves the old Team screen posting to a
route that no longer exists and meeting 403 for an admin. The round sequenced
the API before the screen on purpose, so the screen was built on real shapes;
that ordering is an ordering of commits and never of deploys.

**Databases before code, and the gap kept short.** The new routes read
`staff_profile` and call `app.revoke_staff_role`, so the migrations go first. The
old code is safe on the new schema except where an **admin** writes to a staff
row, which is the point of the round; and in the window between the policies
being re-applied and the new build being served, the old screen answers an admin
in two different ways, both of them wrong and neither of them alarming:

- **Add a person** and **Add a role** answer **5xx**. The old routes insert into
  `app_user` and `user_role` without asking, so the insert meets
  `role_guard.sql`'s `with check` and raises `42501` — which the middleware turns
  into a 500. That was watched happening in the round's own red run: two of the
  twelve red cases carried that SQLSTATE.
- **Suspend** answers **404**. The old status route reads its own row count, and
  an admin's `update app_user` now matches no row rather than raising, so the
  route correctly concludes there is nothing to suspend and says so. Nothing is
  suspended, and nothing says why.

So: between applying the migrations and serving the new build, do not leave an
admin working on Settings › Team. The same silence-instead-of-an-error is what
broke the portal's revoke path, which is fixed in this pull request and not left
in the window (see item 2 of "Found beside it").

1. **The hold protocol**, before anything is uploaded: no second session
   deploying at the same moment. Two builds twelve seconds apart cost a pass in
   September, and the loser fails with no logs.
2. **One read first, before a single migration, on production.** Does any
   household contact's account already hold a role at the practice? Read-only,
   and it asks a deliberately wider question than migration `923` answers, so
   the role comes back with the row:

   ```sql
   select ct.id, ct.client_id, r.role
     from public.contact ct
     join public.user_role r on r.user_id = ct.user_id and r.tenant_id = ct.tenant_id
    where r.role <> 'client_contact';
   ```

   **No rows: nothing to say, and the pass carries on.** A row means one of two
   different things, and the `role` column is which:

   - **`owner`.** From the moment `923` is applied, an erasure of that household
     **cannot complete**: `guard_owner_identity` refuses the archive with `42501`
     and the whole erasure rolls back, so nothing is half done and nothing can be
     finished either, until round 59 teaches erasure to skip an account that works
     at the practice.
   - **`admin`, `finance`, `practitioner` or `lead_practitioner`.** Nothing
     refuses these, then or now. The erasure **will go through** and will
     silently archive and unlink that member of staff's own sign-in, which is
     item 1 of "Found beside it" exactly as it stood before this round: the
     trigger narrowed the damage to ownership and left the rest of it where it
     was. Round 59 is the round that fixes it.

   Either way the operator hears it that day, before the migrations go on, so
   the choice to proceed is his and is made knowing which of the two he has.
3. **Three migrations, by hand, staging first and then production**, in this
   order and no other: `922_staff_profile.sql`, then
   `923_owner_lock_and_role_revoke.sql`, then
   `967_audit_redact_staff_profile.sql`. Each file's statements whole and in the
   file's own order, then its own bookkeeping row in `schema_migration`
   carrying the sha256 of the file's text **taken from `main` after the merge**,
   not from any earlier commit of this branch. 967 goes last of the three
   because it restates `app.audit_redact` over 965's version, which both hosted
   databases already hold; the number matters most on a database the runner
   builds from nothing, where a lower one would be overwritten by 965 and the
   five keys would become legible in the trail again.
4. **Three policy files, re-applied by hand.** A changed policy file is not a
   migration, and `schema_migration` will not show whether it was done:
   `db/policies/core/tenant_isolation.sql` (`staff_profile` joins the fence),
   `db/policies/core/role_guard.sql` (rewritten), and
   `db/policies/core/staff_profile.sql` (new). Until `role_guard.sql` is
   re-applied, an admin still writes staff rows beneath the routes; until
   `staff_profile.sql` is, the new table has tenant isolation and no owners-only
   rule. Read the policies' `using` and `with check` text back, not their count.
5. **Fingerprint the touched tables against a freshly migrated local
   database.** Two hosted databases agreeing proves only that the same text was
   pasted twice. Reset and migrate a local database from `main`, then hash the
   nine categories over `staff_profile`, `app_user` and `user_role`: columns,
   comments, constraints, functions (`app.guard_owner_role`,
   `app.guard_owner_identity`, `app.revoke_staff_role` and `app.audit_redact`,
   each with its definer flag, its pinned search path, and who may execute it),
   grants, indexes, policies, triggers
   (each with **how it is enabled** — both of this round's are `enable always`,
   which a list of trigger names cannot see, so read `tgenabled`), and the whole
   migration record — `schema_migration`'s filenames with their checksums.
   Staging against local, then production against local.

   **Grants are read per grantee, not as a count**, and the hosted databases are
   expected to differ from local in exactly one way: Supabase's own
   `service_role` holds privileges there that no local role holds, including
   TRUNCATE by default privileges, and it bypasses row security. That is the
   shape of every table in this schema and not something about this round's — it
   is why migration `923`'s "where the lock ends" paragraph says the undo belongs
   to whoever holds the service key — so the expectation is `service_role` on the
   hosted side and nowhere else. A grantee on a hosted database that is neither
   `app_role`, `service_role`, the schema owner nor one of Supabase's own is the
   finding this step exists for.
6. **The second owner's row, on production only, by the audited data step**,
   and rehearsed first: `docs/RUNBOOK/second-owner.md`. Staging has no second
   owner to write and needs none. The rehearsal is the same block ending in a
   `raise`, so it runs against the real rows and keeps nothing.
7. **Then the code**: the archive from the merged commit, the stored build
   settings read back and sent unchanged, the upload, the build, and the proof
   that the bytes being served are this tree — a rule read out of the live
   bundle, not a 200 from a route. Then health, deep health, and the runtime
   log's own start-up block.

**The first thing to do afterwards.** Open your own profile, and then the
other owner's, and see the line "Owner. Full access. Cannot be changed." with
the switches greyed beneath it. If it reads that way on both, the lock is the
database's and the screen agrees with it; if it reads that way on only one, the
ownership row was written for one of you and not the other, and the data step is
where to look.
