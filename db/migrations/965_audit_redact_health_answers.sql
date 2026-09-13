-- 965_audit_redact_health_answers.sql
-- Needs: 914 (app.audit_redact, the version this replaces), 904
--        (app.audit_redact_value, which this migration calls and never
--        restates), 108 (health_declaration, whose columns these are)
--
-- Twelve more keys on the list app.audit_redact drops outright: the six
-- answers `health_declaration` holds and the six notes beside them.
--
-- **Why.** 108 stores what a household told the practice about their health —
-- epilepsy or any seizure, an implanted electrical device, a head injury,
-- pregnancy, medication that affects mood, sleep or attention, a skin condition
-- on the scalp — and 964 deletes those rows outright when the household asks
-- to be forgotten, because the answers ARE the personal part and nothing
-- survives reducing them. But `app.audit_row` writes `to_jsonb(row)` into
-- `audit_log.new_values` on the insert, and the trail is append-only, kept
-- five years, and reached by no erasure. Without this migration a row saying
-- "seizures: yes" would be gone from the table and still legible in the log
-- for the log's whole life — which is exactly the retention 964's comment says
-- the erasure ends (the review of pull request 177, finding 3).
--
-- **The same treatment the Emirates ID gets**, and for the same reason: the
-- most sensitive thing the practice holds about a person is the one thing the
-- trail must not keep a copy of. Dropped, not redacted — a redacted value is
-- still a value; these keys go.
--
-- **What the trail still says.** That a declaration was recorded, for which
-- client, by whom, when, with what reason, and — through `changed_fields`,
-- which `app.audit_row` computes from the raw rows before this function is
-- called — which columns moved, were any ever to move (no update is granted).
-- The row itself holds the answers, under the row rules that decide who may
-- read them (db/policies/client/readers.sql), which is the whole difference
-- between an answer that can be deleted and one that cannot.
--
-- **The keys are dropped by name, on every table.** No other table has a
-- column by any of these twelve names (checked against every migration on
-- 2026-09-14), so nothing else loses a value here. Whoever adds a column called
-- `medication` or `scalp` elsewhere should know it will not reach the trail.
--
-- A concern's `description` is not on this list, deliberately: it is treated
-- exactly as `goal.description` is, emptied by the erasure act and kept by the
-- trail from before it, and changing that is the round trunk-notes round 36
-- asks for, not this one.
--
-- Nothing else changes. 904's two nested rules stand exactly as they are,
-- reached through `app.audit_redact_value`, which this migration does not
-- touch, and so does erasure mode: a transaction with a row in
-- `app.erasure_active` still withholds every top-level value, keys and all.
--
-- Restated in full, the way 095, 097, 098, 904, 906 and 914 do, because create
-- or replace resets every attribute — language, volatility, strictness,
-- search_path and the revoke alike.

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
                                     'scalp', 'scalp_note']) as e),
    '{}'::jsonb)
  end
$$;
revoke execute on function app.audit_redact(jsonb) from public;

-- rollback:
--   -- 914_audit_redact_location_points.sql's body, verbatim. Rows already
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
--                                        'requested_by_phone']) as e),
--       '{}'::jsonb)
--     end
--   $$;
--   revoke execute on function app.audit_redact(jsonb) from public;
