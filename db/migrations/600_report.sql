-- 600_report.sql
-- The report: a session report or a progress report, signed by a person
-- (docs/SPEC/reports-v1.md sections 3, 5 and 6).
--
-- **Signing is a one-way door, and the row is what holds it shut.** A draft is
-- ordinary work and may be edited. Once issued, the row carries what was true
-- at signing — the signer's name, their certification, the certifying body and
-- the certificate number, and the practice's own identity block — and the
-- guard trigger below refuses every change to it but two: filing the rendered
-- PDF against it, once, and marking it superseded when a later version
-- replaces it. A correction is a new row with `supersedes_id` and a reason;
-- both stay, because a household may already hold the first one.
--
-- **The number is allocated the way the invoice number is** (402): a
-- per-practice counter row taken with one `update ... returning`, which locks
-- the row so two reports issued at the same moment take two numbers, and gives
-- a number back when a transaction rolls back. A draft that is never signed
-- burns nothing, because the number is taken at issue and not before.
-- `reference` is generated from it, so the row can never drift from what
-- `domain/reports/referenceFor.ts` prints.
--
-- **No tax number** (section 10, decision 4). A report is not a tax document.
-- The identity block carries the legal name in both languages, the trade
-- licence and the registered address, and there is no column here for a
-- registration number, so there is no way for one to be printed as a VAT
-- number — which is the misstatement migration 905's own comments exist to
-- prevent.
--
-- **`document_id` is on this row, and that is not migration 407's mistake
-- repeated.** 402 left `invoice.document_id` nullable on a table that grants
-- no update at all, so nothing could ever fill it in and 407 had to invent a
-- link table. Here the column is written *inside the issuing transaction*, by
-- `app.file_report_document` below, and the guard admits exactly that one
-- transition and no other. The bytes follow after the commit through the
-- storage seam, as an invoice's do, and the repair path billing has — re-render
-- what the store never received, refuse when the fingerprint differs — exists
-- for a report too (`app/api/reports/get.ts`). The byte-identical re-render
-- test is what proves the two can never disagree.
--
-- **No foreign key to `session` or `assessment`** (section 6). Both live in
-- ranges this migration must not assume are on the database
-- (docs/SPEC/OWNERSHIP.md, "apply order across these ranges is not fixed").
-- Their ids ride inside `content`, where an absent table costs nothing — and
-- where the snapshot rule wanted them anyway.
--
-- Needs: 010 (tenant), 020 (app_user, and the `locale` enum this table's own
-- locale column is), 040 (service_type), 050 (practitioner, credential), 060
-- (client, document), 080 (app.audit_row), 098 (app.erasure_active), 099 (the
-- tenant-scoped keys this table's composite foreign keys reference on client,
-- document, practitioner and service_type), 100 (app.current_actor_id).

create type report_kind as enum ('session', 'progress');
create type report_status as enum ('draft', 'issued', 'superseded');

------------------------------------------------------------------------------
-- 1. report_number_series — one counter per practice, and the allocator.
------------------------------------------------------------------------------
create table report_number_series (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant (id),
  next_number  integer not null default 1 check (next_number >= 1),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references app_user (id),
  unique (tenant_id),
  unique (tenant_id, id)
);
comment on table public.report_number_series is
  'audited: no client - the per-practice report reference counter';
create index report_number_series_created_by_idx on report_number_series (created_by);
create trigger set_updated_at before update on report_number_series
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on public.report_number_series
  for each row execute function app.audit_row();
alter table public.report_number_series enable always trigger audit_row;

-- security definer for the reason app.next_invoice_number() is: app_role is
-- never granted update on this table, so the only way to move the counter is
-- through this function, and the only thing it will ever do is move it by one.
create function app.next_report_number() returns integer
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_tenant_id uuid := app.current_tenant_id();
  v_number    integer;
begin
  if v_tenant_id is null then
    raise exception 'No practice in context; a report reference cannot be allocated.'
      using errcode = 'invalid_parameter_value';
  end if;
  insert into public.report_number_series (tenant_id) values (v_tenant_id)
    on conflict (tenant_id) do nothing;
  update public.report_number_series
     set next_number = next_number + 1
   where tenant_id = v_tenant_id
  returning next_number - 1 into v_number;
  return v_number;
end
$$;
revoke execute on function app.next_report_number() from public;
grant execute on function app.next_report_number() to app_role;

create function app.default_report_number_series() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  insert into public.report_number_series (tenant_id) values (new.id)
    on conflict (tenant_id) do nothing;
  return new;
end
$$;
revoke execute on function app.default_report_number_series() from public;
create trigger default_report_number_series after insert on public.tenant
  for each row execute function app.default_report_number_series();

------------------------------------------------------------------------------
-- 2. report.
------------------------------------------------------------------------------
create table report (
  id                            uuid primary key default gen_random_uuid(),
  tenant_id                     uuid not null references tenant (id),
  client_id                     uuid not null references client (id),
  kind                          report_kind not null,
  status                        report_status not null default 'draft',
  -- Which language the practitioner's own narrative was written in. Every
  -- fixed label prints in both; a paragraph a person wrote prints in the one
  -- they wrote it in (section 5).
  locale                        locale not null default 'en',
  -- What the report is about, where it is about one service. A progress
  -- report over a whole programme names none, and then any valid signing
  -- credential will do (domain/reports/canIssue.ts).
  service_type_id               uuid,
  -- The stretch a progress report covers. Null on a session report, whose
  -- own date is inside `content`.
  coverage_from                 date,
  coverage_to                   date,
  -- The structured body: the sections, the figures quoted, the assessment ids
  -- compared, the ribbon's slices and the narrative. What the PDF was rendered
  -- from, so it can be rendered again. Shape declared in
  -- domain/reports/shapes/ and validated at the edge.
  content                       jsonb not null default '{}'::jsonb,

  -- The number a household quotes, allocated at issue and never reused.
  number                        integer check (number >= 1),
  reference                     text generated always as (
                                  case when number is null then null
                                       else 'RPT-' || lpad(number::text, 6, '0') end
                                ) stored,
  issued_on                     date,
  signed_at                     timestamptz,

  -- Who signed, as it was true at signing (section 3). Snapshots, never a
  -- pointer at a credential row that will be renewed or corrected later.
  signed_by_practitioner_id     uuid,
  signed_by_name                text,
  signed_by_certification       text,
  signed_by_certifying_body     text,
  signed_by_certificate_number  text,

  -- The practice as it was on the day, stamped in the same breath, exactly as
  -- app.stamp_invoice_supplier stamps an invoice. No tax number, ever.
  practice_legal_name           text,
  practice_legal_name_ar        text,
  practice_address              text,
  practice_licence_number       text,
  practice_licensing_authority  text,

  -- The rendered PDF, written by app.file_report_document inside the issuing
  -- transaction and never afterwards.
  document_id                   uuid,

  -- Amendment lineage (.claude/rules/data-model.md), as session,
  -- client_protocol and invoice already carry it.
  version                       integer not null default 1 check (version >= 1),
  supersedes_id                 uuid,
  amendment_reason              text,

  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  created_by                    uuid references app_user (id),

  constraint report_amendment_reason_with_version
    check ((version = 1 and supersedes_id is null) or amendment_reason is not null),
  -- A draft has no number, no signature, no identity block and no document. A
  -- draft that carried any of them would be a document nobody signed.
  constraint report_draft_is_unsigned check (
    status <> 'draft' or (
      number is null and issued_on is null and signed_at is null
      and signed_by_practitioner_id is null and signed_by_name is null
      and practice_legal_name is null and document_id is null
    )
  ),
  -- And an issued one carries all of it. Checked at the column rather than
  -- trusted to the route, because this row can never be corrected afterwards.
  constraint report_issued_is_complete check (
    status = 'draft' or (
      number is not null and issued_on is not null and signed_at is not null
      and signed_by_practitioner_id is not null and signed_by_name is not null
      and signed_by_certification is not null and practice_legal_name is not null
    )
  ),
  constraint report_coverage_in_order
    check (coverage_from is null or coverage_to is null or coverage_from <= coverage_to),

  unique (tenant_id, id),
  unique (tenant_id, id, client_id),
  unique (tenant_id, number),
  unique (tenant_id, document_id),
  -- One successor per version, so a chain can never fork and give two answers
  -- to "which version is current" (section 10, decision 5).
  unique (tenant_id, supersedes_id),
  foreign key (tenant_id, client_id) references client (tenant_id, id),
  foreign key (tenant_id, document_id) references document (tenant_id, id),
  foreign key (tenant_id, service_type_id) references service_type (tenant_id, id),
  foreign key (tenant_id, signed_by_practitioner_id) references practitioner (tenant_id, id),
  foreign key (tenant_id, supersedes_id) references report (tenant_id, id)
);
comment on table public.report is 'audited: client';
create index report_client_idx on report (tenant_id, client_id, created_at desc);
create index report_status_idx on report (tenant_id, status);
create index report_document_idx on report (document_id);
create index report_supersedes_idx on report (supersedes_id);
create index report_service_type_idx on report (service_type_id);
create index report_signer_idx on report (signed_by_practitioner_id);
create index report_created_by_idx on report (created_by);

comment on column public.report.content is
  'The body the PDF was rendered from: the figures quoted, the ribbon''s slices, the '
  'assessment ids compared and the practitioner''s narrative. Holds no electrode site, '
  'no band threshold and no protocol (docs/SPEC/reports-v1.md section 5).';
comment on column public.report.signed_by_name is
  'Who signed, as it was true at signing. Never read back from credential: a report '
  'issued in March must still say who signed it in March and on what authority.';
comment on column public.report.document_id is
  'The rendered PDF, written inside the issuing transaction by app.file_report_document. '
  'The bytes follow after the commit through the storage seam; a store that never '
  'received them is repaired by re-rendering from content (app/api/reports/get.ts).';

create trigger set_updated_at before update on report
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on public.report
  for each row execute function app.audit_row();
alter table public.report enable always trigger audit_row;

------------------------------------------------------------------------------
-- 3. The guard: an issued report is not edited.
--
--    A trigger that raises, not a policy that hides: a policy would make the
--    update disappear silently and report success, which is the one thing a
--    signed document must never do (302_session_close.sql sets the pattern).
--
--    Two updates are admitted on an issued row and no others:
--
--      a) filing the rendered PDF — `document_id` moving from null, once,
--         inside the issuing transaction;
--      b) marking it superseded — `status` moving from 'issued' to
--         'superseded' when a later version replaces it.
--
--    Structural rather than an enumerated list of what may not change, so a
--    column added to this table later is guarded by this trigger rather than
--    slipping past it.
--
--    security definer, so the guard can see app.erasure_active, which app_role
--    holds no grant on at all (098). An erasure clears `content` on an issued
--    row (migration 107), and a record frozen against a person's right to be
--    forgotten is not a record worth freezing.
------------------------------------------------------------------------------
create function app.guard_report_write() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if exists (select 1 from app.erasure_active where txid = txid_current()) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    if old.status = 'draft' then
      -- A draft is work in progress and may be abandoned. The API role holds
      -- no delete grant, so this is the owner's own maintenance and the seed's.
      return old;
    end if;
    raise exception 'a signed report is never deleted; correct it with a new version'
      using errcode = 'restrict_violation',
            hint    = 'A household may already hold it.';
  end if;

  if old.status = 'draft' then
    return new;
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

  -- (b) The standing version being replaced by a later one.
  if old.status = 'issued' and new.status = 'superseded'
     and (to_jsonb(new) - array['status', 'reference', 'updated_at'])
         is not distinct from
         (to_jsonb(old) - array['status', 'reference', 'updated_at'])
  then
    return new;
  end if;

  raise exception 'report % is signed and cannot be changed; correct it with a new version',
    old.id
    using errcode = 'restrict_violation',
          hint    = 'A correction is a new version with a reason; both are kept.';
end
$$;
revoke execute on function app.guard_report_write() from public;
create trigger guard_report_write before update or delete on public.report
  for each row execute function app.guard_report_write();
alter table public.report enable always trigger guard_report_write;

------------------------------------------------------------------------------
-- 4. Issuing one: the number, the signer's snapshot and the practice's, in
--    one statement, with the credential re-checked here and not only in the
--    route.
--
--    **The signer is the person issuing** (section 10, decision 3), and that
--    is enforced here rather than observed by the screen: the practitioner
--    named must be the caller's own, `p.user_id = app.current_actor_id()`,
--    exactly as app.complete_appointment_for_session checks it (302). Without
--    it a caller could name a colleague and put that colleague's name and
--    certificate number on a document — the trail would name the actor and the
--    document would not.
--
--    security definer for the reason app.file_billing_document is: the
--    credential and the tenant row are read as the practice, whichever role is
--    signing, and the caller cannot name a signer whose credential does not
--    say `can_sign_report`. security definer is also why the caller's own
--    identity is checked in this body: row security is not going to check it
--    for us. The route asks domain/reports/canIssue first so a person gets a
--    sentence rather than a raise; this is the answer that binds.
------------------------------------------------------------------------------
create function app.issue_report(
  p_report_id       uuid,
  p_practitioner_id uuid,
  p_issued_on       date
) returns report
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_tenant_id  uuid := app.current_tenant_id();
  v_report     public.report;
  v_credential public.credential;
  v_signer     text;
  v_number     integer;
  v_tenant     record;
begin
  if v_tenant_id is null then
    raise exception 'No practice in context; a report cannot be issued.'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into v_report from public.report
   where tenant_id = v_tenant_id and id = p_report_id
     for update;
  if not found then
    raise exception 'There is no such report in this practice.' using errcode = 'no_data_found';
  end if;
  if v_report.status <> 'draft' then
    raise exception 'report % has already been signed', p_report_id
      using errcode = 'restrict_violation';
  end if;

  -- The signer is the person issuing. Asked before the credential, because
  -- naming somebody else is a different refusal from holding no certificate,
  -- and a caller who tried it should read that sentence rather than one about
  -- a colleague's certificate.
  select u.display_name into v_signer
    from public.practitioner p
    join public.app_user u on u.id = p.user_id and u.tenant_id = p.tenant_id
   where p.tenant_id = v_tenant_id
     and p.id = p_practitioner_id
     and p.user_id = app.current_actor_id();
  if v_signer is null then
    raise exception 'a report is signed by the person issuing it'
      using errcode = 'insufficient_privilege',
            hint    = 'The practitioner named must be the person signed in.';
  end if;

  -- The credential, at this moment, for this signer, and for the report's own
  -- service where it names one. Nothing about a role is asked: a role does not
  -- grant this (section 10, decision 6).
  select c.* into v_credential from public.credential c
   where c.tenant_id = v_tenant_id
     and c.practitioner_id = p_practitioner_id
     and c.can_sign_report
     and c.valid_from <= p_issued_on
     and (c.valid_to is null or p_issued_on <= c.valid_to)
     and (v_report.service_type_id is null or c.service_type_id = v_report.service_type_id)
   -- Where a practitioner holds more than one signing credential and the
   -- report names no service, the most durable one is taken: a certificate
   -- with no end date first, then the one that runs longest. Deterministic, so
   -- two issues a minute apart snapshot the same authority, and defensible,
   -- because it is the credential least likely to be the one that lapses.
   order by c.valid_to desc nulls first, c.id
   limit 1;
  if not found then
    raise exception 'that practitioner holds no certificate that lets them sign this report on %',
      p_issued_on
      using errcode = 'insufficient_privilege',
            hint    = 'A report is signed on a credential that says can_sign_report and is valid today.';
  end if;

  select t.legal_name, t.legal_name_ar, t.licence_number, t.licensing_authority,
         l.display_address
    into v_tenant
    from public.tenant t
    left join public.location l on l.id = t.location_id
   where t.id = v_tenant_id;

  v_number := app.next_report_number();

  update public.report
     set status                       = 'issued',
         number                       = v_number,
         issued_on                    = p_issued_on,
         signed_at                    = now(),
         signed_by_practitioner_id    = p_practitioner_id,
         signed_by_name               = v_signer,
         signed_by_certification      = v_credential.certification,
         signed_by_certifying_body    = v_credential.certifying_body,
         signed_by_certificate_number = v_credential.certificate_number,
         practice_legal_name          = v_tenant.legal_name,
         practice_legal_name_ar       = v_tenant.legal_name_ar,
         practice_address             = v_tenant.display_address,
         practice_licence_number      = v_tenant.licence_number,
         practice_licensing_authority = v_tenant.licensing_authority
   where tenant_id = v_tenant_id and id = p_report_id
  returning * into v_report;

  return v_report;
end
$$;
revoke execute on function app.issue_report(uuid, uuid, date) from public;
grant execute on function app.issue_report(uuid, uuid, date) to app_role;

------------------------------------------------------------------------------
-- 5. Filing the rendered PDF. Writes the `document` row and the link together,
--    or neither, and is idempotent: a retried issue finds the first document
--    rather than filing a second one bearing the same reference.
--
--    security definer for `app.file_billing_document`'s reason: the client
--    comes off the report row itself, never from the caller, so this cannot be
--    used to file a document against somebody else's record.
------------------------------------------------------------------------------
create function app.file_report_document(
  p_report_id       uuid,
  -- The document's id is the caller's, because the storage key is built from
  -- it and the bytes are written under that key (domain/shared/storage.ts).
  p_document_id     uuid,
  p_storage_key     text,
  p_sha256          bytea,
  p_retention_until timestamptz
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_tenant_id   uuid := app.current_tenant_id();
  v_actor_id    uuid := app.current_actor_id();
  v_client_id   uuid;
  v_existing    uuid;
  v_status      public.report_status;
begin
  if v_tenant_id is null then
    raise exception 'No practice in context; a report document cannot be filed.'
      using errcode = 'invalid_parameter_value';
  end if;

  select client_id, document_id, status into v_client_id, v_existing, v_status
    from public.report
   where tenant_id = v_tenant_id and id = p_report_id
     for update;
  if v_client_id is null then
    raise exception 'There is no such report in this practice.' using errcode = 'no_data_found';
  end if;
  if v_status = 'draft' then
    raise exception 'a draft has no document; sign it first' using errcode = 'restrict_violation';
  end if;
  -- Already filed: hand back what is there rather than rendering a second
  -- document for the same report.
  if v_existing is not null then
    return v_existing;
  end if;

  insert into public.document (
    id, tenant_id, client_id, kind, storage_key, mime_type, sha256,
    uploaded_by, retention_until, is_immutable, created_by
  ) values (
    p_document_id, v_tenant_id, v_client_id, 'report', p_storage_key,
    'application/pdf', p_sha256, v_actor_id, p_retention_until, true, v_actor_id
  );

  update public.report set document_id = p_document_id
   where tenant_id = v_tenant_id and id = p_report_id;

  return p_document_id;
end
$$;
revoke execute on function app.file_report_document(uuid, uuid, text, bytea, timestamptz) from public;
grant execute on function app.file_report_document(uuid, uuid, text, bytea, timestamptz) to app_role;

------------------------------------------------------------------------------
-- 6. Privileges. Select, insert and update — never delete. The guard above
--    decides which updates; row security (db/policies/reports/) decides which
--    rows. The counter is moved only through app.next_report_number(), so
--    app_role is granted nothing on that table at all, not even select.
------------------------------------------------------------------------------
do $$
declare
  has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
                       and exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  alter table public.report enable row level security;
  alter table public.report_number_series enable row level security;
  revoke all on public.report from public;
  revoke all on public.report_number_series from public;
  if has_api_roles then
    revoke all on public.report from anon, authenticated;
    revoke all on public.report_number_series from anon, authenticated;
  end if;
  grant select, insert, update on public.report to app_role;
end
$$;

-- Every practice that already exists gets its counter, the way 402 backfilled
-- the invoice number for practices that predated its trigger.
insert into report_number_series (tenant_id) select id from tenant
  on conflict (tenant_id) do nothing;

-- rollback:
--   revoke select, insert, update on public.report from app_role;
--   drop function if exists app.file_report_document(uuid, uuid, text, bytea, timestamptz);
--   drop function if exists app.issue_report(uuid, uuid, date);
--   drop trigger if exists guard_report_write on public.report;
--   drop function if exists app.guard_report_write();
--   drop trigger if exists audit_row on public.report;
--   drop table if exists report;
--   drop trigger if exists default_report_number_series on public.tenant;
--   drop function if exists app.default_report_number_series();
--   drop function if exists app.next_report_number();
--   drop trigger if exists audit_row on public.report_number_series;
--   drop table if exists report_number_series;
--   drop type if exists report_status;
--   drop type if exists report_kind;
--   -- The `document` rows and the bytes behind them are not removed here: a
--   -- filed document is immutable and an erasure is what takes one away.
