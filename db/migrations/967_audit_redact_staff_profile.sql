-- 967_audit_redact_staff_profile.sql
-- Needs: 922 (staff_profile, whose columns these are), 965 (app.audit_redact,
--        the version this restates)
--
-- Five more keys on the list app.audit_redact drops outright: every column
-- staff_profile holds that is not bookkeeping — job_title, started_on,
-- emergency_contact_name, emergency_contact_phone and private_notes
-- (docs/superpowers/specs/2026-09-21-team-profiles-and-access-design.md
-- section 6). An emergency contact is a third person's name and number, and
-- the private notes are the owners' own words about a colleague — the row
-- itself is read by owners alone (db/policies/core/staff_profile.sql), but
-- `app.audit_row` writes `to_jsonb(row)` into `audit_log.new_values` on
-- every insert and update, and the trail is append-only, kept five years,
-- and reached by no erasure. Without this migration either value would sit
-- in the log for the log's whole life however the row itself is later
-- edited or the person leaves.
--
-- **Why the job title and the start date are on the list too**, which the
-- round's security review settled. The row rule says the owners and
-- nobody else, and it means it; but `audit_log` admits an owner, an admin and
-- the lead practitioner (db/policies/core/audit_log.sql), and
-- `app/api/audit/activity.ts` answers the old and the new values for every
-- entity type it is asked about. Left off this list, a job title and a start
-- date would reach an admin and a lead practitioner through
-- `GET /api/audit/activity?entityType=staff_profile` — which contradicts the
-- promise the table was created to keep. What the trail still says is that
-- those columns changed, through `changed_fields`, which `app.audit_row`
-- computes from the raw rows before this function is called.
--
-- **The keys are dropped by name, on every table.** No other table has a
-- column by any of these names (checked against every migration on
-- 2026-09-22), so nothing else loses a value here. `job_title` and
-- `started_on` are generic enough to be worth saying twice: whoever adds a
-- column by either name elsewhere should know it will not reach the trail.
--
-- **Why 967 and not the trunk's next free number after 921 (924).** 965
-- restates `app.audit_redact` in full — `create or replace` resets every
-- attribute, so a migration that adds to this function must restate the
-- whole of it, never patch it — and the runner applies pending files in
-- numeric order. On a fresh database a migration numbered below 965 would
-- run first and then be silently overwritten by 965's own restatement, and
-- the three columns here would go straight back to being legible in the
-- trail. This file sorts after 965 so its restatement is the one left
-- standing.
--
-- 965's body, verbatim and whole, with the five keys added to the end of
-- the dropped list. Restated in full for the reason 965 itself gives:
-- `create or replace` resets every attribute — language, volatility,
-- strictness, search_path — and the revoke alike.

create or replace function app.audit_redact(p_row jsonb) returns jsonb
language sql stable strict
set search_path = pg_catalog, pg_temp
as $$
  select case when exists (select 1 from app.erasure_active where txid = txid_current())
    then (select coalesce(jsonb_object_agg(e.key, to_jsonb('[withheld: erasure]'::text)), '{}'::jsonb) from jsonb_each(p_row) as e)
    else coalesce(
    (select jsonb_object_agg(e.key, app.audit_redact_value(e.value))
       from jsonb_each(p_row - array['emirates_id_encrypted', 'emirates_id_hash',
                                     'checked_in_point', 'checked_out_point',
                                     'entrance_point', 'parking_point', 'community_gate',
                                     'requested_by_phone',
                                     'seizures', 'seizures_note',
                                     'implanted_device', 'implanted_device_note',
                                     'head_injury', 'head_injury_note',
                                     'pregnancy', 'pregnancy_note',
                                     'medication', 'medication_note',
                                     'scalp', 'scalp_note',
                                     'job_title', 'started_on',
                                     'emergency_contact_name', 'emergency_contact_phone',
                                     'private_notes']) as e),
    '{}'::jsonb)
  end
$$;
revoke execute on function app.audit_redact(jsonb) from public;

-- rollback:
--   -- 965_audit_redact_health_answers.sql's body, verbatim. Rows already
--   -- written keep the values they were written with either way: this
--   -- replaces a function, not a row, and no answer comes back into a row
--   -- the redaction has already passed over.
--   create or replace function app.audit_redact(p_row jsonb) returns jsonb
--   language sql stable strict
--   set search_path = pg_catalog, pg_temp
--   as $$
--     select case when exists (select 1 from app.erasure_active where txid = txid_current())
--       then (select coalesce(jsonb_object_agg(e.key, to_jsonb('[withheld: erasure]'::text)), '{}'::jsonb) from jsonb_each(p_row) as e)
--       else coalesce(
--       (select jsonb_object_agg(e.key, app.audit_redact_value(e.value))
--          from jsonb_each(p_row - array['emirates_id_encrypted', 'emirates_id_hash',
--                                        'checked_in_point', 'checked_out_point',
--                                        'entrance_point', 'parking_point', 'community_gate',
--                                        'requested_by_phone',
--                                        'seizures', 'seizures_note',
--                                        'implanted_device', 'implanted_device_note',
--                                        'head_injury', 'head_injury_note',
--                                        'pregnancy', 'pregnancy_note',
--                                        'medication', 'medication_note',
--                                        'scalp', 'scalp_note']) as e),
--       '{}'::jsonb)
--     end
--   $$;
--   revoke execute on function app.audit_redact(jsonb) from public;
