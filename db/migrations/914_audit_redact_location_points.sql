-- 914_audit_redact_location_points.sql
-- Needs: 906 (app.audit_redact, the version this replaces), 904
--        (app.audit_redact_value, which this migration calls and never
--        restates)
--
-- Three more keys on the list app.audit_redact drops outright:
-- `entrance_point`, `parking_point` and `community_gate` — every coordinate
-- column `location` has.
--
-- **Why now.** Migration 913 is the first thing in the platform that sends a
-- member of staff's home coordinate down this path from the application. A
-- practitioner records their own base, `app.audit_row` writes `to_jsonb(row)`
-- into `audit_log.new_values`, and the point survived redaction whole and
-- decodable:
--
--     select app.audit_redact(to_jsonb(t)) from (
--       select extensions.st_setsrid(extensions.st_makepoint(55.27, 25.2), 4326)::extensions.geography
--              as entrance_point) t;
--     -> {"entrance_point": "0101000020E6100000C3F5285C8FA24B403333333333333940"}
--
-- Every subsequent move records the previous home in `old_values` beside the
-- new one in `new_values`, so the trail accrues a history of every address a
-- member of staff has ever had — in an append-only table kept for five years,
-- with no erasure path at all: erasure is `app.erase_client()`'s, and a
-- practitioner is not a client. The round that introduced the act said the
-- practice holds the coordinate in four places and named none of them the
-- audit log, which was the fifth and the one nothing can be taken out of again
-- (the review of pull request 126, finding 5).
--
-- **Every owner type, not only a practitioner's base.** A household's entrance
-- has been going into the trail the same way since `location` was audited, and
-- `docs/SPEC/audit.md` section 8 has said all along that "coordinates must not
-- outlive an erasure inside the immutable log any more than the Emirates ID
-- columns do". The erasure act clears `parking_point` and `community_gate` to
-- null and moves `entrance_point` to its emirate's centre (100, 104, 105, 106,
-- 107, 954) — and the trail kept the real one from before it, which is exactly
-- the retention those statements exist to end. `checked_in_point` and
-- `checked_out_point` are already on this list for that reason and no other;
-- these three belong beside them.
--
-- **What this migration does not do, said here so nothing reads it as more
-- than it is.** `location` has three further columns the erasure act clears
-- in the same statement as the coordinates -- `makani_number`,
-- `display_address` and `access_notes` -- and the trail keeps all three from
-- before an erasure, which is the very retention argued against above. A
-- Makani number in particular resolves a door to a few metres, so "no
-- coordinate in the trail" is a narrower promise than it sounds. They are not
-- dropped here because they are the client record's own columns, and dropping
-- them changes what the trail says about households rather than about a
-- member of staff -- which deserves its own round and its own review rather
-- than riding on the one that noticed it (the re-check of pull request 126).
-- The request is `docs/CHANGE-REQUESTS/trunk-notes.md`, round 36.
--
-- **What the trail still says.** That a location was created or changed, by
-- whom, when, with what reason, and — through `changed_fields`, which
-- `app.audit_row` computes from the raw rows before this function is called —
-- which columns moved. What it stops saying is where. The row itself holds
-- that, under the row rules that decide who may read it
-- (`db/policies/client/readers.sql`, `db/policies/core/practitioner_base.sql`),
-- which is the whole difference between a coordinate that can be corrected or
-- erased and one that cannot.
--
-- **Dropped, not redacted**, the same treatment the two session coordinates
-- get. A redacted value is still a value; these keys go.
--
-- Nothing else changes. 904's two nested rules stand exactly as they are,
-- reached through `app.audit_redact_value`, which this migration does not
-- touch: a key named `point` or `location_point` inside an object is dropped at
-- any depth, a string longer than 200 characters inside one is replaced by its
-- own length, and arrays are not descended into. So does erasure mode: a
-- transaction with a row in `app.erasure_active` still withholds every
-- top-level value, keys and all.
--
-- Restated in full, the way 095, 097, 098, 904 and 906 do, because create or
-- replace resets every attribute — language, volatility, strictness,
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
                                     'requested_by_phone']) as e),
    '{}'::jsonb)
  end
$$;
revoke execute on function app.audit_redact(jsonb) from public;

-- rollback:
--   -- 906_audit_redact_requester_phone.sql's body, verbatim. Rows already
--   -- written keep the values they were written with either way: this
--   -- replaces a function, not a row, and no coordinate comes back into a
--   -- row the redaction has already passed over.
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
--                                        'requested_by_phone']) as e),
--       '{}'::jsonb)
--     end
--   $$;
--   revoke execute on function app.audit_redact(jsonb) from public;
