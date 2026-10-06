## Round 77 — a household's login reads only the sign-in rows it needs (2026-10-06)

Round 76's review found a missing floor (`docs/CHANGE-REQUESTS/dispatch-03.md`
item 18). Eight core tables — `app_user`, `user_role`, `practitioner`,
`credential`, `service_type`, `goal_category`, `scheduling_setting` and
`tenant` — carried no read rule but the practice's own (`tenant_isolation`).
So a household contact (`client_contact`) could read, at the database, every
sign-in row in the practice: other households' and the staff's, with names,
emails and phones. No route ever asked, so nothing was shown. The floor
beneath was missing. `db/policies/core/helper_reach.sql` closed the same gap
for a helper in round 76, and this round follows it.

### What changed

- **`db/policies/core/household_reach.sql`** (new). There are two restrictive
  policies on each of the eight tables. `household_reach_read` covers select.
  `household_reach_write` covers every command, with a check that refuses
  every row. It is a policy file and nothing more: the runner re-applies it
  on every migrate. **Migration 976 is unused**, so the other session may
  take it.
- **`tests/db/household-reach.test.ts`** (new). It walks every table in
  `public` as a household and checks every row: no client but its own, no
  sign-in but its own, no contact outside its own records, no location but its
  own clients' homes, no other practice. It pins exactly what the eight tables
  answer a household. It walks the colleague who is also a household contact,
  table by table, against the same person stamped as staff alone. It holds
  the sixteen policies' presence.

### What a household reads of the eight

These are the real reads, from every query `app/api/portal/**` and
`GET /api/me` make, and from the definer functions they call:

| Table | A household reads | Why |
| --- | --- | --- |
| `app_user` | its own row | `/api/me` (name, language); every portal screen's practice line (language) |
| `user_role` | its own role rows | nothing reads them through `app_role` today. They are harmless, and helper_reach allows the same |
| `service_type` | the services on its own visits | Visits shows the name and the Arabic name; Home's review line reads the code |
| `tenant` | its practice's own row | the practice's name, WhatsApp number, review page and time zone |
| `practitioner` | nothing | the portal never names the practitioner (`docs/SPEC/client-portal.md` 3.2) |
| `credential` | nothing | |
| `goal_category` | nothing | |
| `scheduling_setting` | nothing | |

### Rulings

1. **Who is bound: a person stamped with `client_contact` and nothing else.**
   The middleware stamps every role a person holds on every request, portal or
   console (`app.resolve_actor`). So a colleague who is also a household
   contact (migration 968) is stamped `practitioner,client_contact` and is not
   bound. Binding them would cut the console they work in. Their portal view
   is already the narrower one, because the routes ask for nothing more. The
   test proves that they lose no row of any table.
2. **The practitioner's name: no definer function.** The portal does not
   show it, so there is nothing to return. `practitioner` is closed to a
   household entirely. The appointment read policy's subquery into
   `practitioner` was looking for the household's own practitioner row, and a
   household has none, so its visits are unchanged.
3. **`service_type` is narrowed to the household's own visits, not left as
   the whole catalogue.** The rule is the visits' own rule
   (`app.actor_is_contact_of` on the appointment's client), read through the
   appointment's row security. Nothing in the appointment's policies reads
   `service_type`, so the policies do not recurse.
4. **`tenant` is narrowed to the row, not to the columns.** A household reads
   its practice's whole row. That includes the licence, the TRN, the bank
   details and the practice's own contact details. None of them is a person's
   data, and the bank details are printed on every invoice a household
   receives. Narrowing the columns would need a definer function and a change
   to `app/api/portal/household.ts`. **This one is for the operator, if
   wanted.**
5. **The write side was already closed, and is now closed twice.** A
   household could write none of the eight before this round.
   `role_guard.sql`, `practitioner_base.sql` and `scheduling_setting_access.sql`
   cover the inserts and updates; app_role has no grant to delete; a trigger
   refuses an update to `tenant`. The new write policy adds a
   check that refuses every row, so a guard removed tomorrow still leaves a
   household writing nothing here. Every portal write that touches one of
   these tables (redeeming an invite, which links the sign-in) is a security
   definer function, so row security never applies to it.

### Proof

- The new test failed before the policy file (7 of its 12 cases) and passes
  with it.
- The whole `pnpm test:db` suite is green, the portal's route suites
  included. Those suites are the real proof that nothing the portal needs was
  cut.

### Live pass

No migration. The policy file goes live with the next pass's policy step,
which re-applies every file under `db/policies`.
