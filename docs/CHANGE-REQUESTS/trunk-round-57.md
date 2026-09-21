## Round 57 — an admin never mints a password for an owner (2026-09-22)

Found by reading, on 22 September 2026, while designing the profile the
operator asked Settings › Team to become (the round 58 design, section 2; not
yet merged). Not by an incident: nothing in the trail suggests it was ever
done.

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
shown a working password for the owner's sign-in: ownership, and with it every
act the practice reserves to its owner, in one press. The act would have been
in the trail (`password_reset`, under the admin's id), which is detection and
not prevention.

### What it does now

One pure rule beside `canSuspend` and `canGrantTo`
(`domain/shared/staff.ts`, `canResetPassword`): a temporary password for an
owner is an owner's to mint and nobody else's. The route reads the target's
roles in the query it already made, asks the rule, and answers 403 before a
password is minted and before the sign-in service is called. The screen asks
the same rule of the same roles, so an admin is not offered a button the API
would refuse.

**The refusal is a row.** `docs/SPEC/audit.md` item 11 says a refused attempt
writes nothing today, and every other 403 in this file follows it. This one
does not, on the compliance review's finding: with the button gone, a 403 here
can only be a request made by hand and aimed at an owner's sign-in, which is
the case section 2 of that spec means by "demonstrable, not just forbidden". A
4xx commits, so `password_reset_refused` survives the refusal it records,
under the asker's id, with nothing in it but whose sign-in was asked for.

**The rule cannot be blinded into yes.** It permits by the absence of `owner`
from a list, and the list is read as the actor, under row security. Nothing
hides an owner's role row from an admin today (the only select policy on
`user_role` is `tenant_isolation`), and the database test would go red if
something came to. But a check that cannot see must not answer yes, so an
empty list is refused by the rule itself (the security review's N1).

An owner may still mint one for another owner. Today there is one owner, so
that is the owner's own row; when there are two it is how one of them gets
back in, and the trail says who did it.

### Proof

- `domain/shared/staff.test.ts`: the rule's four cases, the empty list among
  them.
- `tests/db/team.test.ts`: against a real database, an admin is answered 403
  for the owner, the sign-in provider's `setPassword` is never called, the
  answer carries no password, and the trail gains no `password_reset` and
  exactly one `password_reset_refused` under the admin's id; a second owner is
  answered 200 by the first. The first of these was watched failing with a 200
  before the route changed.
- `app/admin/settings/TeamPage.test.tsx`: an admin's screen shows one button
  for two active rows.

**No migration, no policy file, no schema change.** Every file is the trunk's
own (`docs/SPEC/OWNERSHIP.md`: `domain/shared/**`, `app/api/team/**`,
`app/admin/settings/**`, `tests/db/`).

### Found beside it, and not fixed here

Both are the security review's, both were already there, and neither is this
round's to change.

- **The fix protects ownership and nothing else.** An admin may still mint a
  password for a colleague who holds `finance` or `lead_practitioner`, or
  create a sign-in with those roles at an address of their own, and so reach
  the books or the trail by one remove. That is round 39's design, in which an
  admin manages the team. The round 58 design takes managing the team away
  from admins, and whether an admin keeps the temporary password at all is a
  question that design now has to answer.
- **A revoke that touches nothing still says revoked.**
  `app/api/portal/access.ts` (the client-portal stream's) updates `app_user`
  by id when a household's access is revoked. Were the contact's account also
  the owner's, `owner_keeps_identity` makes the update touch no row, and the
  route still answers `revoked` and logs it. Nobody is suspended who should
  not be; the trail gains a row that is not true. A change request to that
  stream: check the row count.

### Going live

Merged is not live. No migration to apply and no policy to re-apply: a build
and a restart. Until then the fault stands on production, where the people
holding `admin` are the practice's own.
