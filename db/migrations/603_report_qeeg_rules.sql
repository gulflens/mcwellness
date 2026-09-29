-- 603_report_qeeg_rules.sql
-- The rules that name the brain-map kind and the past record's status
-- (docs/SPEC/reports-qeeg.md sections 11 and 13). 602 added both values and
-- could not use them; this file is where they are used.
--
-- **A past record is kept, not signed** (section 11, point 4). It was printed
-- once, by the old tool, in the old tool's words. So an `imported` row:
--
--   - is a brain-map report and nothing else;
--   - carries no number, so no reference; no signature and no signer's
--     snapshot; no recipient or practice block; and no PDF;
--   - names its source — the format and the file's fingerprint;
--   - is the first of nothing and follows nothing: version 1, no
--     `supersedes_id`, no `compared_with_id` (a past record is never turned
--     into a follow-up, point 9).
--
-- And a draft that came from a file can become a past record and nothing
-- else: a source sits only on a draft or a past record, so an import can
-- never be signed. Its fixed wording would be today's and not what the
-- household received.
--
-- **How a past record comes to be.** `POST /qeeg/import` saves what the old
-- file held as a DRAFT with its source, so it can be read over beside the
-- client it was brought in against (point 2); `POST /:id/keep-import` then
-- calls `app.keep_imported_report`, which moves it from draft to imported,
-- once. The API role may not insert a row that is already imported
-- (db/policies/reports/reports.sql), and the guard asks who is keeping it, so
-- the function is the one door and the owner and the lead practitioner — the
-- two `report.import` is given to (docs/CHANGE-REQUESTS/reports-02.md,
-- request 6) — are the only people who can walk through it.
--
-- **The guard, restated whole from 600** (`app.guard_report_write`; nothing
-- between 600 and here replaced it). Everything 600 admitted it still admits,
-- in the same words, and a past record adds two branches:
--
--   - a draft moving to imported is asked who is doing it, as a supersede
--     is: the owner, the lead practitioner, or nobody at all (a migration,
--     the seed);
--   - a kept past record admits ONE change, the withdraw — the stamp set,
--     the content cleared, nothing else moving — by the same two people, and
--     nothing after it. Every other update is refused, as a signed report's
--     is. The maps it held are removed by 604's functions, not here.
--
-- Statuses and kinds are compared as TEXT inside the guard and the function.
-- Nothing here needs it on a database that ran 602 in its own transaction, as
-- the runner does; but it keeps these bodies working on a database where
-- somebody applies both files by hand in one, where comparing a value to an
-- enum literal added in the same transaction is refused (55P04).
--
-- Needs: 095 (app.actor_has_role), 098 (app.erasure_active), 100
-- (app.current_tenant_id), 600 (report, the guard this restates, the two
-- checks this restates), 602 (the values and the columns).

------------------------------------------------------------------------------
-- 1. The checks.
------------------------------------------------------------------------------

-- 600's "an issued one carries all of it" read `status = 'draft' or (...)`,
-- which a past record — neither a draft nor signed — would fail. Restated
-- with the one new status beside the draft: an imported row is not issued and
-- carries none of an issue's snapshot, which the next check requires.
alter table public.report drop constraint report_issued_is_complete;
alter table public.report add constraint report_issued_is_complete check (
  status in ('draft', 'imported') or (
    number is not null and issued_on is not null and signed_at is not null
    and signed_by_practitioner_id is not null and signed_by_name is not null
    and signed_by_certification is not null and practice_legal_name is not null
    and recipient_name is not null and recipient_record_number is not null
  )
);

alter table public.report
  add constraint report_imported_is_qeeg
    check (status <> 'imported' or kind = 'qeeg'),

  -- Kept, not signed: every column 600's `report_draft_is_unsigned` names,
  -- and the rest of the signer's and the practice's snapshot with them, and a
  -- source. Nothing an issue writes can be on a past record.
  add constraint report_imported_is_unsigned check (
    status <> 'imported' or (
      number is null and issued_on is null and signed_at is null
      and signed_by_practitioner_id is null and signed_by_name is null
      and signed_by_certification is null and signed_by_certifying_body is null
      and signed_by_certificate_number is null
      and recipient_name is null and recipient_record_number is null
      and practice_legal_name is null and practice_legal_name_ar is null
      and practice_address is null and practice_licence_number is null
      and practice_licensing_authority is null
      and document_id is null
    )
  ),
  add constraint report_imported_has_source
    check (status <> 'imported' or (imported_from is not null and source_sha256 is not null)),
  add constraint report_imported_stands_alone check (
    status <> 'imported' or (version = 1 and supersedes_id is null and compared_with_id is null)
  ),

  -- A source only on a brain map, and only on a draft or a past record: an
  -- import is kept, never signed.
  add constraint report_source_on_qeeg
    check (imported_from is null or kind = 'qeeg'),
  add constraint report_source_never_signed
    check (imported_from is null or status in ('draft', 'imported')),

  -- A twin and a comparison are the brain map's alone.
  add constraint report_links_on_qeeg
    check ((twin_of_id is null and compared_with_id is null) or kind = 'qeeg'),

  -- The withdraw stamp only on a past record.
  add constraint report_withdraw_only_imported
    check (withdrawn_at is null or status = 'imported');

------------------------------------------------------------------------------
-- 2. The guard, restated whole from 600.
------------------------------------------------------------------------------
create or replace function app.guard_report_write() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  -- Who may keep a past record, withdraw one, or mark a version superseded:
  -- the owner or the lead practitioner, or nobody at all where no role has
  -- been assumed — the owner's own maintenance, a migration, the seed, never a
  -- request through the API, which always stamps a role
  -- (app.guard_erasure_request_write sets the precedent).
  v_owner_or_lead boolean :=
    nullif(current_setting('app.actor_roles', true), '') is null
    or app.actor_has_role('owner')
    or app.actor_has_role('lead_practitioner');
begin
  if exists (select 1 from app.erasure_active where txid = txid_current()) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    if old.status::text = 'draft' then
      -- A draft is work in progress and may be abandoned. The API role holds
      -- no delete grant, so this is the owner's own maintenance and the seed's.
      return old;
    end if;
    if old.status::text = 'imported' then
      raise exception 'a past record is withdrawn, never deleted'
        using errcode = 'restrict_violation',
              hint    = 'Withdraw it with a reason; the stamp of what was brought in stays.';
    end if;
    raise exception 'a signed report is never deleted; correct it with a new version'
      using errcode = 'restrict_violation',
            hint    = 'A household may already hold it.';
  end if;

  if old.status::text = 'draft' then
    -- Keeping a past record (app.keep_imported_report). The row's own checks
    -- say what a past record must be; this says who may make one.
    if new.status::text = 'imported' and not v_owner_or_lead then
      raise exception 'a past record is kept by the owner or the lead practitioner'
        using errcode = 'insufficient_privilege',
              hint    = 'A practitioner may read one over; keeping it is not theirs.';
    end if;
    return new;
  end if;

  -- A kept past record. One change and no other: the withdraw, once — the
  -- stamp set, the content cleared, and nothing else on the row moving. The
  -- stamp's own check asks for the reason; this asks that nothing rides along
  -- with it. Structural, for (a)'s reason below.
  if old.status::text = 'imported' then
    if old.withdrawn_at is null and new.withdrawn_at is not null
       and new.content = '{}'::jsonb
       and (to_jsonb(new) - array['content', 'withdrawn_at', 'withdraw_reason',
                                  'reference', 'updated_at'])
           is not distinct from
           (to_jsonb(old) - array['content', 'withdrawn_at', 'withdraw_reason',
                                  'reference', 'updated_at'])
    then
      if v_owner_or_lead then
        return new;
      end if;
      raise exception 'a past record is withdrawn by the owner or the lead practitioner'
        using errcode = 'insufficient_privilege';
    end if;
    raise exception 'past record % is kept as it was brought in and cannot be changed', old.id
      using errcode = 'restrict_violation',
            hint    = 'Kept against the wrong client, it is withdrawn once, with a reason.';
  end if;

  -- (a) The PDF being filed against the row that was just issued, and nothing
  --     else moving with it. Structural — the whole row minus the columns this
  --     transition is allowed to touch, compared as one value — so a column
  --     added to this table later is guarded by this trigger rather than
  --     slipping past an enumerated list (105's own guard does the same).
  --
  --     `reference` is excluded from both comparisons for a reason that is not
  --     about permission at all: it is a generated column, and Postgres
  --     computes a generated column *after* the before-update triggers have
  --     run, so `new.reference` is null here on every update while `old`
  --     carries the value. It would therefore read as a change on every row
  --     that has a number. Nothing is lost by leaving it out: it is generated
  --     from `number`, which is compared, so a reference cannot move unless
  --     the number it is made from does.
  if old.document_id is null and new.document_id is not null
     and (to_jsonb(new) - array['document_id', 'reference', 'updated_at'])
         is not distinct from
         (to_jsonb(old) - array['document_id', 'reference', 'updated_at'])
  then
    return new;
  end if;

  -- (b) The standing version being replaced by a later one, by the owner or
  --     the lead practitioner and nobody else.
  if old.status::text = 'issued' and new.status::text = 'superseded'
     and (to_jsonb(new) - array['status', 'reference', 'updated_at'])
         is not distinct from
         (to_jsonb(old) - array['status', 'reference', 'updated_at'])
  then
    if v_owner_or_lead then
      return new;
    end if;
    raise exception 'a signed report is replaced by the owner or the lead practitioner'
      using errcode = 'insufficient_privilege',
            hint    = 'A practitioner may draft one and may sign it; hiding a version a '
                      'household already holds is not theirs.';
  end if;

  raise exception 'report % is signed and cannot be changed; correct it with a new version',
    old.id
    using errcode = 'restrict_violation',
          hint    = 'A correction is a new version with a reason; both are kept.';
end
$$;
revoke execute on function app.guard_report_write() from public;

------------------------------------------------------------------------------
-- 3. Keeping a past record.
--
--    security invoker, and deliberately: the caller's own row security and
--    update grant decide which rows it can reach, exactly as a direct update
--    would, and the guard above asks the role a second time. What this adds
--    is the order of the questions and a sentence for each: who is asking,
--    whether the row is there, whether it is a draft, whether it came from a
--    file — so the route has a refusal to translate and not a check-constraint
--    name. The role is asked first, so a practitioner who cannot see the row
--    reads that it is not theirs to keep rather than that it does not exist.
------------------------------------------------------------------------------
create function app.keep_imported_report(p_report_id uuid) returns public.report
language plpgsql security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_tenant_id uuid := app.current_tenant_id();
  v_report    public.report;
begin
  if v_tenant_id is null then
    raise exception 'No practice in context; a past record cannot be kept.'
      using errcode = 'invalid_parameter_value';
  end if;
  if not (app.actor_has_role('owner') or app.actor_has_role('lead_practitioner')) then
    raise exception 'a past record is kept by the owner or the lead practitioner'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_report from public.report
   where tenant_id = v_tenant_id and id = p_report_id
     for update;
  if not found then
    raise exception 'There is no such report in this practice.' using errcode = 'no_data_found';
  end if;
  if v_report.status::text <> 'draft' then
    raise exception 'report % is not a draft; only a draft brought in from a file is kept',
      p_report_id
      using errcode = 'restrict_violation';
  end if;
  if v_report.kind::text <> 'qeeg' or v_report.imported_from is null then
    raise exception 'report % was not brought in from a file', p_report_id
      using errcode = 'check_violation',
            hint    = 'Only a brain-map report read from the old tool''s file is kept as a past record.';
  end if;

  update public.report
     set status = 'imported'
   where tenant_id = v_tenant_id and id = p_report_id
  returning * into v_report;

  return v_report;
end
$$;
revoke execute on function app.keep_imported_report(uuid) from public;
grant execute on function app.keep_imported_report(uuid) to app_role;

comment on function app.keep_imported_report(uuid) is
  'Moves a brain-map draft brought in from the old tool''s file to imported: kept, frozen, never '
  'signed, never shown to the household (docs/SPEC/reports-qeeg.md section 11). Owner and lead '
  'practitioner only.';

-- rollback:
--   drop function if exists app.keep_imported_report(uuid);
--   -- Restore app.guard_report_write() exactly as 600 wrote it (section 3 of
--   -- that file). Any `imported` row must first be deleted by the owner's own
--   -- maintenance, inside an erasure marker, or the restored checks below
--   -- will refuse it.
--   alter table public.report
--     drop constraint if exists report_withdraw_only_imported,
--     drop constraint if exists report_links_on_qeeg,
--     drop constraint if exists report_source_never_signed,
--     drop constraint if exists report_source_on_qeeg,
--     drop constraint if exists report_imported_stands_alone,
--     drop constraint if exists report_imported_has_source,
--     drop constraint if exists report_imported_is_unsigned,
--     drop constraint if exists report_imported_is_qeeg;
--   alter table public.report drop constraint report_issued_is_complete;
--   alter table public.report add constraint report_issued_is_complete check (
--     status = 'draft' or (
--       number is not null and issued_on is not null and signed_at is not null
--       and signed_by_practitioner_id is not null and signed_by_name is not null
--       and signed_by_certification is not null and practice_legal_name is not null
--       and recipient_name is not null and recipient_record_number is not null
--     )
--   );
