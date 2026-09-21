# A profile for each member of staff, and access that can be switched off

**Date:** 21 September 2026. **Status:** design settled with the operator on 22
September; the spec awaits the operator's reading before a plan is written
(trunk round 58). Round 57, a fix this design found, goes first and is
described in section 2.

## Why

Settings › Team (trunk round 39, 10 September) can add a person, add a role,
mint a temporary password and suspend a sign-in. It cannot take a role away,
it cannot correct a name or an address, and a row is all a person is: there is
nothing to open. The operator's request of 21 September is for the row to
become an employee's profile, with access that is switched on and off per
person, and for two people — the founder and one other — to hold full access
that nobody can revoke.

The operator also asked for salary, pay reviews, payslips and staff documents
on the same profile. Those are two further pieces, sequenced in section 9 and
not designed here.

## Decisions already taken

| Decision | Choice | By |
|---|---|---|
| What a switch controls | a **role**: Admin, Finance, Practitioner, Lead practitioner. Not an area of the app and not a single action | operator, 21 September |
| The second person with full access | becomes a second **Owner**; both owners are locked, from admins, from each other and from themselves | operator, 21 September |
| Who manages the team | **owners only**. An admin still sees the list and may mint a temporary password for a colleague who is not an owner, and nothing else | operator, 21 September |
| What the profile holds | name, email, phone, language, status; and job title, start date, an emergency contact and private notes | operator, 21 September |
| Sequence | this piece (A), then staff documents (B), then pay (C, the books' piece fourteen) | operator, 21 September |
| The password fault | fixed first, in its own pull request | operator, 21 September |

## 1. Why a switch is a role and nothing finer

What a person may do is decided twice. `canActor` (`domain/shared/actor.ts`)
answers for some fifty-five named actions, and the database answers again
beneath it: `app.actor_has_role` is asked 271 times across 46 migration and
policy files. The database's answer is the one that binds.

A switch finer than a role would be known to the API alone, so it could hide
and refuse but never be the floor; and a switch that replaced roles would mean
rewriting those 271 checks and repeating every security review since piece
one. A switch that **is** a role is enforced at both layers the moment it
moves, by machinery that already exists. The profile says in plain words what
each role opens, so the bundle is not a mystery to the person flipping it.

Roles are read from `user_role` on every request (`app.resolve_actor`,
migration 095) and the actor is not cached, so a switch that goes off binds on
that person's next request. Their open window keeps its sidebar until it is
reloaded; every press in it is refused.

## 2. Round 57, first: an admin can take the owner's sign-in

`POST /api/team/:id/password` asks `staff.manage` (owner or admin) and then
that the target is active staff. It does not ask whether the target holds
ownership, and it does not pass through row security: the password is set at
the sign-in service with the service key. `POST /api/team/:id/status` is safe
only because `owner_keeps_identity` refuses the update underneath; the
password route has no underneath.

So an admin may mint, and be shown, a working password for the owner's
sign-in. Found by reading on 21 September, not by an incident. The fix is a
pure rule beside `canSuspend` and `canGrantTo` — an admin never resets an
owner — asked by the route after it has read the target's roles, a test that
an admin is refused and the owner's password is untouched, and the button
absent from an owner's row on an admin's screen. No migration.

## 3. The owner lock

Two owners, and "cannot be revoked by anyone" includes each of them. The lock
is the database's, so that code written later cannot forget it:

- **An ownership row does not change.** A trigger on `user_role` refuses any
  update or delete of a row whose role is `owner`, for every caller.
- **An owner's sign-in stays theirs and stays open.** A trigger on `app_user`
  refuses, for a row that holds ownership, any change of `status` away from
  `active` and any change of `auth_id`; and refuses a change to the name, the
  email or the phone unless the actor is that same person.
  `owner_keeps_identity` (role_guard.sql) is tightened to say the same, so the
  courtesy and the floor agree.
- **Undoing it is a migration's act**, never a screen's and never the API
  role's: the triggers carry no bypass setting, because a setting the API role
  could set is not a lock.

One owner **may** mint a temporary password for the other. It is the recovery
path for a person locked out of a practice with two owners, it revokes
nothing, and the trail records who did it (`password_reset`, as today).

Ownership is granted where it has always been granted: by an audited data
step, never by a screen. The second owner's row is written at the production
pass under the founder's id, the way her own second role was on 10 September,
and recorded in `docs/PRODUCTION.md`. Their existing Finance row stays; an
owner's switches are shown greyed beneath the line "Owner. Full access. Cannot
be changed."

## 4. Switching a role off

`user_role` has no delete grant for the API role, and gains none. A role is
taken away by `app.revoke_staff_role(p_user_id uuid, p_role role_kind)`,
security definer, which refuses unless: the actor is an owner; the role is one
of the four working roles; the target is in the actor's practice and is not
the actor; and the target would be left with at least one working role. It
then deletes the row, and `audit_row` — already on the table — keeps the old
values in the trail.

**Deleted, not marked revoked.** A `revoked_at` column was considered and not
taken. Roles are read in more than one place (`resolve_actor`, the team list,
`owner_keeps_identity`, the portal's functions), and a reader that forgot the
new column would treat a revoked role as live: the design would fail open. A
row that is gone fails closed, and the trail is where history lives in this
platform in any case.

**At least one role.** A person with no working role falls out of the team
list (`having bool_or(...)` over no rows) and is refused everything by
`canActor`'s first line, so they could never be found to be given a role back.
Shutting someone out is what Suspend is for, and the refusal says so.

Switching a role on is today's insert, now the owner's alone.

## 5. Who may do what, at both layers

A new action, `staff.access.manage`, the owner's alone: add a person, open and
edit a profile, switch a role, suspend and reactivate. `staff.manage` (owner
or admin) keeps the list and the temporary password, the latter never for an
owner's row unless the actor is an owner.

**Open, for the operator's reading: whether an admin keeps the temporary
password at all.** Round 57's security review pointed out that the fix
protects ownership and nothing else. A temporary password is a sign-in, so an
admin who mints one for a colleague holding Finance has the books, and for one
holding Lead practitioner has the trail and the reports, by one remove; taking
"manage the team" away from admins closes the front door and leaves this one.
Three answers, the first recommended:

1. **Owners only.** An admin sees the list and nothing else. With two owners
   there is always somebody to ask, and the rule is one sentence.
2. **An admin, only for somebody who holds no role the admin lacks.** Nothing
   is gained by the reset, so nothing is escalated. Exact, and hard to explain
   across a desk: whether the button appears depends on both people's roles.
3. **As decided on 21 September**, with the risk recorded: the act is in the
   trail under the admin's id, which is detection and not prevention.

Until the operator answers, the table above stands and this section is the
only place the question lives.

`db/policies/core/role_guard.sql` changes to match, with one carve-out the
portal depends on: an admin invites a household, which inserts an `app_user`
and a `client_contact` role row and later suspends that row
(`app/api/portal/access.ts`, the client-portal stream's, not edited here). So:

- `user_role` insert: a `client_contact` row by an owner or an admin; any
  other row by an owner.
- `app_user` insert: unchanged (a row with no role is inert).
- `app_user` update: an owner; or an admin, for a row holding no working role.

`credential` and `service_type` stay as they are: Settings › Practitioners is
not this piece.

## 6. The profile's own table

`app_user` is readable by everyone in the practice, because names appear on
every screen. An emergency contact and an owner's private notes must never be
there. They go in `staff_profile` (the trunk's next free migration in the
`900–949` half): one row per member of staff — `job_title`, `started_on`,
`emergency_contact_name`, `emergency_contact_phone` (E.164, as `app_user.phone`),
`private_notes` — with row security that admits an owner and nobody else, for
read and for write. Not the person themselves: a note about somebody that they
can read is a different thing from the one the operator asked for.

The table carries the audit trigger, and `app.audit_redact` gains the two
emergency-contact columns and `private_notes`, so the trail records that they
changed and never what they said. Opening a profile is logged as a read, as
the team list already is.

An emergency contact is a third person's name and number. It is entered by
the practice about its own staff, for the safety of somebody working alone in
a household's home; `docs/COMPLIANCE` records it as a category with that
purpose, and removing it is editing the field to empty.

**Private on the screen is not private in law.** A member of staff has the
same right of access and correction as anybody the practice holds data about
(the PDPL, `.claude/skills/uae-compliance`), and a request from them reaches
these notes. The field says so beneath itself — "Contract terms and reminders.
Nothing about health. The person may ask to see what is written here." — which
is minimisation done where the typing happens.

## 7. The API

| Route | Who | What |
|---|---|---|
| `GET /api/team` | owner, admin | as today, plus `locked` (holds ownership); `jobTitle` for an owner only |
| `POST /api/team` | owner | as today |
| `GET /api/team/:id` | owner | the row and its profile; logged as a read |
| `PATCH /api/team/:id` | owner; for an owner's row, that owner only | name, email, phone, language, and the five profile fields |
| `PUT /api/team/:id/roles/:role` | owner | switch on; idempotent |
| `DELETE /api/team/:id/roles/:role` | owner | switch off, through `app.revoke_staff_role` |
| `POST /api/team/:id/status` | owner | as today; an owner's row answers `locked` |
| `POST /api/team/:id/password` | owner, admin | as today, within section 2's rule |

`POST /api/team/:id/roles` is replaced by the `PUT`; the screen is its only
caller. Refusals carry a code the screen turns into a sentence: `locked`
(409), `last_role` (409), `not_yourself` (400), `email_in_use` (409),
`sign_ins_unavailable` (503).

**An email is two writes.** The address is the sign-in, so the sign-in service
changes first (`AuthAdminProvider` gains `setEmail`, confirmed without a
message, as `createUser` is) and the row second; if the row fails the service
is put back, the shape `POST /api/team` already has for a sign-in it must take
back.

The pure rules live in `domain/shared/staff.ts` beside the three that are
there: `isLocked(roles)`, and `canSwitchRole(...)` answering either yes or the
reason it is no, so the route, the screen and the tests quote one source.

## 8. The screen

The list keeps name, email, roles and status, gains the job title, and loses
its row of "Add …" buttons for one **Open**. An admin sees the list and, on a
row that is not an owner's, **New temporary password**; nothing else.

Open is a drawer (`app/shell/components/useDrawer.ts`, the shell's copy, with
the draggable width) with two tabs. **Profile**: the fields of section 7, the
phone through `PhoneField`, the date through `DateField`, saved with one
button. **Access**: four switches, each with one line of plain English naming
what the role opens; beneath them New temporary password and Suspend. A
refused switch returns to where it was and says why. An owner's drawer shows
the lock line, greyed switches, and no Suspend.

The tab strip is where pieces B and C add **Documents** and **Pay**; nothing
else in this piece anticipates them. English only, as every console screen
(`tests/lint/console-is-english.test.ts`).

## 9. What follows, so nothing here pre-builds it

- **B, staff documents.** Contracts, visas, identity copies and certificates
  per person, in private storage, the owners' alone. The platform's standing
  rule is that **no image of an identity document is ever stored**; it was
  written for households, and piece B's first decision is whether an
  employer's copy of a visa or an Emirates ID is inside that rule or a stated
  exception to it, with a retention rule either way.
- **C, pay.** A salary with effective dates (a pay review is a new row, never
  an edit), then pay runs, payslips, the WPS file and gratuity: that is
  `docs/SPEC/accounting.md` section 14's piece fourteen, and it is designed
  with the books because every pay run posts.

## 10. Tests

- **Rules** (`domain/shared/staff.test.ts`, `actor.test.ts`): the lock, the
  last role, never oneself, never an owner's row, the new action's audience.
- **Database** (`tests/db/team.test.ts`): an admin cannot insert a working
  role, update a staff row or reach `staff_profile`, and still invites and
  suspends a household contact; an **owner** is refused on the other owner's
  status, role row and details; `app.revoke_staff_role` refuses each of its
  four cases and leaves a `delete` in the trail; the redacted columns never
  appear in `audit_log`; `verify_audit_chain()` holds afterwards. The
  harness's own reset is checked against the two new triggers before anything
  else is written.
- **API**: every route of section 7 for an owner, an admin and a practitioner;
  the email's two writes and the put-back; the fake `AuthAdminProvider` gains
  `setEmail`.
- **Screen** (`TeamPage.test.tsx` and the drawer's own): what an owner sees,
  what an admin sees, a locked row, a refused switch returning, the drawer
  reachable and closable from the keyboard.

Reviews as every trunk round: schema, security, compliance.

## 11. Going live

Merged is not live. The migration and the changed `role_guard.sql` are applied
by hand at each pass (a changed policy file is re-applied, not only a new
migration), staging first, production on the operator's word. At the
production pass the second owner's row is written by the audited step of
section 3. The two admins lose buttons that day and are told beforehand.
