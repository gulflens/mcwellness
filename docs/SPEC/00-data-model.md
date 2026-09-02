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
The practice. One row. Legal name, TRN (VAT), default emirate, timezone, studio `location_id`.

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
version        int                        -- of the consent wording
text_document_id                          -- the exact wording shown
status         'active' | 'withdrawn' | 'expired' | 'superseded'
given_at, withdrawn_at, expires_at
method         'app_signature' | 'paper_scan' | 'verbal_witnessed'
signature_document_id
```
Every session start checks the relevant active consent at that moment. No active `participation` consent → session cannot start.

### `document`
Anything filed against a client, or a practice document such as a practitioner's certificate (`client_id` null): referral letters, signed consents, reports, setup photos, certificates. Never an image of an identity document. `client_id`, `kind`, `storage_key` (Supabase Storage, versioned bucket), `mime_type`, `sha256`, `uploaded_by`, `retention_until` (computed: 5 years from the client's last activity, or from upload for a practice document), `is_immutable`.

---

## 4. Sessions and measurements

### `goal`
`client_id`, `category_id` (owner-editable reference table: focus, sleep, calm, performance, ...), `description` (free text beside the category), `set_at`, `status` (`active`, `achieved`, `dropped`), `is_primary`. What the client wants from the programme. Never a diagnosis: this is a wellness business, and VAT does not depend on it (billing.md section 5).

### `assessment`
Any measurement: qEEG brain map, CPT, questionnaire. Questionnaires are self-report measures, never diagnoses. `client_id`, `performed_at`, `performed_by_practitioner_id`, `instrument` (`qeeg`, `cpt`, `conners`, `vanderbilt`, `asrs`, `gad7`, `phq9`, `isi`, …), `instrument_version`, `raw_document_id`, `derived jsonb` (scores), `version`, `supersedes_id`. Versioned so pre/post comparison is exact.

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
Serial-level equipment registry. `serial`, `model`, `kind` (`amplifier`, `laptop`, `electrode_set`), `status`, `assigned_practitioner_id`, `last_calibrated_at`, `calibration_due_at`. Session start blocks if calibration is overdue. Chain of custody, consumables and hygiene logs are Phase 2 tables hanging off this.

### `visit_actuals`
Per completed home session: `actual_drive_seconds`, `actual_walk_seconds`, `salik_cost_fils`, `parking_cost_fils`, `access_issues`. Feeds contribution margin and arrival intelligence. See NAVIGATION-SPEC §8.

---

## 6. Commercial

Summarised here; FINANCE-SPEC is authoritative.

- **`price`** — resolved per `(service_type_id, jurisdiction, recipient_type)`, never constants in code. `unit_price_fils`, `vat_treatment` (computed snapshot, billing.md section 5), `valid_from`, `valid_to`.
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
5. ✅ **Setup photo** — yes. `photo_video` consent is captured at intake; `session.setup_photo_document_id` added.

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
- **PR 3 (2026-09-02): who is calling.** The API connects as `mcwellness_api` (login, no inheritance, no RLS bypass, member of `app_role`) and runs `set local role app_role` per transaction. `app.resolve_actor(uuid)` returns the active user matching a verified auth id with roles and every credential's capabilities and dates; validity on a date is judged once, in `domain/shared/actor.ts`. `app.actor_has_role(text)` reads `app.actor_roles`; restrictive policies on `app_user`, `user_role` and `credential` require `owner` or `admin` for inserts and updates, so nobody can grant themselves a role or move an identity link.
