-- 906_audit_redact_requester_phone.sql
-- Needs: 904 (app.audit_redact, the nested version this replaces)
--
-- One more key on the list app.audit_redact drops outright:
-- `requested_by_phone`. Asked for by the client-record stream in
-- docs/CHANGE-REQUESTS/client-record-04.md (CR-17), and the trunk's to make,
-- because the list lives in the trunk's migration range and
-- docs/SPEC/audit.md section 8 is the trunk's document.
--
-- **Why it cannot stay.** Recording an erasure request writes the number the
-- confirmation letter will be sent to onto `erasure_request` (the
-- client-record stream's migration 104). That insert is audited like every
-- other write, and it is deliberately **not** inside erasure mode: the
-- erasure has not happened at that point and will not until somebody presses
-- the second button, so the reason and the requester are recorded in clear on
-- purpose, and the telephone number goes with them. It then sits in
-- `audit_log.new_values` for the trail's own five years — which is exactly
-- the retention the column itself is written to escape, since the erasure act
-- clears `requested_by_phone` as soon as the letter has been sent and the
-- files are confirmed gone.
--
-- It is a telephone number on a row that says a household asked to be
-- forgotten. The dropped-key list is where this schema already keeps the
-- things that must not outlive their own column — `emirates_id_encrypted`,
-- `emirates_id_hash`, `checked_in_point`, `checked_out_point` — and it
-- belongs there beside them.
--
-- **Dropped, not redacted.** The trail still says an erasure request was
-- recorded, who recorded it, when, for which client and with what reason.
-- What it stops saying is how to ring the household. A key that is dropped
-- leaves `changed_fields` naming the column, so nothing about the shape of
-- the change is lost.
--
-- **Nothing else changes.** 904's two nested rules stand exactly as they
-- were, reached through app.audit_redact_value, which this migration does not
-- touch: a key named `point` or `location_point` inside an object is dropped
-- at any depth, a string longer than 200 characters inside one is replaced by
-- its own length, and arrays are not descended into. So is erasure mode: a
-- transaction with a row in app.erasure_active still withholds every
-- top-level value, keys and all.
--
-- The column arrives with the client-record stream and is not on the trunk's
-- branch, so tests/db/audit.test.ts proves the function directly rather than
-- through a write — the same way 904's own keys are proved, and for the same
-- reason: the list is the trunk's, so the trunk proves the list.
--
-- Restated in full, the way 095, 097, 098 and 904 do, because create or
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
                                     'requested_by_phone']) as e),
    '{}'::jsonb)
  end
$$;
revoke execute on function app.audit_redact(jsonb) from public;

-- rollback:
--   -- 904_audit_redact_nested.sql's body, verbatim.
--   create or replace function app.audit_redact(p_row jsonb) returns jsonb
--   language sql stable strict
--   set search_path = pg_catalog, pg_temp
--   as $$
--     select case when exists (select 1 from app.erasure_active where txid = txid_current())
--       then (select coalesce(jsonb_object_agg(e.key, to_jsonb('[withheld: erasure]'::text)), '{}'::jsonb) from jsonb_each(p_row) as e)
--       else coalesce(
--       (select jsonb_object_agg(e.key, app.audit_redact_value(e.value))
--          from jsonb_each(p_row - array['emirates_id_encrypted', 'emirates_id_hash',
--                                        'checked_in_point', 'checked_out_point']) as e),
--       '{}'::jsonb)
--     end
--   $$;
--   revoke execute on function app.audit_redact(jsonb) from public;
