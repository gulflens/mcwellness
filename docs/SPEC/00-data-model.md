# 00 — Data Model

*The canonical entity map. Every other spec references this one. If a module needs an entity that isn't here, the change goes here first.*

Status: **v1 — owner decisions resolved. Ready to derive the trunk schema.**

---

## 1. Conventions (apply to every table)

| Rule | Detail |
|---|---|
| Primary key | `id uuid` — never sequential integers on tables holding personal data |
| Tenancy | `tenant_id uuid not null` on every table. One tenant today. Row-level security filters on it from day one. |
| Timestamps | `created_at`, `updated_at` (timestamptz). No soft-delete flag: the API role never deletes; rows are superseded, closed or erased under the retention rule (see §7). |
| Provenance | `created_by uuid` referencing `user`. Audit log carries the rest (see AUDIT-SPEC). |
| Money | Integer fils (AED × 100). Never floats. Currency column present, always `AED` for now. |
| Structure | Measurements, goals and observations are typed fields. Free text may sit beside a typed field, never replace it. No diagnosis codes: this is a wellness business. |
| Identifiers | Emirates ID, if collected at all (only to verify the adult who consents for a minor or who is refunded), stored field-level encrypted plus a keyed HMAC-SHA256 for lookup; never plain text, never an image, never required to enrol. Phone stored E.164. |
| Enumerations | Small closed sets (status fields) are Postgres enums. Open sets (service types, goal categories) are reference tables. |
| Naming | `snake_case` tables and columns, singular table names. |

---

## 2. Identity, tenancy and access

### `tenant`
The practice. One row. Legal name, TRN (VAT), default emirate, timezone, studio `location_id`, and `whatsapp_number` (E.164, nullable): the number a household messages the practice on, shown on the client portal's Home as a `wa.me` hand-off and written from Practice settings by the owner or an admin (migration 910, `SPEC/client-portal.md` section 6.4).

### `user`
Anyone who logs in — staff or client contact. Auth record lives in Supabase Auth; this table holds the profile. `auth_id`, `display_name`, `email`, `phone`, `preferred_locale` (`en`/`ar`), `status` (`active`/`suspended`/`archived`).

Roles are not on the user row — they're on `user_role`. One user may be several things at once.

### `user_role`
`user_id`, `role` (`owner`, `admin`, `lead_practitioner`, `practitioner`, `finance`, `client_contact`), `granted_at`, `granted_by`.

### `practitioner`
A person who delivers or supervises sessions. `user_id`, `display_name_ar`, `home_base_location_id` (where their day starts), `vehicle` (`personal` — reimbursed mileage and Salik; see FINANCE), `status`.

### `credential` — the authorisation table
```
practitioner_id × service_type_id × certification
  certification         'bcia_bcn' | 'vendor_qeeg' | 'degree' | ...   (open set)
  certifying_body       BCIA, the equipment vendor, a university
  certificate_number
  valid_from, valid_to  (valid_to null when it does not expire)
  can_author_protocol   bool
  can_execute_session   bool
  can_sign_report       bool
  evidence_document_id
```
What a user may *do* is resolved from `user_role` + `credential`, never from role alone. A practitioner with an expired credential can log in and see their schedule but cannot be assigned a session. Expiry dates feed the compliance board.

### `service_type`
The catalogue. `code` (`nf-session`, `brain-map`, `consultation`, `cpt-test`, `progress-report`, …), `name`, `name_ar`, `duration_minutes`, `requires_certification`, `delivery_modes` (subset of `home`, `studio`, `remote`), `status`. **Never hardcode "neurofeedback."**

It also carries what the session runner asks for this service, as data the practice edits rather than a list in a component (migration 901, `SPEC/session-capture.md` sections 3.2, 3.5 and 6):

```
preflight_checklist  jsonb  [{ key, label_en, label_ar }]              what the practitioner confirms at the door
rating_questions     jsonb  [{ key, label_en, label_ar, min: 0, max: 10 }]  asked before the session and again after
```

Both default to `[]`, so a service that asks nothing asks nothing. An answer is recorded against `key`, which is stable; a label may be reworded at any time without changing what an old answer meant. The database checks only that each column holds a JSON array — an item's shape is validated at the edge, in `domain/session`, where a bad one can be refused with a sentence.

### `location`
Any place: a client's home, the studio, a practitioner's home base.
```
owner_type          'client' | 'tenant' | 'practitioner'
owner_id
label               'home' | 'work' | 'school' | 'studio' | 'base' | 'other'
emirate             'DXB' | 'AUH' | 'SHJ' | 'AJM' | 'UAQ' | 'RAK' | 'FUJ'   -- required
makani_number       text null                                                  -- Dubai only
entrance_point      geography(point) not null                                  -- verified coordinate, required
parking_point       geography(point) null
community_gate      geography(point) null
display_address     text
access_notes        text            -- arrival intelligence; structured in Phase 2
is_primary          bool
```
Makani optional, verified coordinate mandatory. See NAVIGATION-SPEC §2.

---

## 3. Client and household

### `client`
The person receiving sessions. `mrn` (human-readable record number, tenant-unique), `given_name`, `family_name`, `given_name_ar`, `family_name_ar`, `date_of_birth`, `sex_at_birth` (optional; the qEEG normative comparison uses age and sex), `preferred_locale`, `primary_contact_id`, `primary_location_id`, `referral_source`, `status` (`lead`, `active`, `paused`, `closed`, `erased`).

Minors are the common case. A client is *not* necessarily a user.

### `contact`
Parent, guardian, spouse, or the client themself. `client_id`, `user_id` (nullable — only if they log in), `relationship` (`self`, `mother`, `father`, `guardian`, `spouse`, `other`), `is_legal_guardian`, `can_consent`, `can_receive_reports`, `can_pay`, `phone`, `email`, `whatsapp_opt_in`, and, only when the practice must verify the adult who consents for a minor or who is refunded, `emirates_id_encrypted` and `emirates_id_hash` (keyed HMAC, unique per tenant, never plain text, never an image).

### `consent`
First-class, versioned, purpose-scoped, withdrawable.
```
client_id, given_by_contact_id
purpose        'participation' | 'minor_participation' | 'home_visit' |
               'photo_video' | 'research' | 'marketing'
version        int                        -- of THIS consent, counting its amendments
text_document_id                          -- the exact wording shown
status         'active' | 'withdrawn' | 'expired' | 'superseded'
given_at, withdrawn_at, expires_at
method         'app_signature' | 'paper_scan' | 'verbal_witnessed'
signature_document_id
```
Every session start checks the relevant active consent at that moment. No active `participation` consent → session cannot start.

**`consent.version` is the consent record's own version, not the wording's** (decided in trunk round 14, because the column's old comment read either way and a reader could not tell). It counts amendments of this consent: a first giving is 1, and it moves only when this consent is amended. The version of the *wording* is never copied here — it is reached through the pointer `text_document_id`, and lives on that document row as `document.version`. The two are free to disagree and usually do: a first giving (`version` 1) of wording `0.1-draft` is the ordinary case, and the seed writes exactly that.

### `document`
Anything filed against a client, or a practice document such as a practitioner's certificate (`client_id` null): referral letters, signed consents, reports, setup photos, certificates. Never an image of an identity document. `client_id`, `kind`, `storage_key` (Supabase Storage, versioned bucket), `mime_type`, `sha256`, `uploaded_by`, `retention_until` (computed: 5 years from the client's last activity, or from upload for a practice document), `is_immutable`.

**Retention.** `retention_until` is the application's to compute at upload, never the database's: `documentRetentionUntil` in `domain/shared/storage.ts` is the one piece of arithmetic, five years from upload for a practice document. **A `consent_text` document is exempt from that clock and its `retention_until` is deliberately null** — it is the text people were shown, and a consent recorded in year four of a wording's life would outlive the words it points at. Such a row is kept until no `consent` references it and the last referencing client's own retention has expired. Null therefore means "not on an upload clock", never "nobody computed it" (`db/seed/apply.ts` says so where it writes one), and a deletion job must check what still references a document before it calls `storage.delete` (`docs/SEAMS.md`): deleting on `retention_until` alone would take a wording out from under a consent that is still live.

**The write floor** (migration 903). Row security says which practice's rows an actor may reach; a guard trigger says what may then be done to one, because the question is who is acting and row security asks only which rows. Only the owner or an admin may file a `consent_text` row or write any of the five columns below. A row with `is_immutable` is neither changed nor deleted — an erasure excepted, and one change excepted: an owner or an admin may set `retired_at` from null, once, with every other column standing still, which is how a wording is superseded without ever being edited. `is_immutable` never goes back to false, erasure included.

The bytes behind `storage_key` are reached only through the storage seam (`docs/SEAMS.md`, `domain/shared/storage.ts`): a private bucket in production and staging, a folder on this machine on a laptop and in the tests. A key is built from ids alone — `tenant/<tenantId>/client/<clientId>/<documentId>` or `tenant/<tenantId>/practice/<documentId>` — and never carries a name, a record number or what the document says.

For kind `consent_text` only, five further columns say which wording a row is and whether it is the current one (migration 902, `SPEC/client-record.md` section 7): `purpose` (the consent purpose), `locale` (`en` or `ar`), `version` (from the wording file's own front matter), `status` (`draft` until the practice's lawyer approves that version) and `retired_at` (when a newer approved version replaced this one). No other kind may carry any of them, within a row the first four are all present or all absent, a wording belongs to no client (`client_id` is null), and `(tenant_id, purpose, locale, version)` is unique — so a consent row can point at the exact text a person was shown and mean it. The texts live in `docs/CONSENT`, one file per purpose per language; a change is a new version and a new row, never an edit in place.

At most one **current** wording exists per practice, purpose and language: a partial unique index over the approved, unretired rows. Superseding is two writes in one transaction, in this order — retire the standing version, then file the replacement — because that index is checked as each statement finishes, so filing first collides with the version still standing. Only the owner or an admin may do either (migration 903). A consent already given keeps pointing at the retired row, which is the whole point: it records what that person was actually shown.

### `portal_invite`
One row per invitation to the client portal — the link the practice hands a household (`SPEC/client-portal.md` section 6.1). `client_id` (the contact's own client, carried directly so the audit trigger attributes the row to that record), `contact_id`, `user_id` (the account the link opens), `kind` (`first_sign_in` | `password_reset`), `locale`, `token_hash` (the sha256 of 32 random bytes; the token itself is never written down), `expires_at` (seven days), `used_at`, `revoked_at`.

Single use, revocable, and never deleted: a link is closed, not removed, so the record of who was let in and when survives. The owner and an admin alone read or write it — never a contact, not even one whose own invitation it is. Two security-definer functions do the rest: one answers a word about a link to somebody who is not signed in, the other spends it once under a row lock.

### `portal_request`
One row per ask a household makes of the practice (`SPEC/client-portal.md` section 6.2). `client_id`, `contact_id` (who asked), `kind` (`consent_withdrawal` | `erasure`), `consent_id` (required when the kind is a withdrawal, null otherwise, by check), `note` (200 characters, boundary-cleaned), `status` (`open` | `handled`), `handled_at`, `handled_by`.

Append-only but for those two handling columns, and no delete grant at all. Asking is not doing: the withdrawal or the erasure itself is carried out through the record's own screens, and this row is the request and the fact that it was handled.

---

## 4. Sessions and measurements

### `goal`
`client_id`, `category_id` (owner-editable reference table: focus, sleep, calm, performance, ...), `description` (free text beside the category), `set_at`, `status` (`active`, `achieved`, `dropped`), `is_primary`. What the client wants from the programme. Never a diagnosis: this is a wellness business, and VAT does not depend on it (billing.md section 5).

### `assessment`
Any measurement: qEEG brain map, CPT, questionnaire. Questionnaires are self-report measures, never diagnoses. `client_id`, `session_id`, `performed_at`, `performed_by_practitioner_id`, `instrument` (`qeeg`, `cpt`, `conners`, `vanderbilt`, `asrs`, `gad7`, `phq9`, `isi`, …), `instrument_version`, `derived jsonb` (scores), `version`, `supersedes_id`, and its files through `assessment_document`. Versioned so pre/post comparison is exact.

_Amended in trunk round 31, 2026-09-06._ Two columns of the original sketch have moved, and the sketch now says what the tables hold. **`session_id`** was added by migration 951: nullable, because a measurement may be typed up from an outside provider's export or filled in at home and name no visit of the practice's own, and bound to the assessment's own client by a composite key so it can never name another household's visit. **`raw_document_id` is gone**, replaced by the **`assessment_document`** link table (migration 501): one brain map produces several files — an eyes-open recording, an eyes-closed recording, the equipment's own report — and one column forced a choice and lost the rest. `docs/CHANGE-REQUESTS/assessment-01.md` asked for both and recorded them as differences not yet applied here; this is where they are applied.

### `protocol_template`
The practice's IP, authored by the lead practitioner. `service_type_id`, `name`, `goal_category`, `sites` (electrode placements), `reward_bands`, `inhibit_bands`, `thresholds`, `session_minutes`, `version`, `authored_by`, `status`.

### `client_protocol`
A template instantiated for one client. `client_id`, `template_id`, `version`, `supersedes_id`, `change_reason` (required when version > 1), `authored_by_practitioner_id` (must hold `can_author_protocol`), `effective_from`, `status`. Sessions pin a specific version.

### `session`
One delivery of one service to one client.
```
client_id, practitioner_id, service_type_id, client_protocol_id (version-pinned)
appointment_id                                   -- the slot it fulfils
delivery_mode       'home' | 'studio' | 'remote'
location_id
entitlement_id                                   -- the credit it consumes (FINANCE §1)
kit_id
status              'scheduled' | 'in_progress' | 'completed' | 'no_show' |
                    'cancelled_late' | 'cancelled' | 'aborted'
checked_in_at, checked_in_point, checked_out_at, checked_out_point
started_at, ended_at
pre_rating jsonb, post_rating jsonb              -- client subjective
telemetry jsonb                                  -- band amplitudes, thresholds, artefact %, per-minute
observations jsonb                               -- structured prompts + free text
signal_quality_score numeric                     -- feeds the ribbon
setup_photo_document_id                          -- requires active photo_video consent
closed_at, closed_by                             -- after which the record is immutable
version, supersedes_id, amendment_reason
```
"Session 12 of 30" is derived from history, never stored.

### `report`
A signed report. `client_id`, `kind` (`baseline`, `progress`, `completion`, `school`), `covers_from`, `covers_to`, `authored_by`, `reviewed_by`, `signed_by` (must hold `can_sign_report`), `signed_at`, `document_id` (the PDF), `locale`, `version`, `supersedes_id`, `amendment_reason`, `delivered_to_contact_ids`, `delivered_at`. Once signed, immutable. Corrections are a new version.

---

## 5. Operations

### `appointment`
A promise of a session at a time and place. `client_id`, `practitioner_id`, `service_type_id`, `location_id`, `delivery_mode`, `window_start`, `window_end` (45-minute arrival window), `planned_arrival`, `travel_buffer_minutes`, `status`, `cancellation_reason`, `cancelled_at`, `created_by`. A session is created from an appointment at check-in. Conflict detection: `practitioner × time`, `client × time`, session spacing rules, credential validity.

### `kit`
Serial-level equipment registry. `serial`, `model`, `kind` (`amplifier`, `laptop`, `electrode_set`), `status`, `assigned_practitioner_id`, `last_calibrated_at`, `calibration_due_at`. Session start blocks if calibration is overdue. Chain of custody, consumables and hygiene logs are Phase 2 tables hanging off this. **Created by piece eight** (migration 306, `SPEC/practitioner-phone.md` section 6): `kind` is the enum `kit_kind`, `status` is `active_status`, the two calibration columns are nullable timestamps because a laptop is never calibrated, `(tenant_id, serial)` is unique, and the table is `audited: no client`. Overdue means at least one active item assigned to the practitioner has `calibration_due_at` before now; no item assigned is no block. `session.kit_id` is set at check-in to the practitioner's one active amplifier when exactly one is assigned, and left null otherwise.

### `visit_actuals`
Per completed home session: `actual_drive_seconds`, `actual_walk_seconds`, `salik_cost_fils`, `parking_cost_fils`, `access_issues`. Feeds contribution margin and arrival intelligence. See NAVIGATION-SPEC §8.

### `drive_estimate`
Scheduling's cache of the drive between two places (`SPEC/scheduling-manual.md` section 7; created by piece eight, migration 204, `SPEC/practitioner-phone.md` section 5.2). `from_location_id`, `to_location_id`, `hour_bucket` (0 to 23 in the practice's time zone), `seconds`, `metres`, `source` (`traffic` from the routing seam's real implementation, `straight-line` from its fallback), `fetched_at`; unique per tenant on the first three; read back for thirty days. A row references two locations and names no person, so it is `audited: no client`. The day's picture is deliberately not a table: it shows several households' positions and has no single `client_id` to file under, so it lives in process memory until the day ends and on the device (section 5.3 of that spec).

---

## 6. Commercial

Summarised here; FINANCE-SPEC is authoritative.

- **`price`** — resolved per `(service_type_id, jurisdiction, recipient_type, valid_from)`, never constants in code. `unit_price_fils`, `vat_treatment` (computed snapshot, billing.md section 5); superseded the way every append-only entity in section 7 is, by `supersedes_id` and `amendment_reason`, so there is no `valid_to` column to keep in step.
- **`package`** — a sellable bundle. `code`, `name`, `price_fils`, `components` (service_type × qty), `expiry_months`, `status`.
- **`client_package`** — a purchase. `client_id`, `package_id`, `purchased_at`, `paid_by_contact_id`, `invoice_id`, `expires_at`, `status`.
- **`entitlement`** — the ledger; one row per credit. `client_id`, `service_type_id`, `source_type`, `source_id`, `allocated_value_fils`, `vat_treatment` (computed snapshot), `status`, `consumed_by_session_id`, `expires_at`. Completing a session flips exactly one entitlement to `consumed` and recognises its allocated value.
- **`invoice`, `invoice_line`, `payment`, `credit_note`, `journal_entry`** — FINANCE-SPEC §4–7. Issued invoices are immutable; corrections are credit notes.

---

## 7. Cross-cutting rules

**Append-only records.** `session` (once closed), `report` (once signed), `client_protocol`, `assessment`, `invoice` are never updated in place. Each carries `version`, `supersedes_id`, `amendment_reason`. The current version is the one with no successor. Full snapshots, not diffs.

**Consent gates execution.** Starting a session, sending a report to a contact, storing a photo — each checks a specific consent purpose at that moment.

**Credential gates authorship.** Writing a `protocol_template` or `client_protocol`, signing a `report`, being assigned an `appointment` — each checks a specific capability on `credential` and re-checks validity dates.

**Retention and erasure.** 5 years from the last activity, computed onto `document.retention_until` and the client record. On an erasure request, a server-side function running as the owner (the API role never deletes) anonymises the personal fields, replaces each location's coordinates with its emirate's centroid and clears its Makani, address and notes, deletes documents from storage, removes contacts and the portal account, and sets the client `erased`; invoices keep what tax law requires for their 5 years. The erasing transaction sets `app.erasure`, so the audit rows it writes keep field names and withhold values (see §9.3). An `erasure_request` row records who asked, when, what was erased, and the confirmation sent.

**Audit.** Every table in §3–§6 carries `client_id` directly or resolvably, so the audit trigger can denormalise it. See AUDIT-SPEC §3.

**Per-tenant default rows.** A stream whose table needs exactly one row per tenant the moment the tenant exists — a default rate, a default setting — inserts it with an after-insert trigger on `tenant`, defined in the stream's own migration (a security definer function with a pinned `search_path`, the discipline `app.audit_row` already uses), and backfills every tenant that predates that migration in the same migration, as a plain `insert ... select` at the end of the file, so a real practice already live and a freshly seeded database end up identical. Billing's `vat_setting` is the precedent: `app.default_vat_setting()` gives a newly inserted tenant its first VAT rate, and the migration's own data step gives the same rate to every tenant that already existed.

---

## 8. Relationship map

```
tenant ─┬─ location (studio)
        ├─ user ─┬─ user_role
        │        └─ practitioner ─┬─ credential ─── service_type
        │                         └─ location (home base)
        │
        ├─ client ─┬─ contact
        │          ├─ location (home, school…)
        │          ├─ consent
        │          ├─ document
        │          ├─ goal
        │          ├─ assessment (versioned)
        │          ├─ client_protocol (versioned) ─── protocol_template
        │          ├─ appointment ─── session (versioned) ─┬─ visit_actuals
        │          │                      │                └─ kit
        │          ├─ entitlement ◄───────┘ (consumed_by)
        │          ├─ client_package ─── package
        │          ├─ invoice ─── invoice_line / payment / credit_note
        │          └─ report (versioned) ─── document
        │
        ├─ price
        └─ audit_log  (every row above, denormalised client_id)
```

---

## 9. Owner decisions before the trunk schema is written

1. ✅ **Vehicles** — personal cars. Salik and mileage are reimbursed expenses per practitioner, recorded on `visit_actuals`.
2. ✅ **Appointment window** — 45 minutes. Client-facing copy promises the window, never a clock time.
3. ✅ **Erasure vs. retention** (re-baselined 2026-09-02) — retention is 5 years after the last activity. A client may request erasure at any time: a server-side function running as the owner anonymises the personal fields (locations keep only their emirate's centroid), deletes documents from storage, removes contacts and the portal account; invoices keep what tax law requires for 5 years; the client row stays as `client.status = 'erased'`, visible only to `lead_practitioner`, excluded from every list and search, so ledgers and audit history reconcile; audit rows keep their own 5 years. Client receives written confirmation. Lawyer to confirm wording.
4. ✅ **Phase 1 questionnaires** — all seven: Conners, Vanderbilt, ASRS, GAD-7, PHQ-9, ISI, PSQI. Each is a form + scoring function in `domain/assessment`.
5. ✅ **Setup photo** — yes. `photo_video` consent is captured at enrolment; `session.setup_photo_document_id` added.

---

## 10. Deliberately excluded from Phase 1

Route legs and tariff calendars (Phase 2 solver), kit chain-of-custody, consumables, hygiene logs, insurance/payer, pre-authorisation, corporate accounts, home-practice content. All have a clear place to attach; none block the first 20 sessions.

---

## 11. Implementation decisions (PR 2, 2026-09-02)

Recorded here so no later reader mistakes them for the spec's intent.

- **Physical names.** The `user` entity is the table `app_user`, because `user` is reserved in SQL. Nothing else is renamed.
- **Exemptions from the section 1 conventions.** `tenant` carries no `tenant_id` (it is the tenant). `audit_log` keeps a bigint id assigned by the hash chain, uses `occurred_at` as its creation time, and has no `updated_at`, `created_by` or foreign keys (append-only, and a log row outlives what it describes); its `tenant_id` is not null, and for the `tenant` table itself the audit row carries the tenant's own id. Every section 2 and 3 table, `tenant` included, has the audit trigger. `app.audit_chain` and `schema_migration` are bookkeeping tables. See `.claude/rules/data-model.md`.
- **Values the model left open.** `practitioner.status` and `service_type.status` use the enum `active_status (active, inactive)`. `client.sex_at_birth` is the enum `(female, male, unknown)`. `document.kind`, `credential.certification`, `credential.certifying_body` and `practitioner.vehicle` are open sets and stay `text`.
- **Checks.** `location.makani_number` is ten digits and Dubai only; `app_user.phone` and `contact.phone` are E.164; `service_type.delivery_modes` is a non-empty `delivery_mode[]`; `credential.valid_to` is after `valid_from` when present (null means it does not expire); `contact.emirates_id_hash` is 32 bytes and travels with `emirates_id_encrypted`, unique per tenant.
- **Circular references** are added after the referenced table exists: `tenant.location_id`, `practitioner.home_base_location_id`, `client.primary_contact_id`, `credential.evidence_document_id`. All nullable.
- **Extensions** (`pgcrypto`, `postgis`) live in the `extensions` schema, as on Supabase; helper functions live in schema `app`; the public schema holds only tables.
- **Row level security** is enabled on every table and every policy is written `to app_role`, the API role that stands in until PR 3 chooses the API identity. `app.current_tenant_id()` reads the `app.tenant_id` setting the middleware will stamp per request; unset, every tenant-scoped row is invisible.
- **Re-baselined 2026-09-02 as a wellness business.** Removed: `tenant.dha_facility_licence_no`, `practitioner.dha_professional_licence_no`, `client.nabidh_opt_out`, `service_type.is_clinical`, and the `jurisdiction`, `licence_type` and `licence_number` columns of `credential` (now `certification`, `certifying_body`, `certificate_number`). Renamed values: `role_kind.clinical_lead` to `lead_practitioner`; `location_label.clinic` and `delivery_mode.clinic` to `studio`; `client_status.discharged` and `locked` to `closed` and `erased`; `consent_purpose.treatment` and `minor_treatment` to `participation` and `minor_participation`, with `data_sharing_hie` removed. `document.retention_until` is 5 years from the last activity.
- **After the compliance review of 2026-09-02:** `client.nationality` and `client.emirates_id_expiry` are dropped (no stated need); the Emirates ID columns and `sex_at_birth` carry their need in the schema comments; `document.client_id` is nullable so a practitioner's certificate can be filed without a client; `audit_redact` withholds every value when the transaction sets `app.erasure`; no image of an identity document is ever stored.
- **Emirates ID lives on `contact`, not `client`** (compliance re-review, 2026-09-02): the stated need is to verify the adult who consents for a minor or who is refunded, and that adult is a contact (`relationship = 'self'` for an adult client). The audit trigger's erasure mode is honoured only when no role has been assumed, so the API role cannot use it to hide a write.
- **PR 3 (2026-09-02): who is calling.** The API connects as `mcwellness_api` (login, no inheritance, no RLS bypass, member of `app_role`) and runs `set local role app_role` per transaction. `app.resolve_actor(uuid)` returns the active user matching a verified auth id with roles and every credential's capabilities and dates; validity on a date is judged once, in `domain/shared/actor.ts`. `app.actor_has_role(text)` reads `app.actor_roles`; restrictive policies on `app_user`, `user_role` and `credential` require `owner` or `admin` for inserts and updates, so nobody can grant themselves a role or move an identity link; on `user_role`, a row with `role = 'owner'` may be inserted, edited or edited into only by the owner, so an admin can neither promote themselves nor take the owner's row (`owner_grants_owner`, `owner_keeps_owner`; the same rule sits in `canActor`), and the `app_user` row that holds ownership may be updated only by the owner (`owner_keeps_identity`), so the identity link cannot be moved onto an admin and the owner cannot be suspended by one.
- **PR 4 (2026-09-02): the synthetic practice and the identity key.** `contact.emirates_id_encrypted` holds `nonce || tag || ciphertext` from AES-256-GCM and `emirates_id_hash` an HMAC-SHA256, both under keys derived (HKDF) from one 32-byte master in `IDENTITY_KEY`; the arithmetic lives in `domain/shared/identity.ts`, the key is read once by `identityKeysFromEnv`, and the local placeholder is refused outside development. `db/seed/generate.ts` is the only source of synthetic people: fixed ids `0000000K-0000-4000-8000-*`, phones `+971 50 000 1xxx`, emails at `example.com`, Emirates IDs `784-1900-*` only on a guardian who has consented (never on a lead's), each seal bound to its contact row, names from `db/seed/names.ts`. The seed writes under the audit reason `synthetic seed`, the tenant and owner as the system and every other row as the owner with the owner's roles stamped, and refuses a non-local database unless `APP_ENV=staging`, and production always. PR 11 (2026-09-02) renders the same seed as SQL (`pnpm seed:sql`): the script opens its own transaction, refuses a database that already holds a tenant, stops when its transaction-local audit context is missing, and carries no other target guard; `applySeed` itself now refuses any data outside the reserved synthetic ranges, whichever way it arrives.
- **Shared zone, round 1 (2026-09-02):** four actions join the actor rules for the streams (`appointment.list` with a practice or own scope, `appointment.create` carrying the assignee, service and date and requiring the assignee's valid credential, `billing.price.read`, `billing.price.write`); the service catalogue's writes are floored to the owner and an admin in row-level security like users and credentials; migration 097 makes the audit trail's client attribution general (audit.md section 14, note 5); database tests live under `tests/<stream>/db/`.
- **PR 5 (2026-09-02): the shell and the first screen.** `GET /api/clients` checks `client.list` in `canActor` (owner, admin, lead practitioner, finance list the practice; a practitioner without those roles is scoped to their schedule, which does not exist yet, so the route answers an empty list with `note: 'schedule'`; a client contact is refused), runs under RLS as the caller, and writes one audit row per listed client in one statement (`logReads`), with the action `list` (a record seen in a list) as distinct from `read` (a record opened): every access is logged, and the two are told apart. The browser holds a Supabase session when `VITE_SUPABASE_URL` is set; on a laptop the API opens `POST /api/dev/session` only when `APP_ENV=development`, the database is local and the local secret exists, and mints a one-hour token for a seeded auth id. Design tokens live in `app/shell/tokens.css`; lint refuses hex literals and the brief's tells in app code.
- **PR 6 (2026-09-02): the record timeline.** `GET /api/clients/:id/timeline` checks `audit.read` (owner, admin, lead practitioner), reads `audit_log` by `client_id` under RLS as the caller, pages backwards by audit id, and composes each row into one sentence on the server through the bilingual catalogue in `domain/shared/audit-narrative.ts` (keyed by entity type and action, per-field phrasing for updates, contact phone and email never repeated, redacted or long values unsaid, timestamp-only updates dropped as noise). The browser receives sentences, times, kinds and reasons, never a raw row. Viewing a timeline writes a `read` row for the client. The drawer and the timeline component are seeded by the trunk and owned by the client-record and audit-ui worktrees.
- **Billing PR 16 (2026-09-02): the VAT setting and the price table.** `vat_setting` — versioned, tenant-scoped, not named in section 6 before this — carries `rate_basis_points` and `effective_from`, defaults every tenant to 500 basis points from 2018-01-01 the moment it exists (`app.default_vat_setting()`, an after-insert trigger on `tenant` — the shape section 7's per-tenant default row convention generalises), and backfills the same rate for every tenant that predates the migration. `price` resolves per `(service_type_id, jurisdiction, recipient_type, valid_from)` and supersedes by `supersedes_id` and `amendment_reason` rather than a `valid_to` column, snapshotting its VAT rate and the `vat_setting` version in force at its own `valid_from` so a later rate change never moves an old price's VAT. Both tables are append-only, audited, and readable and insertable only by `app_role` — no update, no delete, by construction.
- **Shared zone, round 3 (2026-09-02, amended the same day):** `098_erasure_guard.sql` replaces the erasure guard's role check — which could never hold once `app.erase_client` (client-record.md section 8) calls it under `app_role` — first with a secret stamped into `app.erasure`, then, after a security review on PR 19 found that value readable back with `current_setting` by anything running under `app_role` in the same transaction and so replayable, with `app.erasure_active`: one row per erasing transaction keyed by `txid_current()` (no grant to `app_role` or `public`), inserted by `app.begin_erasure()` and removed by `app.end_erasure()`, both security definer and granted to nobody, so `app.audit_redact`'s erasure branch withholds only while a row for the current transaction exists — nothing is ever stamped into a setting, so there is nothing to read back or replay, and a forged `app.erasure` does nothing at all. `checked_in_point` joins the columns `app.audit_redact` drops outright, and the execute grant to `public` it never needed — 080 forgot to revoke it — is gone too. Two schema tests that once asserted an exact table list now assert containment instead, a new schema-wide test requires the audit trigger on every public table bar the bookkeeping ones, and a stream's own audited table declares itself with a `comment on table` (`'audited: client'` or `'audited: no client'`) in its own migration rather than editing the trunk's lists (.claude/rules/data-model.md). The audit narrative catalogue gains bilingual sentences for a goal, an erasure request, and a refused read, with the generic fallback proven still to hold for anything unmapped. `createApi` gains an `identityKeys` option and a small middleware publishing it onto the request context, mounted after the request-context fence rather than before, so no route ahead of authentication can ever read `c.get('identityKeys')`.
- **Shared zone, round 4 (2026-09-02):** `099_tenant_scoped_keys.sql` gives every core table carrying `tenant_id` (every section 2 and 3 table except `tenant` itself, which is not tenant-scoped of itself) a `unique (tenant_id, id)` key, so a stream's foreign key to a core table is written `(tenant_id, <core>_id) references <core> (tenant_id, id)` from here on and a cross-tenant reference is refused at the database rather than merely hidden by row-level security; 099 is also the core range's last free number, so `docs/SPEC/OWNERSHIP.md` gives the trunk 900–999 to continue its own migrations in. The per-tenant default row convention above (§7) is recorded from this round, generalising billing's `vat_setting` precedent for any stream that needs one; `session-capture.md` section 7 gains one sentence on the check-in point's purpose, that it is declinable, who may read it, its retention, and that it is dropped from the audit trail unconditionally rather than merely under erasure.
- **PR 17 (2026-09-02): the visit record and its event log.** `session` and `session_event` (migration `300_session.sql`, `docs/SPEC/session-capture.md` sections 2 and 6) hold the practitioner's own visit and the append-only, seq-numbered device events it is projected from; both ids are client-generated, not `gen_random_uuid()`, so the device's own outbox key is what an idempotent retry of `POST /api/sessions/:id/events` recognises. One open visit per practitioner at a time is a partial unique index (`session_one_open_per_practitioner`) rather than only an application check, and `session_event`'s composite foreign key binds every event to its session's own tenant, client and practitioner, not merely to a session id a caller happens to know. `domain/session/canCheckIn.ts` is the check-in rule the route enforces before a row is written: the acting practitioner needs a role and a credential valid for that service on that day (`session.execute`), the client needs an active `participation` consent (`minor_participation` too when age or an unknown date of birth makes the client a minor by default — a missing date of birth fails closed rather than assuming an adult), and a home delivery needs `home_visit` consent as well. Every refusal the route can produce — wrong role, no practitioner row, someone else's session, an unverified client or service type, the gate itself, or a genuine second open visit — is written to `audit_log` before the response goes out (session-capture.md section 8), not only the gate's own reasons, so a blocked check-in is never silent. `checked_in_point` is the coordinate recorded at check-in when the practitioner allows it — a decline is not a block (section 7's graceful degradation) — and its reach, retention and unconditional exclusion from the audit trail are set out in round 3 and round 4 above.
- **PR 18 (2026-09-02): the appointment and its two exclusion constraints.** `appointment` (migration `200_appointment.sql`, `docs/SPEC/scheduling-manual.md`) is a promise of a session at a time and a place: a check constraint requires `window_end` to equal `window_start` plus exactly 45 minutes (`appointment_window_45min`), and a trigger keeps `busy_end` — `window_end` plus a travel buffer of 15 to 90 minutes, applied only after the visit, never before — in step, because plain `timestamptz + interval` arithmetic is not immutable and so cannot sit inside a GiST index expression directly. Two exclusion constraints, `appointment_no_overlap_practitioner` and `appointment_no_overlap_client`, stop a practitioner or a client being double-booked even outside the API — a half-open `[window_start, busy_end)` range against every other appointment not already `cancelled`, `cancelled_late`, `no_show` or `rescheduled` — matching `domain/scheduling/conflicts.ts`'s `checkConflicts` exactly, so a concurrent write that slips past that read-then-check still fails at the database rather than double-booking silently. `POST /api/appointments` (scheduling-manual.md section 6.1) treats a missing or invalid credential and a missing consent as blocking, not merely advisory: the assignee needs a credential for that service, valid on the appointment's own date, checked both in `canActor`'s `appointment.create` action and again in `checkConflicts`; the client needs an active `participation` consent (`minor_participation` too when a null or under-18 date of birth makes the client a minor by default) and `home_visit` consent for a home delivery, computed by the route's own `requiredConsentPurposes` — booking policy, not a scheduling conflict rule, so it stays with the route rather than moving into `domain/scheduling`.
- **PR 21 (2026-09-02): the client record's tables, access rules and routes.** Migration 100 adds `goal_category`, `goal`, `erasure_request` and the security-definer `app.erase_client`, with row-level policies in `db/policies/client/readers.sql` scoping reads by role (finance: names and contacts only) and a client contact to their own household; `app/api/clients` routes are built (`mountClientRecord`) but not yet wired into `create-api.ts`.
- **PR 23 (2026-09-02): the check-in route reads its context through a tenant-bound helper.** Migration 301's `app.checkin_context` hands `domain/session/canCheckIn.ts` only what it consumes — date-of-birth presence, minority as of today, the three consent purposes it reads — so check-in keeps working once client-record's (PR 21) restrictive policies would otherwise blind its old direct reads of `client` and `consent`; it merges first for exactly that reason.
- **PR 24 (2026-09-02): the practitioner check-in screen.** `app/therapist/session/CheckInPage.tsx` adds the door-side flow — record number, service, delivery mode, an off-by-default location switch — generating its session and opening-event ids once so a repeated tap can never open two visits; the six shipped block reasons, a 403 and a 409 each render as their own plain sentence.
- **PR 25 (2026-09-02): the price list screen.** `app/admin/billing/BillingPage.tsx` and `PriceDrawer.tsx` list every service's current price with VAT and gate the Add-price panel to owner, admin and finance by `canActor`, parsing a typed AED amount as separate whole-and-fraction integers so no price drifts; both files import `domain/shared/actor.ts` directly rather than the barrel, because the barrel's `identity.ts` re-export was already breaking a browser bundle — the landmine this round's Change 1 removes at the root.
- **PR 26 (2026-09-02): the day schedule screen.** `app/admin/schedule/SchedulePage.tsx` lists a day's appointments and `NewAppointmentDrawer.tsx` books one — client search, service, location, a qualified practitioner, a start time previewing the 45-minute arrival window — rendering each booking conflict in the server's own plain language. It independently hit the same `domain/shared` barrel landmine PR 25 found and worked around it the same way, pending this round's fix.
- **Shared zone, round 6 (2026-09-02):** round 6's own security review found the first fix (removing `identity.ts` from the `domain/shared` barrel) incomplete: `domain/client/index.ts` still re-exported `validateEmiratesId`, which value-imported `domain/shared/identity` for two pure string helpers — `normaliseEmiratesId` and `formatEmiratesId` — it never needed the `node:crypto` half for, so any screen reaching that barrel still pulled the same landmine in transitively. The rule as it now stands: every domain barrel is browser-safe, `domain/shared/identity.ts` is server-only and is imported by its own path and never through any barrel, and `tests/lint/no-node-imports-in-browser-bundle.test.ts` proves it by walking the real import graph — failing closed on any specifier it cannot resolve, mapping a `.js`-suffixed specifier onto the `.ts` source Vite's bundler resolution actually loads, reading its aliases from tsconfig.json's own `paths` rather than a hand-copied list, and starting from the browser entry point and from every stream's own barrel (`domain/client`, `domain/billing`, `domain/scheduling`, `domain/session`, `domain/shared`) in turn — rather than trusting a comment. The two pure helpers move to a new `domain/shared/emirates-id.ts`, re-exported by the shared barrel like everything else browser-safe; `identity.ts` keeps only the crypto and imports them back for its own use; `domain/client/validateEmiratesId.ts` moves to the same new path, unchanged in every other respect.
- **Shared zone, round 7a (2026-09-02):** `PageHeader` (`app/shell/components/Controls.tsx`) gains an optional `action` slot rendered at the header row's end, vertically centred and pushed to the inline end by `.page__action`'s `margin-inline-start: auto` and `align-self: center` (`app/shell/shell.css`), so a screen's one primary action sits without a page-local override and the existing aside text keeps its place; `Field` and `Select` gain an optional `error` string that replaces the hint in its own slot while it stands, in the critical token colour (`.field__hint--error`), with the control carrying `aria-invalid` and `aria-describedby` pointing at the message's id, and the hint returns once the error clears.
- **Shared zone, round 7b (2026-09-02):** `app/shell/App.tsx` mounts `/today/check-in` inside the same `RequireAuth` guard `/today` already uses, rendering `CheckInPage` only for the practitioner and lead-practitioner faces (`hasRole`) — an admin-only account is sent to its own desk by `homeFor` instead of reaching the screen — and `TodayLanding.tsx` gains the one primary action that links to it, sized to the practitioner app's 48px tap floor. `docs/CHANGE-REQUESTS/session-capture-02.md` item 1 is applied; items 2 and 3 were already closed by PR 23.
- **Shared zone, round 7b part 2 (2026-09-03):** `app/shell/App.tsx` routes `/admin/billing` to `BillingPage` and `/admin/schedule` to `SchedulePage`, each nested inside its own `RequireAuth` beside `clients` and gated by `app/shell/adminAccess.ts`'s `canOpenBilling`/`canOpenSchedule` — thin wrappers over `canActor` (`billing.price.read` for billing, `appointment.list`'s practice scope for schedule) rather than a role list restated in the shell — so a bare `practitioner` account is sent home by `homeFor` instead of reaching either screen, the same shape round 7b gave `/today/check-in`; finance reads billing but not schedule. `app/shell/AdminLayout.tsx` filters `Rail`'s `ADMIN_SECTIONS` through the same two functions before rendering, so the rail never offers a link its own route would bounce the actor straight back out of, and `app/shell/components/Rail.tsx`'s `billing` and `schedule` entries gain their `to` destinations, so neither renders as "Arriving" any longer. `docs/CHANGE-REQUESTS/billing-02.md` and `scheduling-02.md` are applied. A security review of this round found the route gates restating role lists that could drift from `canActor` and the rail not filtering by role at all (a finance account could see a Schedule link its own route would refuse); both are fixed here.
- **Shared zone, round 14 (2026-09-03): the storage seam, session settings on a service, and the consent wording as documents.** Bytes behind `document.storage_key` are reached only through `domain/shared/storage.ts` (docs/SEAMS.md): four calls, a private Supabase bucket `documents` in production and staging under a service credential, a git-ignored folder on a laptop and in the tests, chosen by `STORAGE_PROVIDER` and refused to start without an explicit choice outside development; a key is `tenant/<t>/client/<c>/<d>` or `tenant/<t>/practice/<d>`, ids only, and an unreachable store answers 503 `storage_unavailable` rather than an internal error. Migration 901 puts `service_type.preflight_checklist` and `rating_questions` (jsonb arrays, empty by default, array-shaped by constraint and item-shaped at the edge in `domain/session`) where session-capture.md sections 3.2, 3.5 and 6 asked for them. Migration 902 lets a document say which consent wording it is — `purpose`, `locale`, `version`, `status` for kind `consent_text`, unique on `(tenant_id, purpose, locale, version)`, the columns barred from every other kind and all-or-nothing within a row — and the seed now reads the eight real texts from `docs/CONSENT`, files each as a practice document with its own version, status and hash, writes the bytes through the seam, and points every seeded consent at the wording in the language that household reads. The stricter constraint requiring every `consent_text` row to carry all four is deferred until two scheduling fixtures carry them (docs/CHANGE-REQUESTS/trunk-notes.md). Migration 903 puts a write floor under `document`, which had none: only the owner or an admin files consent wording or writes the columns that say which wording a row is, an immutable row is neither changed nor deleted outside an erasure, retirement is the single change it admits, and `is_immutable` never goes back to false — a guard trigger in the pattern of `app.guard_location_notes()`, since row security asks which rows and this asks who is acting. Migration 904 closes two holes in `app.audit_redact` found reviewing the session-capture stream: `checked_out_point` joins the keys dropped outright, and both the dropping and the 200-character truncation now reach inside a jsonb object value at any depth, so a coordinate or a thousand characters of free text inside `session_event.payload` is treated exactly as the same thing in a plain column (audit.md section 8; arrays are deliberately not descended into).
- **Shared zone, round 15 (2026-09-03):** eight billing actions join the actor rules (`docs/CHANGE-REQUESTS/billing-03.md` section 1), so a route names the permission it is exercising rather than one that happens to have the right audience: `billing.package.read`, `billing.invoice.read` and `billing.refund.read` take the price list's four office readers (owner, admin, lead practitioner, finance) — a refund quote is arithmetic over rows `ledger_readers` already opens to a lead practitioner, so a stricter route would be a courtesy pretending to be a boundary; `billing.package.write`, `billing.sale.write`, `billing.payment.write` and `billing.waiver.write` take the three that record money (owner, admin, finance), one audience under four names so that separating them later is a change to one line rather than to a route; and `billing.balance.read` alone reaches past the office, admitting a practitioner — the stop card at the door says "Session 3 of 15" and what is owed — and a client contact for a client in `ctx.clientIds`, exactly as `client.read` already treats one. How far a practitioner reaches is `app.client_visible_to_practitioner`'s to decide (ninety days back, thirty forward, confirmed visits only), not this file's: the action says only that the role may ask. Every floor matches `db/policies/billing/ledger.sql` and none is wider than it. The synthetic seed gains the practice's own figures (section 2 of the same request): a price row per charged service — a neurofeedback session at AED 700 net, a brain map at AED 825 net, and a zero price on the discovery call, the consultation and the results call, which are included in something else and never billed, so a delivered one is not sent to `billing_exception` as unpriced — with Compassionate Inquiry deliberately left unpriced, and the three programmes (Silver, Gold, Platinum) with their components, their list price and a launch price row carrying its own reason. `seedId` accepts a two-character kind (`d0`–`d3` for the billing catalogue), the reserved-range guard in `assertSynthetic` widens by the same character and now covers the new rows, and every seeded price stamps the VAT rate and setting version from the `vat_setting` row the tenant trigger wrote, proved against that row in `tests/db/seed.test.ts` rather than merely typed.
- **Shared zone, round 20 (2026-09-03): the practice's own identity, and work that runs after a commit.** Three things the next stream pieces need. **One.** `app/api/_middleware/request-context.ts` publishes `c.get('afterCommit')(fn)`: work a route hands back, run once `commit` has returned, in registration order, and never at all on a rollback — so never on a 5xx and never on a refusal a route raised rather than returned. A piece that throws is logged with the request id and the shape of the failure, never its message, and neither the response nor the pieces around it notice. `docs/SEAMS.md` records it as the only correct way to delete bytes from the document store after a database change (docs/CHANGE-REQUESTS/client-record-03.md, CR-12): a delete cannot be rolled back and a transaction can. **Two.** Migration 905 gives `tenant` its Arabic legal name, its trade licence (`licence_number`, `licensing_authority`, `licence_expires_on` — a trade licence, not a health-authority one, per the re-baselining above) and its VAT registration as a pair that travels together: `vat_registered`, false by default, and `vat_trn`, fifteen digits by check constraint and required by a second constraint while the switch is on. `trn` is renamed by nothing and its column comment now says what it is — the corporate-tax registration the practice holds today, which must never be printed as a VAT number. `invoice` gains `supplier_legal_name_ar`, `supplier_licence_number`, `supplier_licensing_authority`, `supplier_vat_registered` and `supplier_vat_trn`, nullable with no default so an invoice issued before this migration says nothing rather than claiming false, and `app.stamp_invoice_supplier` fills them at numbering time beside the three it already stamped. `app.guard_tenant_identity`, a trigger in the pattern of `app.guard_location_notes` and migration 903, floors every one of those columns to an owner or an admin in the database and stands aside when no role is stamped — and the same trigger covers `location` rows whose `owner_type` is `tenant`, because `db/policies/client/writers.sql` admits a lead practitioner to every location and the practice's own address is the one an invoice is stamped from. Two check constraints hold what the invoice columns may say together (a supplier VAT number is fifteen digits, and exists only where `supplier_vat_registered` is true), and `app.stamp_invoice_supplier` enforces both again inside the trigger, so a caller that supplies its own snapshot is held to the same rule as a stamped one. **What none of this does is charge anything**: every price still stamps the standard rate and `app.charge_single_visit` still writes VAT on every sale, so these columns record the registration and nothing more. The migration, the column comments and the settings screen all say exactly that, and `docs/CHANGE-REQUESTS/trunk-notes.md` (round 20) carries the three requests that close it — VAT charged only when the practice is registered, the `vat_fils = 0` constraint that then becomes addable, and a renderer that reads the invoice's own snapshot and never the tenant. **Three.** `practice.settings.write` joins the actor rules (owner and admin), `app/shell/adminAccess.ts` gains `canOpenSettings`, the rail gains a Settings entry hidden from everyone else, and `/admin/settings/practice` (`app/admin/settings/**`, trunk-owned) reads the practice back and edits it through a drawer that asks why — saved by `GET`/`PATCH /api/practice` (`app/api/practice/**`), where the whole form travels at once so the VAT switch and its number can never be recorded by halves, and a save with no `X-Reason` is refused before a row moves. The registered address is the tenant's own `location` row: created or updated in place, with a coordinate optional on an address already on record and required to record the first one, because `location.entrance_point` is not null. `app/shell/components/useDrawer.ts` is the shell's copy of billing's drawer-focus hook, moved as `billing-03.md` asked the moment a second screen needed it; billing's own copy stays until that worktree adopts it. The seed gains synthetic values for every new field, stays unregistered for VAT because the real practice is, and — from this round — points `tenant.location_id` at the studio it had always created but never named, so a seeded invoice no longer carries a blank supplier address.
- **Piece eight's spec (2026-09-05, `SPEC/practitioner-phone.md`):** `kit` is created at last (migration 306) with the rule at check-in and `session.kit_id` set from it; `drive_estimate` joins section 5 as scheduling's cache behind the routing seam (`docs/SEAMS.md`), with `scheduling_setting.drive_road_factor` and `drive_peak_multiplier` as the fallback's figures; the setup photograph's bytes get their door and are filed under the seam's own client key, and the closed-visit guard of migration 302 admits exactly the one link `app.file_setup_photo` writes, from null to a value, because an offline day's bytes arrive after its close.
