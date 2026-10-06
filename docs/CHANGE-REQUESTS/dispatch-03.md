# dispatch-03: what round 76, the helper, asks of the shared zone and of other streams

Written 6 October 2026 with the round, from `docs/SPEC/dispatch.md` section
15.12. As dispatch-01 and dispatch-02 did, and by the precedent of pieces seven
to ten and seventeen and the cost rules of `docs/HANDOVER.md` section 6, items
1 to 12 ride in the round's own branch (`round-76/helper-role`) under the
integrator's widening for one round; items 13 to 18 are proposed and not
applied.

## Applied in the branch

1. **Migration `974_helper_role.sql`** (core range, the trunk's): one
   statement, `alter type public.role_kind add value if not exists 'helper'`,
   alone in its file because a value added by `ALTER TYPE` cannot be used in
   the transaction that adds it and both the runner and the live pass wrap each
   migration in its own. Nothing uses the value until the policy files, which
   the runner applies after every migration has committed. Migration `213` is
   in the stream's own range; on a fresh database it runs before `974`, so it
   compares `role::text = 'helper'` and never names the enum value.
2. **`db/policies/core/helper_reach.sql`** (new, core policies): two
   restrictive policies, `helper_reach_read` and `helper_reach_write`, on every
   table in `public`, binding a person who holds the helper role and no other.
   Core because it is about a role and touches every stream's tables; written
   as a loop over the catalogue so a table added by any stream is covered on
   its first migrate without anybody editing this file.
3. **`domain/shared/actor.ts`** (shared): `'helper'` in `ROLES`, named by no
   action; one new action, `staff.helper.manage` (owner and admin).
4. **`domain/shared/staff.ts`** (shared): `STAFF_ROLE_LABELS.helper = 'Helper'`
   (the record is exhaustive over `Role`). `STAFF_ROLES` is unchanged: a helper
   is not a working role and is never offered as a switch.
5. **`domain/shared/audit-narrative.ts`** (shared): one noun,
   `helper_accompaniment` — "helper assignment", `تكليف المساعد`. Tested in
   `tests/dispatch/narrative.test.ts`.
6. **`domain/scheduling/index.ts`** (scheduling's barrel): the rule's three new
   exports and one type, as `locationSharing.ts`'s already are.
7. **`app/api/create-api.ts`** (shared): `api.use('/api/*', helperFence)`
   immediately after `withRequestContext`. The fence itself is the stream's
   (`app/api/location/helperFence.ts`).
8. **`app/api/team/helpers.ts`** (new), **`routes.ts`** and **`schema.ts`**
   (the trunk's since round 39): the four helper routes, mounted ahead of the
   profile's `/api/team/:id` (which would otherwise answer
   `/api/team/helpers` as a colleague with a malformed id); `HelperBody`,
   `AccompanimentBody`, `HelperRow`, `HelpersResponse`. Nothing existing in the
   folder changes behaviour.
9. **`app/admin/settings/TeamHelpers.tsx`** (new), **`TeamPage.tsx`** and
   **`settings.css`** (the trunk's): the Helpers section, shown to the owner
   and an admin; a person holding the helper role alone is left out of the
   staff table. The existing `TeamPage.test.tsx` and `TeamMemberDrawer.test.tsx`
   are untouched and pass.
10. **`app/shell/routing.ts`** and **`app/shell/App.tsx`** (the shell):
    `homeFor` sends a helper to `/help`; `HELPER_HOME` and `isHelperOnly`;
    `ROLE_LABELS.helper`; the `/help` route (lazy, on the dark ground); and a
    helper sent back to `/help` from `/admin`, `/today` and `/portal`.
11. **`app/admin/schedule/map/DayMap.tsx`, `DayMapPage.tsx` and `map.css`**
    (scheduling's day map, as dispatch-02 item 8): `DayMap` takes an optional
    `alongside` list drawn as labels of their own, never stops and never in
    the extent; `DayMapPage` passes today's helpers going with the shown
    practitioner and says each in the panel. The existing day-map tests are
    untouched and pass.
12. **`tests/accounting/access.test.ts`** (accounting's): `'helper'` added to
    its role list and its `Record<Role, …>` table (read, write and owner all
    false), which the type now requires.

## Proposed, not applied

13. **The notice, version 1.2** (`docs/CONSENT/staff/location.en.md`, the
    stream's path, but a wording change needs the operator's approval and is
    not bumped here). Version 1.1 is written for a practitioner. A helper
    accepts it today as it stands, and three of its sentences are not true of
    them. Proposed changes, each marked:
    - *Introduction.* "The practice's notice to the people who visit
      households for it" → "The practice's notice to the people who visit
      households for it, and to the family members who help them on the day."
    - *When*, the switch: "your switch, “Share my location while I work”, is
      on" → "your switch — “Share my location while I work”, or “while I
      help” if you help on the day — is on".
    - *When*, the working day: add after the paragraph on the working day: "If
      you help on the day, your working day is the working day of the
      practitioner you go with, read the same way from their visits; if the
      practice has not named whom you go with, or has ended it, you have no
      working day and nothing is sent."
    - *Who sees it*: after "Other practitioners do not see it." add "Helpers
      do not see it, their own included. A helper's position is shown beside
      the practitioner they go with, marked as a helper's, with their first
      name."
    - *How to stop*: after "You can always do this, even if your role at the
      practice has changed." add "If you help on the day and the practice
      stops your helping, your positions are deleted at once and your sign-in
      is closed; your agreement stays on record as given, as it would after
      a withdrawal."
    The version moves to 1.2, `STAFF_LOCATION_NOTICE_VERSION` and
    `app.staff_location_notice_version()` (a new migration replacing 212's)
    move with it, `app/therapist/location/notice.ts` is regenerated, and every
    standing consent to 1.1 then pauses sharing until it is read again (15.10).
14. **`docs/SPEC/OWNERSHIP.md`**: no new path is needed — `app/api/location/**`,
    `app/therapist/location/**`, `db/policies/dispatch/**` and
    `domain/scheduling/locationSharing.ts` already hold the stream's new files
    (dispatch-02 item 1, if applied) — except the note that core migration
    `974` and `db/policies/core/helper_reach.sql` were written by this stream
    for this round, as rounds 41, 51 and 58 were widened.
15. **`.claude/rules/data-model.md` and `.claude/rules/compliance.md`**: the
    `practitioner_position` exemption sentences say "a practitioner's shared
    location"; they would read "a practitioner's, or a helper's, shared
    location (a helper's row carries `user_id`, migration 213)". Not edited:
    the rules are the trunk's, and the exemption itself is unchanged — same
    table, same comment prefix, same two days.
16. **`docs/SPEC/00-data-model.md`**: deliberately **not** edited, as
    dispatch-01 and dispatch-02 did not for 210 and 211. `helper_accompaniment`
    and the `user_id` column are written down in `docs/SPEC/dispatch.md`
    section 15.12; `role_kind`'s seventh value belongs in section 2 when the
    trunk next edits it.
17. **`.github/workflows/backup.yml`**: no change. The weekly dump already
    keeps `practitioner_position`'s shape and none of its rows, and a helper's
    rows are in that table. `helper_accompaniment` is an ordinary audited
    table and is dumped as one.
18. **A finding outside this round, for the trunk.** Before
    `helper_reach.sql`, a helper could read every `app_user` row in the
    practice at the database: `app_user` (like `user_role`, `practitioner`,
    `credential`, `service_type`, `goal_category`, `scheduling_setting` and
    `tenant`) carries no rule but tenant isolation. A household contact
    (`client_contact`) is in the same position today: at the database it can
    read every sign-in row of the practice, other households' contacts and
    the staff included. The routes refuse it, so nothing is shown; the floor
    beneath is missing. Not fixed here: it is the portal's and the trunk's,
    and a restrictive `app_user` policy for households needs its own review.
