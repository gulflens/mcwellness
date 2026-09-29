-- 602_report_qeeg_kind.sql
-- The brain-map report's kind, the past record's status, and the columns both
-- need (docs/SPEC/reports-qeeg.md sections 4, 11 and 13).
--
-- **Why two files.** A value added to an enum cannot be used in the
-- transaction that added it, and the runner applies each file in one. So this
-- file adds the two values and the empty columns and names neither value
-- anywhere — not in a check, not in an index predicate, not in a default. Every
-- rule that has to say `qeeg` or `imported` is 603's, exactly as 969 added
-- `voided` and 970 used it.
--
-- **What the columns are for** (section 14):
--
--   twin_of_id        the same report in the other language. One form, each
--                     language signed as its own report (decision 3); the
--                     second is made from the first by `POST /:id/twin` and
--                     points back at it, so the two cannot be made to disagree
--                     on a finding or a score.
--   compared_with_id  what a follow-up is compared with: a signed report or a
--                     past record, of the same client.
--   imported_from     the format of the old tool's file a past record was read
--                     from (`qeeg.json/1`, domain/reports/qeeg/types.ts
--                     `Provenance`). A format, never a file name: a file name
--                     is whatever somebody typed, and may be a person's.
--   source_sha256     the fingerprint of that file, as lower-case hex, so the
--                     same file brought in twice for one client is refused by
--                     the key below rather than noticed later (section 11,
--                     point 6).
--   withdrawn_at,     the stamp a past record kept against the wrong client
--   withdraw_reason   carries when an owner or a lead practitioner withdraws it:
--                     content cleared, the stamp kept (section 11, point 7).
--                     Who withdrew it is the audit trail's to say, as it is
--                     for every other update of this row.
--
-- All empty by default, so every row that exists today reads exactly as it
-- did, and the two kinds that exist behave exactly as before.
--
-- **Same client, not only the same practice.** Both links reference
-- `report (tenant_id, id, client_id)`, the key 600 declared for
-- `report_delivery`, so a twin or a comparison can never be another
-- household's report — refused by the key at write time rather than by a
-- query that happens to filter. `client_id` is not null on every row, so a
-- link that is null is simply not checked (match simple), as `supersedes_id`
-- is not.
--
-- Needs: 600 (report, report_kind, report_status, the client-scoped key).

alter type public.report_kind add value if not exists 'qeeg';
alter type public.report_status add value if not exists 'imported';

alter table public.report
  add column twin_of_id       uuid,
  add column compared_with_id uuid,
  add column imported_from    text,
  add column source_sha256    text,
  add column withdrawn_at     timestamptz,
  add column withdraw_reason  text,

  add constraint report_twin_of_same_client
    foreign key (tenant_id, twin_of_id, client_id) references public.report (tenant_id, id, client_id),
  add constraint report_compared_with_same_client
    foreign key (tenant_id, compared_with_id, client_id)
    references public.report (tenant_id, id, client_id),

  add constraint report_twin_is_another
    check (twin_of_id is null or twin_of_id <> id),
  add constraint report_compared_with_another
    check (compared_with_id is null or compared_with_id <> id),

  -- A source is a format and a fingerprint together, or nothing. The
  -- fingerprint is the one domain/reports/qeeg/shape.ts accepts.
  add constraint report_source_together
    check ((imported_from is null) = (source_sha256 is null)),
  add constraint report_source_format
    check (imported_from is null or char_length(btrim(imported_from)) between 1 and 40),
  add constraint report_source_fingerprint
    check (source_sha256 is null or source_sha256 ~ '^[0-9a-f]{64}$'),

  -- The withdraw stamp: both or neither, and a reason that is more than
  -- white space (969's rule for a void). The `coalesce` is not decoration: a
  -- check that comes out null passes, and `length(btrim(null)) > 0` is null,
  -- so without it a stamp with no reason at all would be admitted. That the
  -- stamp sits only on a past record is 603's, since it has to name the
  -- status.
  add constraint report_withdraw_together check (
    (withdrawn_at is null and withdraw_reason is null)
    or (withdrawn_at is not null and coalesce(length(btrim(withdraw_reason)), 0) > 0)
  );

-- The same file, once per client (section 11, point 6). A past record
-- withdrawn from the wrong client keeps its stamp, and it is the wrong
-- client's; bringing the file in against the right one is a different client.
create unique index report_source_once_per_client
  on public.report (tenant_id, client_id, source_sha256)
  where source_sha256 is not null;

create index report_twin_of_idx on public.report (twin_of_id) where twin_of_id is not null;
create index report_compared_with_idx on public.report (compared_with_id)
  where compared_with_id is not null;

comment on column public.report.twin_of_id is
  'The same brain-map report in the other language, which this one was made from '
  '(docs/SPEC/reports-qeeg.md section 8). Same client, by the key.';
comment on column public.report.compared_with_id is
  'What a brain-map follow-up is compared with: a signed report or a past record of the same '
  'client (docs/SPEC/reports-qeeg.md section 10).';
comment on column public.report.imported_from is
  'The format of the old tool''s file a past record was read from. A format, never a file name.';
comment on column public.report.source_sha256 is
  'The fingerprint of the file a past record was read from, lower-case hex. The same file is '
  'brought in once per client.';
comment on column public.report.withdraw_reason is
  'Why a past record kept against the wrong client was withdrawn. Its content is cleared and '
  'its source kept (docs/SPEC/reports-qeeg.md section 11, point 7).';

-- rollback:
--   -- 603 first. Postgres cannot drop a value from an enum; `qeeg` and
--   -- `imported` stay on the types, unused, which is harmless. To remove them
--   -- the types would have to be recreated and every column cast across.
--   drop index if exists public.report_compared_with_idx;
--   drop index if exists public.report_twin_of_idx;
--   drop index if exists public.report_source_once_per_client;
--   alter table public.report
--     drop constraint if exists report_withdraw_together,
--     drop constraint if exists report_source_fingerprint,
--     drop constraint if exists report_source_format,
--     drop constraint if exists report_source_together,
--     drop constraint if exists report_compared_with_another,
--     drop constraint if exists report_twin_is_another,
--     drop constraint if exists report_compared_with_same_client,
--     drop constraint if exists report_twin_of_same_client,
--     drop column if exists withdraw_reason,
--     drop column if exists withdrawn_at,
--     drop column if exists source_sha256,
--     drop column if exists imported_from,
--     drop column if exists compared_with_id,
--     drop column if exists twin_of_id;
