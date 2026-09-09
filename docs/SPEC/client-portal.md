# SPEC — Client Portal (piece seven)

*Worktree: `client-portal`. Owns `app/client/**`, `app/admin/portal/**`, `app/api/portal/**`, `domain/portal/**`, `db/policies/portal/**`, `tests/portal/**` and migrations `700–799`. Reads `client`, `contact`, `consent`, `document`, `location`, `appointment`, `service_type`, `tenant` and the ledger; writes its own two tables, and one contact row. Entities are defined in `00-data-model.md`; this spec defines behaviour.*

Status: **approved for building, 2026-09-05.** It replaces the foundation draft of 2026-09-02 (branch `client-portal`, never merged), which was written before any of pieces one to six existed and before the plan in `docs/PLAN/pieces-seven-to-nine.md` was approved. Where the two differ, this file stands.

---

## 1. Purpose

The household's own view of its record. A parent on their phone at eleven at night, an adult client after a session: when the next visit is, what is owed or how many sessions are left, who is on the record, what each person agreed to, and how to ask the practice for something. Calm, generous, plain language first (docs/DESIGN-BRIEF.md section 6.3). English and Arabic from the first screen, as a real right-to-left layout.

Two commitments nothing else in the product makes: a household reaches its own rows and never another's, because the database refuses, not only the API; and a household is never shown anything the practice wrote for itself — no session notes, no observations, no measurements until piece ten renders them.

## 2. Who uses it

| Role | Can |
|---|---|
| `client_contact` | See the household's clients, visits, money, people and agreements; correct their own telephone, email and WhatsApp preference; ask for a consent withdrawal or an erasure; open their own invoices and receipts |
| `owner`, `admin` | Invite a contact to the portal, resend or revoke; see and handle the household's requests |
| `lead_practitioner` | See and handle the household's requests |
| every other role | Nothing new |

A person is in a client's household when a `contact` row on that client carries their `user_id`. The household is resolved in the database from the actor stamp (`app.actor_is_contact_of`, migration 100), never from anything a request claims.

**Money and minors** (plan decision 2, default taken). Every adult contact sees the money, because the household is the billing unit. A minor's own login — a contact whose relationship is `self` on a client under eighteen on the day — sees visits and agreements only. This is a row rule (section 6.3), not a hidden tab.

## 3. Screens (`app/client/`)

Every screen: one column at the 68-character measure beside a sidebar on the inline start. **Revised 8 September 2026, replacing a header of two wrapping rows across the top.** The six screens live in the sidebar; the person's name, the language switch and sign out live in its foot; a slim top bar carries whose practice this is. Below the tablet tier the sidebar is not in the flow at all and a menu button asks for it, whereupon it covers the page over a scrim — hidden rather than collapsed to a strip of icons, because the console's sections have drawn icons and the portal's are words in two languages, and six invented icons would be a worse answer than a menu. What the old header cost was measured on a phone: the bar wrapped onto two lines and the six tabs onto two more, which was most of a 390px first view before any of the record showed. Loading, empty and error states are Note lines. Colour comes only from `app/shell/tokens.css`; the only hue is the status dot. Logical CSS properties throughout, and the portal root sets `dir` and `lang` from the person's language, so the Arabic edition is a mirrored layout, not a flipped English one. Every string on every portal screen exists in both languages in `app/client/i18n/`; a hardcoded sentence fails review. Dates and times are written in the practice's time zone (`tenant.timezone`) in the person's language; figures are tabular.

A household with several clients sees each screen sectioned by client, the client's name as the section heading; one client, no heading.

**3.1 Home** (`/portal`). The next visit — its date and arrival window, the service, home or studio — or a line saying nothing is booked. Per client: what is owed, or what is in credit, or the sessions remaining on the package ("Session 6 of 15"), whichever applies; a minor's own login sees none of this. Then anything waiting on the household: an agreement whose wording has a newer approved version (section 3.5), and the state of any request they have made. Last, how to ask for a visit: one sentence and a WhatsApp button to the practice's number (`tenant.whatsapp_number`, section 6.4); the portal does not book, and does not pretend to (the plan's deliberate omission).

**3.2 Visits** (`/portal/visits`). Upcoming: appointments with status `confirmed` or `checked_in` from the start of today, earliest first, each with the date, the 45-minute window as "10:00 to 10:45", the service's name and whether it is at home or the studio. Past: `completed`, `no_show`, `cancelled` and `cancelled_late`, most recent first, with the date and the service and a word for the outcome (`cancelled_late` reads as "Cancelled" to the household; the fee, if any, is the money screen's business). `proposed` is not shown — the practice has not told the household yet — and `rescheduled` rows are not shown because the visit that replaced them is. Never the practitioner's name, never a note, never a coordinate.

**3.3 Money** (`/portal/money`). Per client: the balance owed or in credit, computed by `domain/billing`'s `balanceFor` over the same rows the practice's own balance route reads; each active package with "Session n of N" from its entitlements; then a table of invoices (reference, date, gross, and whether it is paid) and a table of payments and receipts (date, method, amount, receipt reference where one was filed). Each invoice and receipt that has a rendered PDF opens through a short-lived signed link (section 7); the household holds the same document the practice holds. _Amended 2026-09-06 (`docs/CHANGE-REQUESTS/billing-06.md` request 1):_ an invoice the practice has forgiven says "Waived" with the day it was, in the practice's own time zone, and keeps its number and its figure — the charge left the balance, so the row has to say why. A minor's own login does not get this screen; the router sends them home.

**3.4 Family** (`/portal/family`). Per client: the client's name (Arabic beneath, or Latin beneath in the Arabic edition), the address on file as the display address and the emirate's name — never coordinates, parking or gate points, the Makani number or arrival notes — and the people on the record: relationship in words, what each may do in words (can give consent, receives reports, pays), telephone and email. The signed-in person's own row is marked as theirs and carries the one form on the portal: telephone, email, WhatsApp preference. Save answers with a Note. The address is read-only with one sentence saying the practice changes it, because it is where the practitioner drives.

**3.5 Agreements** (`/portal/agreements`). Per client, one row per consent: the purpose in plain words, the status as a word with the dot, the date given, who gave it (relationship), and "Read the wording", which opens the exact text that person was shown (`consent.text_document_id`, kind `consent_text`; the document policy already admits a contact to a wording their own consent names). A withdrawn consent shows the date withdrawn. Where the wording a consent points at has been retired and a newer approved version of the same purpose and language stands, the row says a newer version exists and the practice will ask them to read it. Beneath each active consent: "Ask to withdraw"; beneath each client: "Ask for erasure". Either opens a short form (an optional note, 200 characters) and writes a request (section 6.2). The screen then shows the request as received, with its date, and says the practice will be in touch. Nothing on this screen withdraws or erases anything by itself.

**3.6 Plain words.** Purposes: `participation` "taking part in the programme"; `minor_participation` "taking part as a minor"; `home_visit` "sessions at home"; `photo_video` "photos and video"; `research` "research"; `marketing` "marketing". Relationships: `self` "the client"; `mother`, `father`, `guardian`, `spouse`, `other` as words. Delivery: `home` "at home", `studio` "at the studio", `remote` "online". The Arabic of each lives beside the English in the dictionary.

**3.7 The invitation page** (`/portal/invite/:token`), reachable signed out. One form: email address, password, password again. On success the page signs the person in with what they just chose and lands on Home. An expired, used or revoked link says so in one sentence and tells them to ask the practice for a new one; an unknown token gets the same sentence.

**3.8 Household access** (`/admin/portal`, `app/admin/portal/`), for the owner and an admin, in the admin console's rail as "Portal". Two tables. Access: every contact on an active client, the client, whether the contact has an email and a telephone (never the values), and their state — no access, invited (expires on), active (since), or revoked — with Invite, Resend and Revoke. Invite shows the link once, with a WhatsApp button that opens `wa.me` on the contact's number carrying the drafted bilingual message and the link (a hand-off in the sending seam's sense, docs/SEAMS.md: nothing leaves this server). Requests: every open request, most recent first, with the client, the kind, the note and Mark as handled; handling is recorded, the act itself (withdrawing, erasing) is done through the record's own screens.

**3.9 Your password** (`/portal/password`, `app/client/PasswordScreen.tsx`; trunk round 41, 2026-09-10). Reached from the sidebar's foot, beside the person's name and the way out — account, not record, so not a section. The form is the shell's one `PasswordForm` (`app/shell/components/PasswordForm.tsx`), the same the console wears in English at `/account/password`: the current password, the new one twice, the practice's own rule for what a password may be (`domain/shared/password.ts`) said before the sign-in provider is asked, the provider's own floor and leaked-password check beneath, and the act recorded through `POST /api/me/password-changed` under the person's own id, never the value. Every word is the dictionary's, the rule's four sentences by key (`passwordProblemKey`), and the provider's refusals by reason, so an Arabic household never reads the provider's English. A session that has gone signs the person out. The development door has no password to change, and the screen says so.

## 4. Copy and tone

British English. Short sentences. The client is a client; the people around them are the people on the record; a session is a session. Never diagnosis, treatment, patient, condition or any medical claim. No growth language, no nudges, no emoji. Where a sentence can carry the meaning the sentence comes first; where a number exists it is in tabular figures.

## 5. Rules

The portal has a small domain of its own, `domain/portal/`, pure and tested (CLAUDE.md rule 4). Everything else it needs already exists in `domain/shared` and `domain/billing`.

1. `canActor(actor, { type: 'client.read', clientId }, { clientIds }, now)` is the gate on every portal read; `clientIds` is resolved by the route from `contact.user_id` on every request (`app.portal_client_ids()`, section 6.1).
2. `contact.write_own` (new, `domain/shared/actor.ts`): true when the actor holds `client_contact` and the contact row's `user_id` is the actor's own user id. The route asks it; migration 702's guard trigger enforces it beneath.
3. `portal.request.write` (new): a `client_contact` for a client in `clientIds`. `portal.request.handle` (new): owner, admin, lead practitioner.
4. `portal.access.manage` (new): owner and admin. Inviting, resending, revoking.
5. `moneyVisibleTo(contact, client, today)` in `domain/portal/money.ts`: false when `relationship = 'self'` and the client is under eighteen on `today`; true otherwise. Age is decided in the practice's time zone; a client with no date of birth is treated as an adult. The same rule is `app.actor_is_adult_contact_of` in the database (section 6.3), and `tests/portal/db` proves the two agree on the boundary day.
6. `inviteExpiry(issuedAt)` in `domain/portal/invite.ts`: seven days. `describeAccess(contact, user, invite, now)` turns rows into the four states of section 3.8.
7. `visitOutcome(status)` and `visitsFor(appointments, today)` in `domain/portal/visits.ts`: the split, order and words of section 3.2, with the status words in both languages.
8. `packageProgress(purchase, entitlements)`: "n of N", consumed against total, for section 3.3.

Input rules are zod schemas at the API boundary: a telephone in E.164 (the column's own check), an email, a boolean for WhatsApp; a request note boundary-cleaned by `app/api/_middleware/text.ts` and capped at 200; a password of at least twelve characters.

## 6. Data the module owns

**6.1 Migration `700_portal_invite.sql`.**

`portal_invite` — one row per invitation: `id`, `tenant_id`, `client_id` (the contact's client, denormalised so the audit trigger attributes the row; `comment on table` `'audited: client'`), `contact_id`, `user_id` (the `app_user` the invitation is for), `kind` (`first_sign_in` | `password_reset`), `locale`, `token_hash bytea` (sha256 of the token, unique per tenant; the token itself is never stored), `expires_at`, `used_at`, `revoked_at`, the standard columns. Indexes on the foreign keys and on `(client_id, created_at)`. The audit trigger. Rollback block.

Three functions in schema `app`, `security definer`, `set search_path = pg_catalog, pg_temp`, execute revoked from public and granted to `app_role`:

- `app.portal_client_ids() returns uuid[]` — the ids of clients in the current tenant with a contact row whose `user_id` is the current actor, excluding erased clients. Empty with no actor stamped.
- `app.portal_invite_status(p_token_hash bytea) returns table (state text, kind text, auth_id uuid)` — the state is `valid`, `expired`, `used`, `revoked`, `not_a_household` (the invitation names an account holding a practice role) or `unknown`. `kind` and the account's standing `auth_id` travel beside it **only when the state is `valid`**, because they are what decides which half of the auth-admin seam the door runs and the door can read no table for itself; a dead link answers its word with two nulls. Nothing else about the row: never whose invitation it is, never when it was issued, never which contact it names. Runs with no tenant stamped, because the caller is not signed in.
- `app.redeem_portal_invite(p_token_hash bytea, p_auth_id uuid, p_email text) returns uuid` — locks the invite `for update`, re-checks it is valid, links `app_user.auth_id` (and, for a first sign-in, writes the email onto `app_user.email`), sets `used_at`, and returns the user id. Raises with a plain code on any other state, so a race between two redemptions of one link ends with one winner. Writes its own audit row through the row triggers with no actor, which the trail already reads as the system.

**6.2 Migration `701_portal_request.sql`.**

`portal_request` — one row per ask: `id`, `tenant_id`, `client_id`, `contact_id` (who asked), `kind` (`consent_withdrawal` | `erasure`), `consent_id` (required when the kind is a withdrawal, null otherwise, by check), `note text` (200 characters, cleaned), `status` (`open` | `handled`), `handled_at`, `handled_by`, the standard columns, `'audited: client'`, indexes, the audit trigger, rollback. Append-only except the two handling columns: no delete grant.

**6.3 Migration `702_contact_self_service.sql` and `app.actor_is_adult_contact_of`.**

`app.guard_contact_self_service()` — a `before update` trigger on `contact`, the pattern of `app.guard_location_notes` (migration 100): a staff role passes; an actor holding `client_contact` and no staff role may update a row only when `user_id` is their own, and only `phone`, `email`, `whatsapp_opt_in` (and `updated_at`) may differ, compared structurally with `to_jsonb`, so a column added later is guarded without anyone remembering to name it.

`app.actor_is_adult_contact_of(p_client_id uuid) returns boolean` — security definer: true when the actor has a contact row on the client that is not (`relationship = 'self'` and the client's `date_of_birth` makes them under eighteen today in the practice's time zone). The money policy asks it.

**6.4 Migration `910_practice_whatsapp.sql` (trunk range, applied by this piece under the integrator's authorisation, `docs/CHANGE-REQUESTS/client-portal-05.md`).** `tenant.whatsapp_number text` nullable, E.164 by check. Shown on the Practice settings page beneath the practice's identity and written by the practice route (owner and admin, as every tenant column); `app.guard_tenant_identity` (905) already governs who writes the row.

**6.5 Policies.**

`db/policies/portal/access.sql` — `portal_invite`: tenant isolation; select, insert and update for owner and admin only; nobody else, and never a contact, not even their own. `portal_request`: tenant isolation; select for owner, admin, lead practitioner, and a contact for their own client; insert for a contact for their own client (and the three office roles); update of the handling columns for the three office roles; delete for nobody. Every condition passes through `app.client_erasure_gate` as the ledger's do.

`db/policies/portal/money.sql` — one restrictive select policy on each of `package_purchase`, `entitlement`, `invoice`, `invoice_line`, `payment` and `billing_document`:

```
not app.actor_has_role('client_contact')
  or app.actor_has_role('owner') or app.actor_has_role('admin')
  or app.actor_has_role('lead_practitioner')
  or app.actor_has_role('practitioner') or app.actor_has_role('finance')
  or app.actor_is_adult_contact_of(client_id)
```

Restrictive, so it can only narrow what `ledger_readers` grants; the only actor it narrows is one holding `client_contact` and no practice role at all, which is the household, which is the rule.

**The practice's own roles are named because the two-term form did not deliver the sentence beside it.** This section printed `not app.actor_has_role('client_contact') or app.actor_is_adult_contact_of(client_id)` until 2026-09-05, and for a staff member who is also a contact the first term is false — the founder is a contact of her own child's record — so the second would have narrowed her to the households she is a contact of and taken her admin reach over every other household's money. One person is several things at once (`00-data-model.md` section 2), and a policy written as though a role were exclusive says something other than what it means to. The added disjuncts can only relax a narrowing and never widen past `ledger_readers`.

Two arms in files other streams own, applied by this piece under the same authorisation:

- `db/policies/scheduling/appointment_access.sql`, `scheduling_read_scope`: `or (app.actor_has_role('client_contact') and app.actor_is_contact_of(client_id))`. An erased client's contacts lose `user_id` in `app.erase_client`, so the arm closes with the erasure.
- `db/policies/client/writers.sql`, `client_record_update_writers` on `contact`: `or (app.actor_has_role('client_contact') and user_id = app.current_actor_id())` in both `using` and `with check`; the guard trigger of 6.3 narrows the columns.

No other grant changes. `service_type`, `tenant` and the actor's own `app_user` row are already readable under tenant isolation alone; `practitioner` is not selected by any portal query.

## 7. API (`app/api/portal/`)

Every signed-in route runs inside the request context, resolves `clientIds` with `app.portal_client_ids()`, checks the rule in section 5, reads under row security as the caller, records the read (`logRead`/`logReads`), and parses its answer through `schema.ts`, so nothing extra leaks. A client outside the household answers 403 and a `refused` audit row, as the client-record routes do.

| Route | Answers |
|---|---|
| `GET /api/portal/home` | next visit, per-client money summary (omitted for a minor's own login), notices, the practice's name and WhatsApp number |
| `GET /api/portal/visits` | upcoming and past, per client, as section 3.2 |
| `GET /api/portal/money` | balance, packages, invoices, payments per client; 403 for a minor's own login |
| `GET /api/portal/documents/:documentId/link` | a signed URL for one of the household's invoices or receipts, after `auditDocumentRead`, the seam's rule (docs/SEAMS.md); 404 when the row is not the household's or the bytes were never filed |
| `GET /api/portal/family` | clients, addresses (display address and emirate only), people; `isYou` on the caller's row |
| `PATCH /api/portal/contacts/:contactId` | the three fields; `contact.write_own` |
| `GET /api/portal/agreements` | consents per client with their wording's freshness |
| `GET /api/portal/consents/:consentId/wording` | the exact text, the way `app/api/clients/consent-wording.ts` answers it and with the same care about the trail |
| `POST /api/portal/requests` | a withdrawal or erasure request; `portal.request.write` |
| `GET /api/portal/access`, `POST /api/portal/access/:contactId/invite`, `POST …/revoke` | section 3.8; `portal.access.manage`. Invite answers the link once and the drafted message; the token is never readable again |
| `GET /api/portal/requests`, `POST /api/portal/requests/:id/handle` | the office side; `portal.request.handle` |

**The door**, `POST /api/portal/invite/redeem`, is public and mounted ahead of the authentication fence with its own budget (`RATE_LIMIT_INVITE_DOOR_PER_MINUTE`, default 10 per address). Body `{ token, email, password }`. It opens a transaction as `app_role` with only the request id stamped, asks `app.portal_invite_status`, and answers **404 for every state that is not `valid`** — unknown, expired, used, revoked and an invitation naming a practice account alike. One status, not two: a 404 for an invented token beside a 410 for a dead one tells a caller which links once existed, and saying nothing costs nothing. The invitation page's own sentence (section 3.7) is the same in all five cases and does not change. For `valid` it creates the sign-in through the auth-admin seam (section 8) — or, for a `password_reset`, sets the new password on the existing one — then calls `app.redeem_portal_invite`. If the database step fails after the sign-in was created, the sign-in is deleted again through the seam and the failure logged by request id; the person is told to try the link again. Answers `{ ok: true }`; on a laptop, where the seam is the fake, it also answers `authId` so the development door can sign the person in.

Invite issuing (`POST …/invite`): if the contact has no `app_user`, creates one (`display_name` from the contact's names, `preferred_locale` from the client's, status active) with a `client_contact` role and writes `contact.user_id`; if one exists and is suspended, reactivates it; issues a 32-byte random token, stores its sha256, kind `first_sign_in` when `auth_id` is null and `password_reset` otherwise, expiry seven days; answers the link and the message. Revoke: `app_user.status = 'suspended'` (so `app.resolve_actor` refuses the next request and the shell signs the person out) and `revoked_at` on every open invite. Both write `logAction` rows naming the contact's id and nothing else.

Never in any answer: the Emirates ID columns, coordinates, arrival notes, the Makani number, a staff member's name, telephone or email, a token hash, or a raw audit row.

## 8. The auth-admin seam

`app/api/portal/auth-admin.ts` — the abstract shape and two implementations, in the storage seam's mould (docs/SEAMS.md): `createUser({ email, password }) → { authId }`, `setPassword(authId, password)`, `deleteUser(authId)`. The real one calls Supabase Auth's admin endpoint with `SUPABASE_AUTH_ADMIN_KEY` — its own variable, never a fallback to the service role key, blank meaning absent, refused if it is the anon key, exactly as `SUPABASE_STORAGE_KEY` is handled — and reports `email_in_use` as its own error. The fake mints a random auth id and remembers it; it is the implementation on a laptop and in the tests. Outside development the door answers 503 `auth_admin_unavailable` when no key is set, and everything else starts. `tests/portal/auth-admin.test.ts` is the forced-fallback test. `server.ts` and `create-api.ts` take the provider as an option like `storage`, and the vendor line for Supabase Auth in `docs/COMPLIANCE/approved-vendors.md` already covers it.

## 9. Audit

Every open of a portal screen writes `read` or `list` rows as the contact, so the practice's timeline shows the household's own visits to the record. Invites, revocations, requests and handling are `logAction` rows or row-trigger rows with ids only. The narrative catalogue (`domain/shared/audit-narrative.ts`) gains sentences for `portal_invite`, `portal_request` and the two actions, in both languages; the generic branch already keeps the timeline whole until it does.

## 10. Security

- No personal data in a URL: opaque ids and the one-time token only, and no query string carries anything.
- The household is resolved in the database from the actor stamp. Every policy this piece adds is restrictive.
- The token is 32 random bytes, shown once, stored hashed, single use, seven days, revocable; the door is rate limited and never says why a link is dead.
- The only route outside the fence talks to the database through two security-definer functions that take a hash and answer a word or link a row, and to nothing else.
- Protective headers, budgets, the body cap, the timeout and JSON-only bodies are inherited from the API.

## 11. Shared-zone changes this piece carries

Listed and authorised in `docs/CHANGE-REQUESTS/client-portal-05.md`, applied in the same pull request rather than a separate trunk round (docs/HANDOVER.md, cost rule 6): the four actions in `domain/shared/actor.ts`; `preferredLocale` on `/api/me`; the routes in `app/shell/App.tsx` and the rail entry with `canOpenPortalAccess`; the mounts and the `authAdmin` option in `app/api/create-api.ts` and `server.ts`; migration 910; the two policy arms; the seed's two client contacts with logins and the practice's WhatsApp number; the narrative sentences; `.env.example`.

## 12. Deliberately left out

Booking from the portal. A guardian or emergency-contact field: the platform's record has neither, and adding one is the operator's to ask for. Session notes, measurements and reports (piece ten). An access report ("who has seen this record"): the audit-ui stream's, listed under the plan's small things. Saving the language choice on the server: the portal defaults to the person's `preferred_locale`, set from the client's when they are invited, and remembers a switch in the browser. Deleting a Supabase sign-in on revocation: suspension is the boundary, and the seam's `deleteUser` exists for the door's own clean-up only.

## 13. Done when

- Under row security, a `client_contact` sees their household's client, contact, consent, document, location, appointment and ledger rows, and their own user row, and nothing of another household's; a minor's own login sees no ledger row; a contact can update only their own contact row and only the three fields; a contact can insert a request only for their own client; nobody but owner and admin reads or writes `portal_invite`. Proven in `tests/portal/db/`, one deny test per grant.
- `app.redeem_portal_invite` answers each state correctly and a second redemption of the same link fails; expiry is seven days; revocation closes every open invite for the contact.
- Every route in section 7 answers its shape for a household of one client and of two; each open writes exactly the audit rows section 9 names; the door is unreachable with a session-bearing request pattern that would matter and reachable without one; the fake seam is what the tests and the laptop use.
- The five screens and the invitation page render from a fake API in English and in Arabic with `dir="rtl"`, including loading, empty and error states; the money screen is absent for a minor's own login; the admin page issues and revokes.
- The portal's files contain no colour literal, no physical CSS property, no hardcoded sentence outside the dictionary, and none of the brief's tells; every database test on `main` still passes; `pnpm verify` and `pnpm test:db` are green.
