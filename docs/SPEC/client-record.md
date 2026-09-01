# SPEC — Client Record

*Worktree: `client-record`. Entities: `client`, `contact`, `location`, `consent`, `document`, `diagnosis`, `erasure_request` — defined in `00-data-model.md`. This spec defines behaviour, not schema.*

---

## 1. Purpose

One record per client from first enquiry to discharge. Everything else in the system hangs off it. It must be correct, coded, and consent-complete before a session can be scheduled.

## 2. Who uses it

| Role | Can |
|---|---|
| `admin` | Create, edit demographics/contacts/locations, upload documents, record consent, view all |
| `clinical_lead` | All of the above, plus add/resolve diagnoses, view locked records |
| `practitioner` | Read the client brief for clients on their schedule only; add access notes to a location |
| `finance` | Read demographics and contacts; no clinical fields |
| `client_contact` | Read own client's demographics; update own contact details (portal, Stage 2) |

## 3. Lifecycle

```
lead ──► active ──► paused ──► active
              └──► discharged
any ──► locked   (erasure request)
```

- `lead`: created from an enquiry. Minimum: one name, one contact phone. No clinical data allowed on a lead.
- `lead → active` requires: Emirates ID captured and valid, date of birth, at least one `location` with verified coordinate, `treatment` consent active (plus `minor_treatment` if under 18, plus `home_visit` if any home delivery).
- `active → paused`: no scheduling allowed; entitlements don't expire while paused (see FINANCE).
- `discharged`: read-only except documents. Reactivation creates an audit event with reason.
- `locked`: see §8.

## 4. Screens (admin)

**4.1 Client list.** Table, not cards. Columns: MRN, name (EN, AR beneath), age, status, primary contact, emirate, sessions delivered / entitled, last session, next appointment. Filter by status, emirate, practitioner. Search by name, MRN, phone, Emirates ID (hashed lookup). Row click opens the detail drawer.

**4.2 Client detail.** Right-side drawer, tabs:
- **Overview** — demographics, status, MRN, ribbon (Stage 2), key contacts, primary location with map thumbnail
- **Contacts** — list with relationship flags; one must be `can_consent` before activation
- **Locations** — list; each shows Makani, verified pin, parking pin, gate pin, access notes; "verify pin" opens a map to drag the marker
- **Consent** — every purpose with status, version, who gave it, when; record new consent; withdraw with reason
- **Clinical** — diagnoses (ICD-10 picker with search), allergies (free text beside SNOMED where possible), referring clinician
- **Documents** — upload, preview, kind, retention date shown
- **Timeline** — the audit record for this client in plain language (AUDIT-SPEC §9.1)

**4.3 Intake wizard.** Steps: identity → contacts → location (with "find my Makani" helper and pin verification) → clinical intake (diagnoses, referral, current medication as free text) → consent capture → summary. Saves as `lead` at any step; activation button appears when §3 conditions are met and lists what's missing otherwise.

## 5. Rules (each is a pure function in `domain/client`, each has tests)

1. `canActivate(client)` → `{ ok, missing[] }` — the §3 gate.
2. `isMinor(dateOfBirth, atDate)` — under 18.
3. `requiredConsents(client, deliveryModes)` → purposes that must be active.
4. `validateEmiratesId(raw)` — 15 digits, starts `784`, checksum valid, expiry not past. Returns normalised form.
5. `mrn.next(tenant)` — `MW-000001`, sequential per tenant, never reused.
6. `canViewClient(actor, client)` — role + credential + schedule-based visibility for practitioners + locked handling.
7. `computeRetentionUntil(lastClinicalActivityAt)` — +25 years.

## 6. Coded fields

- Diagnoses: ICD-10-CM, searchable picker, code stored, description denormalised.
- Nationality: ISO 3166-1 alpha-3.
- Relationship, consent purpose, location label, status: enums from the data model.
- Free text always sits beside a code, never instead of one. The picker must not allow a blank code.

## 7. Consent capture

- Consent wording is a versioned `document` per purpose and locale. Recording consent stores the exact document version shown.
- Method `app_signature`: draw signature on screen → PNG → `document`, hash stored.
- Method `paper_scan`: upload photo of signed form.
- Method `verbal_witnessed`: practitioner records, second staff member confirms; allowed only for `home_visit` re-confirmation, never for initial `treatment`.
- Withdrawal: reason required, immediate effect, existing sessions in progress complete, future appointments cancelled with notification (Stage 2).

## 8. Erasure request

Admin action "Record erasure request" → reason, requested by (contact), date. System then:
1. Erases: `contact.email/phone/whatsapp_opt_in` for non-guardian contacts, marketing flags, portal user account, `document.kind = 'setup_photo'`, `referral_source`.
2. Locks: `client.status = 'locked'`. Excluded from all lists, searches, schedules, reports. Visible only to `clinical_lead` via a dedicated "Locked records" screen with reason prompt on open.
3. Writes `erasure_request` with what was erased and what was locked.
4. Generates a confirmation letter (Stage 2 template) for the contact.

## 9. Audit

Every read of the detail drawer is logged (AUDIT-SPEC §5 read logging). Every write goes through triggers. Sensitive actions with reason prompt: erasure, consent withdrawal, diagnosis removal, reactivation from discharged, opening a locked record.

## 10. Out of scope for this worktree

Scheduling from the client screen (scheduling worktree), entitlement balances beyond a read-only count (billing), the ribbon (reports), WhatsApp messaging, NABIDH mapping.

## 11. Done when

- All §5 functions have tests covering every branch, including an Emirates ID with a bad checksum and a 17-year-old turning 18 mid-treatment.
- A synthetic client can go lead → active through the wizard on staging with every §3 condition enforced.
- A practitioner not on that client's schedule cannot open the record; the attempt is audited.
- An erasure request leaves the clinical record retrievable by `clinical_lead` and nothing else.
- `pnpm verify` green; compliance-reviewer and security-reviewer pass.
