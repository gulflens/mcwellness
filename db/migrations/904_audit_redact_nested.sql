-- 904_audit_redact_nested.sql
-- Needs: 080 (app.audit_redact), 098 (the erasure-marked version this replaces)
--
-- Two holes in app.audit_redact, both found reviewing the session-capture
-- stream's pull request, both the trunk's to close: the redaction list lives
-- in the trunk's migration range and docs/SPEC/audit.md section 8 is the
-- trunk's document, so a stream cannot add to either itself.
--
-- **1. A second coordinate.** The function drops `emirates_id_encrypted`,
-- `emirates_id_hash` and `checked_in_point` outright, because a coordinate
-- must not outlive an erasure inside an append-only log. `checked_out_point`
-- — the coordinate recorded when a practitioner leaves — is the same thing
-- and reached the trail verbatim. It joins the list.
--
-- **2. Everything one level down.** The truncation and the dropping both
-- looked at top-level values only, so a jsonb column carrying an object went
-- through untouched: `session_event.payload` holds `{ point }` for the same
-- coordinate under another name, and a thousand characters of free text
-- written under any key inside it were logged in full, while the identical
-- text in a plain column would have become `[redacted: 1000 chars]`. Both
-- rules now reach inside a jsonb object value, at any depth, wherever one
-- appears:
--
--   * a key named `point` or `location_point` inside an object is dropped,
--     the same treatment and for the same reason as the two top-level
--     coordinate columns;
--   * a string longer than 200 characters is replaced by its own length, the
--     same sentence the top level has always used.
--
-- Applying both to every object rather than to `payload` by name is the
-- narrower thing to get wrong: a stream that names its jsonb column something
-- else inherits the rule instead of quietly escaping it, and a key called
-- `point` that is not a coordinate loses nothing but a value the log had no
-- reason to keep. **Arrays are not descended into** — jsonb arrays in this
-- schema hold settings, not personal data (`service_type.preflight_checklist`
-- is the only one today) — so a stream that puts free text or a coordinate
-- inside an array must say so before it does, the way this change was asked
-- for.
--
-- 080_audit_triggers.sql's own comment — "Top-level keys only: the core tables
-- have no nested jsonb" — was true when it was written and has not been true
-- since migration 901. It is a merged migration and its text may never be
-- edited, so the correction is here and in
-- docs/CHANGE-REQUESTS/trunk-notes.md rather than in that file.
--
-- Everything else is exactly as 098_erasure_guard.sql left it, including
-- erasure mode: inside a transaction with a row in app.erasure_active every
-- top-level value becomes '[withheld: erasure]', keys and all, so nothing a
-- nested rule could reach survives there either.

------------------------------------------------------------------------------
-- 1. app.audit_redact_value(jsonb) — one value, redacted. Recursive, so a
--    nested object is treated the same as the one that holds it; a scalar
--    that is not a long string comes back untouched. Pure, hence immutable,
--    and granted to nobody: it is reached only from app.audit_redact below,
--    which app.audit_row (080) calls as the owner (security definer).
------------------------------------------------------------------------------
create function app.audit_redact_value(p_value jsonb) returns jsonb
language plpgsql immutable strict
set search_path = pg_catalog, pg_temp
as $$
declare
  v_text text;
begin
  if jsonb_typeof(p_value) = 'string' then
    v_text := p_value #>> '{}';
    if length(v_text) > 200 then
      return to_jsonb('[redacted: ' || length(v_text)::text || ' chars]');
    end if;
    return p_value;
  end if;

  if jsonb_typeof(p_value) = 'object' then
    return coalesce(
      (select jsonb_object_agg(e.key, app.audit_redact_value(e.value))
         from jsonb_each(p_value - array['point', 'location_point']) as e),
      '{}'::jsonb);
  end if;

  return p_value;
end
$$;
revoke execute on function app.audit_redact_value(jsonb) from public;

------------------------------------------------------------------------------
-- 2. app.audit_redact(jsonb), restated in full the way 095, 097 and 098 do,
--    because create or replace resets every attribute — language, volatility,
--    strictness, search_path and the revoke alike.
------------------------------------------------------------------------------
create or replace function app.audit_redact(p_row jsonb) returns jsonb
language sql stable strict
set search_path = pg_catalog, pg_temp
as $$
  select case when exists (select 1 from app.erasure_active where txid = txid_current())
    then (select coalesce(jsonb_object_agg(e.key, to_jsonb('[withheld: erasure]'::text)), '{}'::jsonb) from jsonb_each(p_row) as e)
    else coalesce(
    (select jsonb_object_agg(e.key, app.audit_redact_value(e.value))
       from jsonb_each(p_row - array['emirates_id_encrypted', 'emirates_id_hash',
                                     'checked_in_point', 'checked_out_point']) as e),
    '{}'::jsonb)
  end
$$;
revoke execute on function app.audit_redact(jsonb) from public;

-- rollback:
--   create or replace function app.audit_redact(p_row jsonb) returns jsonb
--   language sql stable strict
--   set search_path = pg_catalog, pg_temp
--   as $$
--     select case when exists (select 1 from app.erasure_active where txid = txid_current())
--       then (select coalesce(jsonb_object_agg(e.key, to_jsonb('[withheld: erasure]'::text)), '{}'::jsonb) from jsonb_each(p_row) as e)
--       else coalesce(
--       (select jsonb_object_agg(
--                 e.key,
--                 case
--                   when jsonb_typeof(e.value) = 'string' and length(e.value #>> '{}') > 200
--                     then to_jsonb('[redacted: ' || length(e.value #>> '{}')::text || ' chars]')
--                   else e.value
--                 end)
--          from jsonb_each(p_row - array['emirates_id_encrypted', 'emirates_id_hash', 'checked_in_point']) as e),
--       '{}'::jsonb)
--     end
--   $$;
--   revoke execute on function app.audit_redact(jsonb) from public;
--   drop function if exists app.audit_redact_value(jsonb);
