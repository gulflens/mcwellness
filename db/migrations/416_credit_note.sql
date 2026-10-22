-- 416_credit_note.sql
-- A document that corrects an issued invoice: its number, its tables, and the
-- status the credits behind it will take.
--
-- An invoice is append-only (CLAUDE.md rule 7; 402), and the FTA wants a
-- mistake on a tax invoice put right by a second document that names it, never
-- by editing the first. This file is the schema of that second document and
-- nothing else. The rules that decide what may be credited live in
-- domain/billing/creditNote.ts; the function that issues a note, writes its
-- lines and marks the credits is the next file's.
--
-- **The number.** A credit note is numbered CN-000001 upward, per practice,
-- with no gap, from a counter row taken with one locking `update ... returning`
-- in the shape of the receipt counter (405): a Postgres sequence burns a number
-- on every rolled-back transaction, and gapless is the point.
-- app.next_credit_note_number(p_tenant_id) takes the practice from its
-- argument and is granted to nobody, as 408 left app.next_invoice_number(uuid):
-- granting it would let any session burn another practice's numbers. The note's
-- own insert reaches it through a before-insert trigger running as the owner.
--
-- **One note per invoice, for now.** An invoice is either wrong or right, and a
-- partial note adds allocation questions this piece does not need. The unique
-- index on credit_note.invoice_id is the one thing a later piece (a note per
-- visit) will relax; the lines are unique per invoice line for the same reason.
--
-- **The supplier is copied from the invoice, not from the practice.** The note
-- adjusts that supply and must state the supplier the invoice stated, so the
-- columns are the invoice's own (402, 905, 959, 980) and the next file's
-- function fills them from the invoice row. Nothing here reads the tenant.
--
-- **The new status.** `entitlement_status` gains `credited`, for a credit
-- behind a corrected invoice that was never used. An enum value cannot be used
-- in the transaction that adds it, so no check, trigger or function in this
-- file names it; those go in the next file (the 408 and 969 precedent).
--
-- Append-only like the invoice, and written by one door: app_role may select
-- a note and its lines and nothing else. app.issue_credit_note (the next
-- file), a security definer function, is the only writer, so no note can be
-- written without the locks and the arithmetic it does first. The two checks that make a note honest — the lines sum to the
-- header, and no line credits more than its invoice line — are deferred
-- constraint triggers, because a header and its lines arrive in one
-- transaction and cannot agree statement by statement.
--
-- Needs: 000 (schema app, app.current_tenant_id, app.set_updated_at), 010
-- (tenant), 020 (app_user), 060 (client, the locale type), 080
-- (app.audit_row), 400 (vat_setting, which credit_note_line's
-- (tenant_id, vat_setting_version) key names), 402 (invoice, invoice_line, and
-- invoice's (tenant_id, id, client_id) key), 403 (entitlement,
-- entitlement_status), 413 (app.document_locale_from_client,
-- app.guard_document_locale). 405 is the counter's shape and 409 adds
-- invoice_line.discount_fils, which nothing here reads; neither is needed.
-- The supplier columns copy the types of those the invoice carries from later
-- files (905, 959, 980); a table that states them itself depends on none of
-- those files being present.

------------------------------------------------------------------------------
-- 1. credit_note_series — one counter per practice, and the allocator.
------------------------------------------------------------------------------
create table credit_note_series (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant (id),
  next_number  integer not null default 1 check (next_number >= 1),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references app_user (id),
  unique (tenant_id),
  unique (tenant_id, id)
);
comment on table public.credit_note_series is
  'audited: no client - the per-practice credit note number counter';
create index credit_note_series_created_by_idx on credit_note_series (created_by);
create trigger set_updated_at before update on credit_note_series
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on public.credit_note_series
  for each row execute function app.audit_row();
alter table public.credit_note_series enable always trigger audit_row;

create function app.next_credit_note_number(p_tenant_id uuid) returns integer
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_number integer;
begin
  if p_tenant_id is null then
    raise exception 'A credit note number needs a practice to belong to.'
      using errcode = 'invalid_parameter_value';
  end if;
  insert into public.credit_note_series (tenant_id) values (p_tenant_id)
    on conflict (tenant_id) do nothing;
  update public.credit_note_series
     set next_number = next_number + 1
   where tenant_id = p_tenant_id
  returning next_number - 1 into v_number;
  return v_number;
end
$$;
revoke execute on function app.next_credit_note_number(uuid) from public;

create function app.default_credit_note_series() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  insert into public.credit_note_series (tenant_id) values (new.id)
    on conflict (tenant_id) do nothing;
  return new;
end
$$;
revoke execute on function app.default_credit_note_series() from public;
create trigger default_credit_note_series after insert on public.tenant
  for each row execute function app.default_credit_note_series();

-- No data step for the practices that already exist, where 402 and 405 had
-- one: the allocator above creates a practice's counter on first use (`on
-- conflict do nothing`), so a missing row costs nothing, and a data step of
-- that shape would oblige app.bootstrap_practice's hand-written list of
-- defaults (956, 958) to name this table -- a trunk migration this piece does
-- not own (tests/db/bootstrap-practice.test.ts requires the two to agree).
-- The trigger above still gives every practice made from now on its row.

------------------------------------------------------------------------------
-- 2. credit_note — append-only, one per corrected invoice.
------------------------------------------------------------------------------
create table credit_note (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenant (id),
  client_id              uuid not null references client (id),
  -- Filled by the before-insert trigger below when the writer leaves it null.
  number                 integer not null check (number >= 1),
  -- The number as a person reads it; generated so it cannot drift from it.
  reference              text generated always as ('CN-' || lpad(number::text, 6, '0')) stored,
  invoice_id             uuid not null,
  issued_on              date not null,
  reason                 text not null check (length(btrim(reason)) >= 1),
  net_fils               integer not null check (net_fils >= 0),
  vat_fils               integer not null check (vat_fils >= 0),
  gross_fils             integer not null check (gross_fils >= 0),
  -- The part of the net that comes off sessions owed (2400) rather than off
  -- income: a package's unused credits.
  released_net_fils      integer not null default 0 check (released_net_fils >= 0),
  -- The supplier as the corrected invoice stated it. Copied by the issuing
  -- function, never typed by a caller and never read back from the tenant.
  supplier_legal_name              text not null,
  supplier_legal_name_ar           text,
  supplier_trn                     text,
  supplier_address                 text,
  supplier_address_ar              text,
  supplier_licence_number          text,
  supplier_licensing_authority     text,
  supplier_licensing_authority_ar  text,
  supplier_vat_registered          boolean,
  supplier_vat_trn                 text,
  supplier_contact_phone           text,
  supplier_contact_email           text,
  supplier_website                 text,
  -- The one language the document is set in, copied from the invoice (413).
  locale                 locale,
  idempotency_key        text not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid references app_user (id),
  constraint credit_note_totals_agree check (gross_fils = net_fils + vat_fils),
  constraint credit_note_release_within_net check (released_net_fils <= net_fils),
  constraint credit_note_supplier_vat_trn_fifteen_digits
    check (supplier_vat_trn is null or supplier_vat_trn ~ '^[0-9]{15}$'),
  constraint credit_note_supplier_vat_trn_needs_registration
    check (supplier_vat_trn is null or supplier_vat_registered),
  unique (tenant_id, number),
  unique (tenant_id, id),
  unique (tenant_id, id, client_id),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, client_id) references client (tenant_id, id),
  foreign key (tenant_id, invoice_id, client_id) references invoice (tenant_id, id, client_id)
);
comment on table public.credit_note is 'audited: client';
-- One note per invoice. The refund-by-visit piece relaxes exactly this.
create unique index credit_note_one_per_invoice on credit_note (invoice_id);
create index credit_note_tenant_idx on credit_note (tenant_id);
create index credit_note_client_idx on credit_note (tenant_id, client_id, issued_on);
create index credit_note_created_by_idx on credit_note (created_by);
create trigger set_updated_at before update on credit_note
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on public.credit_note
  for each row execute function app.audit_row();
alter table public.credit_note enable always trigger audit_row;

create function app.stamp_credit_note_number() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if new.number is null then
    new.number := app.next_credit_note_number(new.tenant_id);
  end if;
  return new;
end
$$;
revoke execute on function app.stamp_credit_note_number() from public;
create trigger stamp_number before insert on public.credit_note
  for each row execute function app.stamp_credit_note_number();
alter table public.credit_note enable always trigger stamp_number;

-- The document's language, fixed at issue and never moved (413).
create trigger document_locale_from_client before insert on public.credit_note
  for each row execute function app.document_locale_from_client();
create trigger guard_document_locale before update on public.credit_note
  for each row execute function app.guard_document_locale();

------------------------------------------------------------------------------
-- 3. credit_note_line — one per credited invoice line.
------------------------------------------------------------------------------
create table credit_note_line (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenant (id),
  credit_note_id         uuid not null,
  client_id              uuid not null references client (id),
  line_no                integer not null check (line_no >= 1),
  invoice_line_id        uuid not null,
  description            text not null check (length(btrim(description)) between 1 and 200),
  description_ar         text,
  net_fils               integer not null check (net_fils >= 0),
  -- The corrected line's rate and version, not today's: the note adjusts that supply.
  vat_rate_basis_points  integer not null check (vat_rate_basis_points between 0 and 10000),
  vat_setting_version    integer not null,
  vat_fils               integer not null check (vat_fils >= 0),
  gross_fils             integer not null check (gross_fils >= 0),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid references app_user (id),
  constraint credit_note_line_totals_agree check (gross_fils = net_fils + vat_fils),
  unique (tenant_id, credit_note_id, line_no),
  unique (tenant_id, id),
  foreign key (tenant_id, credit_note_id, client_id) references credit_note (tenant_id, id, client_id),
  foreign key (tenant_id, invoice_line_id) references invoice_line (tenant_id, id),
  foreign key (tenant_id, vat_setting_version) references vat_setting (tenant_id, version)
);
comment on table public.credit_note_line is 'audited: client';
-- An invoice line is credited once, as its invoice is.
create unique index credit_note_line_one_per_invoice_line on credit_note_line (invoice_line_id);
create index credit_note_line_tenant_idx on credit_note_line (tenant_id);
create index credit_note_line_note_idx on credit_note_line (tenant_id, credit_note_id, line_no);
create index credit_note_line_client_idx on credit_note_line (client_id);
create index credit_note_line_created_by_idx on credit_note_line (created_by);
create trigger set_updated_at before update on credit_note_line
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on public.credit_note_line
  for each row execute function app.audit_row();
alter table public.credit_note_line enable always trigger audit_row;

------------------------------------------------------------------------------
-- 4. The two things a note must be, checked when its transaction commits.
--    The lines sum to the header; each line stays within the invoice line it
--    corrects, which must be on the note's own invoice. security definer, so
--    the check reads the same rows whoever is writing.
------------------------------------------------------------------------------
create function app.check_credit_note_lines() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_note_id uuid;
  v_note    record;
  v_lines   record;
  v_bad     record;
begin
  -- Two tables fire this; a record has no field the other table lacks.
  if tg_table_name = 'credit_note' then
    v_note_id := new.id;
  else
    v_note_id := new.credit_note_id;
  end if;
  select id, tenant_id, invoice_id, net_fils, vat_fils, gross_fils into v_note
    from public.credit_note where id = v_note_id;
  if not found then
    return null;
  end if;

  select count(*) as n, coalesce(sum(net_fils), 0) as net, coalesce(sum(vat_fils), 0) as vat,
         coalesce(sum(gross_fils), 0) as gross
    into v_lines
    from public.credit_note_line where credit_note_id = v_note.id;
  if v_lines.n = 0 then
    raise exception 'A credit note needs at least one line.'
      using errcode = 'check_violation';
  end if;
  if v_lines.net <> v_note.net_fils or v_lines.vat <> v_note.vat_fils
     or v_lines.gross <> v_note.gross_fils then
    raise exception 'The lines of a credit note must add up to its totals.'
      using errcode = 'check_violation',
            hint = format('Lines: net %s, VAT %s, gross %s. Header: net %s, VAT %s, gross %s.',
                          v_lines.net, v_lines.vat, v_lines.gross,
                          v_note.net_fils, v_note.vat_fils, v_note.gross_fils);
  end if;

  select l.line_no into v_bad
    from public.credit_note_line l
    join public.invoice_line il on il.tenant_id = l.tenant_id and il.id = l.invoice_line_id
   where l.credit_note_id = v_note.id
     and (il.invoice_id <> v_note.invoice_id
          or l.net_fils > il.net_fils or l.vat_fils > il.vat_fils)
   limit 1;
  if found then
    raise exception 'A credit note line may not credit more than its invoice line, nor name another invoice''s line.'
      using errcode = 'check_violation',
            hint = format('Line %s.', v_bad.line_no);
  end if;
  return null;
end
$$;
revoke execute on function app.check_credit_note_lines() from public;

create constraint trigger credit_note_lines_sum
  after insert or update on public.credit_note
  deferrable initially deferred
  for each row execute function app.check_credit_note_lines();
create constraint trigger credit_note_lines_sum
  after insert or update on public.credit_note_line
  deferrable initially deferred
  for each row execute function app.check_credit_note_lines();

------------------------------------------------------------------------------
-- 5. The new status, and the column that will name the note behind it.
------------------------------------------------------------------------------
alter type entitlement_status add value if not exists 'credited';

alter table public.entitlement add column credited_by uuid;
alter table public.entitlement add constraint entitlement_credited_by_fkey
  foreign key (tenant_id, credited_by) references public.credit_note (tenant_id, id);
create index entitlement_credited_by_idx on entitlement (credited_by);
comment on column public.entitlement.credited_by is
  'The credit note that withdrew this credit, when its status is credited (migration 416). '
  'Null otherwise. Written with the status by app.issue_credit_note, in the same transaction.';

------------------------------------------------------------------------------
-- 6. Privileges and row security. Read only for app_role: a note and its
--    lines arrive through app.issue_credit_note (417) and nothing else, and
--    are never updated or deleted. The counter is moved only through the function above, so
--    app_role is granted nothing on it at all. Policies live in
--    db/policies/billing/ledger.sql.
------------------------------------------------------------------------------
do $$
declare
  t text;
  has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
                       and exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  foreach t in array array['credit_note', 'credit_note_line', 'credit_note_series'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public', t);
    if has_api_roles then
      execute format('revoke all on public.%I from anon, authenticated', t);
    end if;
  end loop;
  grant select on public.credit_note to app_role;
  grant select on public.credit_note_line to app_role;
end
$$;

-- rollback:
--   revoke select on public.credit_note_line from app_role;
--   revoke select on public.credit_note from app_role;
--   drop index if exists entitlement_credited_by_idx;
--   alter table public.entitlement drop constraint if exists entitlement_credited_by_fkey;
--   alter table public.entitlement drop column if exists credited_by;
--   -- The enum value `credited` stays: Postgres cannot remove a value from an
--   -- enum. It is harmless unused; roll back the next file (the issuing
--   -- function and the checks that name it) first, and no row may carry it.
--   drop trigger if exists credit_note_lines_sum on public.credit_note_line;
--   drop trigger if exists credit_note_lines_sum on public.credit_note;
--   drop function if exists app.check_credit_note_lines();
--   drop trigger if exists audit_row on public.credit_note_line;
--   drop table if exists credit_note_line;
--   drop trigger if exists guard_document_locale on public.credit_note;
--   drop trigger if exists document_locale_from_client on public.credit_note;
--   drop trigger if exists stamp_number on public.credit_note;
--   drop function if exists app.stamp_credit_note_number();
--   drop trigger if exists audit_row on public.credit_note;
--   drop table if exists credit_note;
--   drop trigger if exists default_credit_note_series on public.tenant;
--   drop function if exists app.default_credit_note_series();
--   drop function if exists app.next_credit_note_number(uuid);
--   drop trigger if exists audit_row on public.credit_note_series;
--   drop table if exists credit_note_series;
