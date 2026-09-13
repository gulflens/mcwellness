# SPEC — Client Record

*Worktree: `client-record`. Entities: `client`, `contact`, `location`, `consent`, `document`, `goal`, `erasure_request` — defined in `00-data-model.md`. This spec defines behaviour, not schema.*

---

## 1. Purpose

One record per client from first enquiry to close. Everything else in the system hangs off it. It must be correct, coded, and consent-complete before a session can be scheduled.

## 2. Who uses it

| Role | Can |
|---|---|
| `admin` | Create, edit demographics/contacts/locations, upload documents, record consent, view all |
| `lead_practitioner` | All of the above, plus set and close goals, view erased records |
| `practitioner` | Read the client brief for clients on their schedule only; add access notes to a location |
| `finance` | Read demographics and contacts; no goals or session data |
| `client_contact` | Read own client's demographics; update own contact details (portal, Stage 2) |

## 3. Lifecycle

```
lead ──► active ──► paused ──► active
              └──► closed
any ──► erased   (erasure request)
```

- `lead`: created from an enquiry. Minimum: one name, one contact phone. No goals or session data on a lead.
- `lead → active` requires: date of birth, at least one `location` with verified coordinate, `participation` consent active (plus `minor_participation` if under 18, given by a contact who is a legal guardian and may consent, plus `home_visit` if any home delivery). Emirates ID is optional and never required.
- `active → paused`: no scheduling allowed; entitlements don't expire while paused (see FINANCE).
- `closed`: read-only except documents. Reactivation creates an audit event with reason.
- `erased`: see §8.

## 4. Screens (admin)

**4.1 Client list.** Table, not cards. Columns: MRN, name (EN, AR beneath), age, status, primary contact, emirate, sessions delivered / entitled, last session, next appointment. Filter by status, emirate, practitioner. Search by name, MRN, phone, Emirates ID (hashed lookup). Row click opens the detail drawer.

**4.2 Client detail.** Right-side drawer, tabs:
- **Overview** — demographics, status, MRN, ribbon (Stage 2), key contacts, primary location with map thumbnail
- **Contacts** — list with relationship flags; one must be `can_consent` before activation
- **Locations** — list; each shows Makani, entrance pin, parking pin, gate pin, access notes; "check the pin" opens the pin picker in a new tab, where the marker can be dragged or tapped into place (trunk round 43, part two); the latitude and longitude boxes stay on the panel itself, for a coordinator who already has the numbers
- **Consent** — every purpose with status, version, who gave it, when; record new consent; withdraw with reason
- **Goals** — the client's goals and concerns (category from the owner-editable list, free text beside it), current wellbeing notes, who referred them. *Concerns built 2026-09-14 as their own table; see section 4.6.*
- **Documents** — upload, preview, kind, retention date shown
- **Timeline** — the audit record for this client in plain language (AUDIT-SPEC §9.1)

**4.6 Concerns, and the six health answers.** *Added 2026-09-14, on the
operator's instruction to build what section 4.2 had always promised.*

A **concern** is what the household is worried about: a category from the same
owner-editable list a goal uses, free text beside it, and a status of its own —
`open` or `resolved`, never "achieved", which is a word for goals and reads
badly about a worry. It is its own table rather than a flag on `goal` because
goals are gathered into progress reports (`app/api/reports/gather.ts`) and
printed into signed documents a household reads: a concern in that table would
appear in somebody's report as a goal they never set. The owner, an admin and
the lead practitioner record one — wider than a goal, which only the owner and
the lead practitioner set, because a concern is the household's own words
written down at enrolment, and an admin enrols.

The **health answers** are the six things `docs/CONSENT/agreement.en.md` asks
every household to tell the practice "before the first session, and if it
changes": epilepsy or any seizure; a pacemaker or any implanted electrical
device; a head injury at any time; pregnancy; medication that affects mood,
sleep or attention; a skin condition or sensitivity on the scalp. Until this
round nothing stored the answers — they were told to somebody and remembered by
that person.

Three decisions, the operator's, taken 2026-09-14:

| | |
|---|---|
| Who may read them | Whoever may open the record: the owner, an admin, the lead practitioner, and a practitioner for a client on their own schedule. **Not finance**, who books and takes money. Not the household's own portal login. |
| What a "yes" does | It shows on the record and on the practitioner's own card for that visit, so it is seen at the door. It blocks nothing and warns nobody. |
| When they are asked | At enrolment, and editable on the record whenever the household says something has changed. |

**A change is a new row.** Each asking is its own row with who recorded it and
when; the newest is the current answer and the older ones are what was true
before. The table grants no update at all, and there is no route that edits
one. `wording_version` records which version of the agreement asked, so an
answer can be read against the words the household actually signed.

**A practitioner reads and does not write.** Told something at the door, they
tell the office, which keeps one path in for health answers rather than two.
That is narrower than it could be and can widen the day somebody asks.

**The erasure reaches both** (`964_erasure_reaches_concerns_and_health.sql`):
a concern keeps its typed category and loses its words, the way a goal does,
because "three clients came with sleep" is a figure about the practice rather
than about a person; the health answers are deleted outright, rows and all,
because the six of them *are* the personal part and nothing survives reducing
them.

**None of this is a diagnosis** (CLAUDE.md rule 1). It records what a household
chose to tell a wellness practice, in the agreement's own words, so that the
person at the door is not surprised.

**4.3 Enrolment.** The wizard that enrols a new client (the operator's word, 2026-09-03: enrolment, never intake). Steps: identity → contacts → location (with "find my Makani" helper and pin verification) → goals (goals and concerns, referral) → consent capture → summary. Saves as `lead` at any step; activation button appears when §3 conditions are met and lists what's missing otherwise.

## 5. Rules (each is a pure function in `domain/client`, each has tests)

1. `canActivate(client)` → `{ ok, missing[] }` — the §3 gate.
2. `isMinor(dateOfBirth, atDate)` — under 18.
3. `requiredConsents(client, deliveryModes)` → purposes that must be active.
4. `validateEmiratesId(raw)` — 15 digits, starts `784`, Luhn check digit valid. No expiry check: the expiry column was dropped in the compliance review for want of a need (decision of 2026-09-02). Returns normalised form. Only when one is captured; never required.
5. `mrn.next(tenant)` — `MW-000001`, sequential per tenant, never reused.
6. `canViewClient(actor, client)` — same tenant first; then role, schedule-based visibility for practitioners, and erased handling. Reading needs no credential (delivering does). Finance opens the record but sees demographics and contacts only, never locations, goals, consents or documents (section 2): that scope is applied per section by the API and floored by the read policies, not by this rule.
7. `computeRetentionUntil(lastActivityAt)` — +5 years.

## 6. Coded fields

- Goals: category from the owner-editable reference table, description beside it.
- Relationship, consent purpose, location label, status: enums from the data model.
- Free text always sits beside a typed field, never instead of one.

## 7. Consent capture

- Consent wording is a versioned `document` per purpose and locale. Recording consent stores the exact document version shown.
- Method `app_signature`: draw signature on screen → PNG → `document`, hash stored.
- Method `paper_scan`: upload photo of signed form.
- Method `verbal_witnessed`: practitioner records, second staff member confirms; allowed only for `home_visit` re-confirmation, never for initial `participation`.
- Withdrawal: reason required, immediate effect, existing sessions in progress complete, future appointments cancelled with notification (Stage 2).

### Signing everything at once

A walkthrough of 10 September found nine actions — three scrolls, three drawn signatures, three typed names — standing between a household and an activated client, one for each purpose it needed. The operator's decision the same afternoon: one signature should cover everything a client needs, in one sitting.

`POST /api/clients/:id/consents/bundle` is the route. It takes the purposes the client needs, each naming the wording it was shown, one giver, one method (`app_signature` or `paper_scan` — never `verbal_witnessed`, which is one purpose's own re-confirmation at the door and never a first signature), and one piece of evidence. Before it writes anything it runs, per purpose, every check the single-consent route above runs: the wording named is the current approved one for that purpose and the client's own language, the giver may give it (`canGiveConsent`), the evidence fits the method. Two checks are the bundle's own: a purpose this client does not need (`requiredConsentsFor`, judged from the date of birth alone) is refused, so a screen can never file more than the household was actually shown; and the same purpose named twice in one signing is refused, since one signing gives one consent per purpose. Every check for every purpose runs to completion before a single row is written, so a refusal on the last purpose leaves no earlier ones.

The evidence — the drawn signature or the scanned form — is filed once, immutably, and every consent row written by the bundle points at that same `signature_document_id`. The image itself says what it covers: `SignaturePad`'s `caption` prints one line or more, naming the purposes in the same words their on-screen headings use, beneath the signed name and the date — wrapped across as many lines as those words need, with the image growing to hold them, rather than shortened to fit. Each row still names the exact wording document it was read against, exactly as a single consent does — nothing about a wording, or its version, changes for this. On screen, the household reads every purpose's full approved text, one after another under its own heading, and the pad stays gated until the combined stack has been read to its end; a household never sees less than the whole of what it signs.

A withdrawal stays a withdrawal of one purpose, recorded on the row that purpose owns. It leaves the shared image referenced by whichever of the other rows still stand — which is honest rather than a gap, because the image is immutable and unrelated to any one purpose's standing, and the withdrawal row itself records which purpose ended and why. A verbal re-confirmation, and a withdrawal, are both the per-consent form's own; "sign everything at once" is offered only while something required is still missing, and never replaces either.

## 8. Erasure request

Admin action "Record erasure request" → reason, requested by (contact), date. System then:
1. Runs `app.erase_client(client_id, request_id)` as the owner (the API role never deletes), inside one transaction that sets `app.erasure = 'true'` so every audit row it writes keeps field names and withholds values: names and Arabic names become "Erased client"; date of birth, sex, the Emirates ID columns and referral source are nulled; `contact.phone/email/whatsapp_opt_in` are nulled and the portal user account removed; each `location` keeps only its emirate and has its coordinates replaced by the emirate's centroid, with Makani, address, parking, gate and notes cleared. The visit record is anonymised with it: `session.checked_in_point`, `checked_out_point`, `observations` and `setup_photo_document_id` are nulled, `amendment_reason` is cleared where the row's own constraint allows it, `visit_actuals.access_issues` is nulled, and every `session_event.payload` of that client's visits keeps only its numbers and booleans, so a note, a timestamp or a coordinate inside one cannot survive. The measurements do survive, and deliberately: `pre_rating`, `post_rating`, `telemetry`, `preflight`, `signal_check` and `signal_quality_score` identify nobody once the record around them is anonymous, the practice uses them in aggregate, and the confirmation letter tells the household exactly that.
2. Deletes every `document` from storage except issued invoices, which keep what tax law requires for 5 years.
3. Sets `client.status = 'erased'`. Excluded from all lists, searches, schedules and reports. The row stays so ledgers and audit history reconcile; only `lead_practitioner` may open it, with a reason prompt (and the owner, who holds every role: CLAUDE.md section 5; the API refuses an erased record's history without a reason, PR 6).
4. Writes `erasure_request` with what was anonymised and what was deleted.
5. Generates a confirmation letter (Stage 2 template) for the contact.

Audit rows written before the erasure keep the identifiers for the log's own minimum of five years; the lawyer confirms this exception under the personal-data law before the first erasure. Nothing drops them on a timer (CLAUDE.md rule 8, operator 2026-09-09).

## 9. Audit

Every read of the detail drawer is logged (AUDIT-SPEC §5 read logging). Every write goes through triggers. Sensitive actions with reason prompt: erasure, consent withdrawal, goal removal, reactivation from closed, opening an erased record.

## 10. Out of scope for this worktree

Scheduling from the client screen (scheduling worktree), entitlement balances beyond a read-only count (billing), the ribbon (reports), WhatsApp messaging.

## 11. Done when

- All §5 functions have tests covering every branch, including an Emirates ID with a bad checksum and a 17-year-old turning 18 mid-programme.
- A synthetic client can go lead → active through the wizard on staging with every §3 condition enforced.
- A practitioner not on that client's schedule cannot open the record; the attempt is audited.
- An erasure request anonymises the personal fields, removes the documents, and leaves a row in status `erased` that only `lead_practitioner` can open.
- `pnpm verify` green; compliance-reviewer and security-reviewer pass.
