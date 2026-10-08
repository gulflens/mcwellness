-- 979_audit_redact_external_title.sql
-- Needs: 608 (report.content's `externalReportTitle`, which this drops), 975
--        (app.audit_redact, the version this restates)
--
-- An uploaded report's title out of the trail (migration 608). The title is
-- free text a person typed — "Brain map for <a child's name>" is the natural
-- thing to type — and it sits in `report.content`. `app.audit_row` (080)
-- writes the whole row into the append-only `audit_log` on every insert and
-- update, kept five years and reached by no erasure; so an erasure that
-- empties the report row's `content` would leave the title readable in the
-- trail's copy of the filing for the trail's whole life. Found by the review
-- of the uploaded-reports round, 7 October 2026 (PDPL: what an erasure
-- promises to remove, it removes).
--
-- So the title is never written to the trail at all, as 967's staff profile
-- columns are not. 608 stores it under a key nothing else in the schema uses,
-- `externalReportTitle`, and this drops that key from the row and from every
-- object one level down — which is where it lives, inside `content`. One level
-- and not every depth because that is where the key is, and the recursive
-- helper (`app.audit_redact_value`, 904) is not restated for a key that can
-- appear in one place. What the trail still says is that `content` changed
-- (`changed_fields` is computed from the raw rows before this is called), who
-- filed the report and when, and its number.
--
-- **Why 979, after 975.** 975 restates `app.audit_redact` whole, and
-- `create or replace` resets the whole function: on a fresh database anything
-- numbered below 975 that added a key would be overwritten by 975's
-- restatement (967's own reasoning). So this restates 975's body, verbatim,
-- with `externalReportTitle` added to the end of the dropped list and the one
-- level down applied to each value before the recursive helper sees it.
--
-- **The older gap this does not close.** A session or progress report's
-- written content — the practitioner's note on the visit, the household's
-- goal — is copied into the trail the same way and is not dropped here: it is
-- the clinical record whose trail of drafts and signing the audit exists to
-- keep. Recorded in docs/SPEC/reports-v1.md section 12 as an open question
-- for the trunk, not decided in passing here.

create or replace function app.audit_redact(p_row jsonb) returns jsonb
language sql stable strict
set search_path = pg_catalog, pg_temp
as $$
  select case when exists (select 1 from app.erasure_active where txid = txid_current())
    then (select coalesce(jsonb_object_agg(e.key, to_jsonb('[withheld: erasure]'::text)), '{}'::jsonb) from jsonb_each(p_row) as e)
    else coalesce(
    (select jsonb_object_agg(e.key, app.audit_redact_value(
              case when jsonb_typeof(e.value) = 'object'
                   then e.value - 'externalReportTitle' else e.value end))
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
                                     'private_notes',
                                     'push_endpoint', 'push_p256dh', 'push_auth',
                                     'externalReportTitle']) as e),
    '{}'::jsonb)
  end
$$;
revoke execute on function app.audit_redact(jsonb) from public;

-- rollback:
--   re-create app.audit_redact as 975_push_devices_redacted_and_erased.sql
--   defines it (without `externalReportTitle`), and revoke execute on it from
--   public. Trail rows written meanwhile keep the values they were written
--   with — which is to say, without the title.
