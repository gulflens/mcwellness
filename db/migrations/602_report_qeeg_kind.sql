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
-- **A twin is the same client's report of the same kind, in the other
-- language, and the key says so.** `other_locale` is generated from `locale`
-- (the one of `en` and `ar` this row is not), and the twin link references
-- `report (tenant_id, id, client_id, kind, locale)` from
-- `(tenant_id, twin_of_id, client_id, kind, other_locale)`. So the twin is
-- never another household's, never another kind — and 603 holds a row with
-- a twin to `qeeg`, so the twin is a brain map too — and never in the same
-- language. A composite key rather than a trigger, because a key holds in
-- both directions: a trigger on the row that names its twin would not see the
-- twin itself being moved into the same language afterwards, and the key
-- refuses that update (no action) as it refuses the insert. A null link is
-- not checked (match simple), as `supersedes_id` is not.
--
-- The comparison link needs the target's STATUS as well — a signed report or
-- a kept past record, never a draft or a withdrawn one — and a status
-- names the new value, so its key is 603's.
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
  -- The language this row's twin must be in. `locale` is 020's two-value
  -- enum, so "not English" is Arabic and the reverse.
  add column other_locale     locale generated always as (
                                case when locale = 'en' then 'ar'::locale else 'en'::locale end
                              ) stored,

  -- What the twin link references: a superset of the primary key, so it can
  -- never fail on existing rows.
  add constraint report_tenant_id_client_kind_locale_key
    unique (tenant_id, id, client_id, kind, locale),
  add constraint report_twin_of_same_client_kind_other_locale
    foreign key (tenant_id, twin_of_id, client_id, kind, other_locale)
    references public.report (tenant_id, id, client_id, kind, locale),

  add constraint report_twin_is_another
    check (twin_of_id is null or twin_of_id <> id),
  add constraint report_compared_with_another
    check (compared_with_id is null or compared_with_id <> id),

  -- A source is a format and a fingerprint together, or nothing. The
  -- fingerprint is the one domain/reports/qeeg/shape.ts accepts. The format
  -- is held to the shape of one (`qeeg.json/1`: small letters, figures and
  -- dots, a slash, a version number), so "a format, never a file name" is
  -- this row's promise and not only the route's.
  add constraint report_source_together
    check ((imported_from is null) = (source_sha256 is null)),
  add constraint report_source_format
    check (imported_from is null or (
      char_length(imported_from) <= 40 and imported_from ~ '^[a-z0-9.]+/[0-9]+$'
    )),
  add constraint report_source_fingerprint
    check (source_sha256 is null or source_sha256 ~ '^[0-9a-f]{64}$'),

  -- The withdraw stamp: both or neither, and a reason that is more than
  -- white space and no longer than the house's two hundred (403's waiver and
  -- extension reasons). The `coalesce` is not decoration: a
  -- check that comes out null passes, and `length(btrim(null)) > 0` is null,
  -- so without it a stamp with no reason at all would be admitted. That the
  -- stamp sits only on a past record is 603's, since it has to name the
  -- status.
  add constraint report_withdraw_together check (
    (withdrawn_at is null and withdraw_reason is null)
    or (withdrawn_at is not null
        and coalesce(length(btrim(withdraw_reason)), 0) between 1 and 200)
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
--     drop constraint if exists report_twin_of_same_client_kind_other_locale,
--     drop constraint if exists report_tenant_id_client_kind_locale_key,
--     drop column if exists other_locale,
--     drop column if exists withdraw_reason,
--     drop column if exists withdrawn_at,
--     drop column if exists source_sha256,
--     drop column if exists imported_from,
--     drop column if exists compared_with_id,
--     drop column if exists twin_of_id;
