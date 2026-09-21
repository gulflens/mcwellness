## Round 57 — an admin never mints a password for an owner (2026-09-22)

Found by reading, on 22 September 2026, while designing the profile the
operator asked Settings › Team to become
(`docs/superpowers/specs/2026-09-22-team-profiles-and-access-design.md`,
section 2). Not by an incident: nothing in the trail suggests it was ever done.

### What was wrong

`POST /api/team/:id/password` asked `staff.manage`, which an owner and an admin
both hold, and then that the target was an active member of staff. It never
asked whether the target held ownership. The route beside it,
`POST /api/team/:id/status`, never asked either, and did not need to:
`owner_keeps_identity` (`db/policies/core/role_guard.sql`) refuses an admin's
update of an owner's row underneath, and the route answers 404. A password has
no underneath. It is set at the sign-in service with the service key, which
row security never sees.

So an admin could press **New temporary password** on the owner's row and be
shown a working password for the owner's sign-in: every role the practice has,
in one press, by somebody the roles were drawn to keep out of the books and
out of ownership. The act would have been in the trail (`password_reset`,
under the admin's id), which is detection and not prevention.

### What it does now

One pure rule beside `canSuspend` and `canGrantTo`
(`domain/shared/staff.ts`, `canResetPassword`): a temporary password for an
owner is an owner's to mint and nobody else's. The route reads the target's
roles in the query it already made, asks the rule, and answers 403 before the
sign-in service is called and before anything is logged. The screen asks the
same rule of the same roles, so an admin is not offered a button the API would
refuse.

An owner may still mint one for another owner. Today there is one owner, so
that is the owner's own row; when there are two it is how one of them gets
back in, and the trail says who did it.

### Proof

- `domain/shared/staff.test.ts`: the rule's three cases.
- `tests/db/team.test.ts`: against a real database, an admin is answered 403
  for the owner, the sign-in provider's `setPassword` is never called, the
  answer carries no password and the trail gains no row; a second owner is
  answered 200 by the first. The first of these was watched failing with a 200
  before the route changed.
- `app/admin/settings/TeamPage.test.tsx`: an admin's screen shows one button
  for two active rows.

**No migration, no policy file, no schema change.** Every file is the trunk's
own (`docs/SPEC/OWNERSHIP.md`: `domain/shared/**`, `app/api/team/**`,
`app/admin/settings/**`, `tests/db/`).

### Going live

Merged is not live. No migration to apply and no policy to re-apply: a build
and a restart. Until then the fault stands on production, where the people
holding `admin` are the practice's own.
