-- 402_billing_document.sql
-- The money documents: invoices with their lines, and payments
-- (00-data-model.md section 6; docs/SPEC/billing.md sections 3, 5 and 6).
--
-- **The invoice number.** A tax invoice needs a sequential number, and the
-- Federal Tax Authority means sequential without gaps. A Postgres sequence
-- cannot give that: a rolled-back transaction burns its number and the gap is
-- permanent. So the number comes from a per-practice counter row, taken with
-- one `update ... returning`. That statement locks the row, so a second
-- transaction asking at the same moment waits rather than taking the same
-- number, and a transaction that rolls back gives its number back. Proved
-- under concurrency in tests/billing/db/invoice_number.test.ts.
--
-- **Append-only.** An issued invoice is never edited (CLAUDE.md rule 7); a
-- correction is a credit note, and credit notes are not in this pull request.
-- Neither `invoice`, `invoice_line` nor `payment` grants update or delete to
-- app_role, so all three are refused at SQLSTATE 42501 by construction, the
-- discipline 400 set for the price list.
--
-- **The PDF is not here.** `document_id` is nullable and nothing writes it
-- yet: rendering the invoice is the next pull request. That request will
-- decide how a rendered document attaches to a row nobody may update — most
-- likely its own small table, so the invoice stays append-only.
--
-- **Which kinds are written today.** `session` (a delivered visit with no
-- credit left, 404) and `package` (a programme sold, app/api/billing/sales.ts).
-- `statement` is in the enum and nothing writes one: a monthly statement is
-- a later piece, and naming it now costs nothing while adding an enum value
-- later is its own migration. A **payment receipt is deliberately not a
-- kind**: a receipt acknowledges money against an invoice that already
-- exists, so it is a rendering of `payment`, and it belongs to the same
-- pull request as the PDF. Nothing here should be read as reserving a place
-- for it.
--
-- **The supplier's identity is snapshotted.** A UAE tax invoice must carry
-- the supplier's legal name, its TRN and its address, and this row can never
-- be updated, so it cannot be backfilled after the fact: an invoice issued
-- before the practice recorded its TRN would be missing it for ever. The
-- three columns are filled by a before-insert trigger rather than by each
-- caller, because there are already two callers (the sale route and
-- app.charge_single_visit) and forgetting in one of them would not be
-- visible until an invoice was rendered. Renaming the practice next year
-- leaves every invoice already issued saying what it said.
--
-- **VAT.** Every line carries the rate and the `vat_setting` version that
-- produced it, stamped at write time from the price it came from, never
-- typed (CLAUDE.md rule 6, billing.md section 5.1). The invoice's own totals
-- are the sum of its lines, and a check constraint holds gross to net plus VAT.
--
-- Needs: 000, 010 (tenant), 020 (app_user), 040 (service_type), 060 (client),
-- 080 (app.audit_row), 099 (tenant-scoped keys on client, service_type and
-- document), 300 (session — invoice.session_id names a visit, so this
-- migration genuinely depends on the session-capture stream's table and says
-- so here rather than assuming its own number is higher; docs/SPEC/OWNERSHIP.md,
-- "Apply order across these ranges is not fixed"), 400 (vat_setting),
-- 401 (package).

create type invoice_kind as enum ('session', 'package', 'statement');
-- Cash, bank transfer and a payment link are what the practice takes today
-- (the founder's decision of 2026-09-03). Card on file and the two BNPL
-- providers billing.md section 3 recommends join this enum when those
-- integrations land — a new value then, not a new column.
create type payment_method as enum ('cash', 'transfer', 'link');

------------------------------------------------------------------------------
-- 1. invoice_number_series — one counter per practice, and the allocator.
------------------------------------------------------------------------------
create table invoice_number_series (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant (id),
  next_number  integer not null default 1 check (next_number >= 1),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references app_user (id),
  unique (tenant_id),
  unique (tenant_id, id)
);
-- Audited like everything else in public, and deliberately so: every
-- allocation moves this row, so the trail carries a record of which number
-- went out when and to whom, which is exactly what a gapless tax sequence
-- wants to be able to show.
comment on table public.invoice_number_series is
  'audited: no client - the per-practice invoice number counter';
create index invoice_number_series_created_by_idx on invoice_number_series (created_by);
create trigger set_updated_at before update on invoice_number_series
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on public.invoice_number_series
  for each row execute function app.audit_row();
alter table public.invoice_number_series enable always trigger audit_row;

-- Allocates the next invoice number for the calling practice. security
-- definer for the reason app.default_vat_setting() is: app_role is never
-- granted update on this table, so the only way to move the counter is
-- through this function, and the only thing it will ever do is move it by
-- one. The `update ... returning` takes a row lock, which is what makes two
-- concurrent sales take two different numbers rather than the same one.
create function app.next_invoice_number() returns integer
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_tenant_id uuid := app.current_tenant_id();
  v_number    integer;
begin
  if v_tenant_id is null then
    raise exception 'No practice in context; an invoice number cannot be allocated.'
      using errcode = 'invalid_parameter_value';
  end if;
  -- Covers a practice created before this migration ran, and any row the
  -- trigger below could not have fired for.
  insert into public.invoice_number_series (tenant_id) values (v_tenant_id)
    on conflict (tenant_id) do nothing;
  update public.invoice_number_series
     set next_number = next_number + 1
   where tenant_id = v_tenant_id
  returning next_number - 1 into v_number;
  return v_number;
end
$$;
revoke execute on function app.next_invoice_number() from public;
grant execute on function app.next_invoice_number() to app_role;

create function app.default_invoice_number_series() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  insert into public.invoice_number_series (tenant_id) values (new.id)
    on conflict (tenant_id) do nothing;
  return new;
end
$$;
revoke execute on function app.default_invoice_number_series() from public;
create trigger default_invoice_number_series after insert on public.tenant
  for each row execute function app.default_invoice_number_series();

------------------------------------------------------------------------------
-- 2. invoice — append-only, one per sale.
------------------------------------------------------------------------------
create table invoice (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenant (id),
  client_id              uuid not null references client (id),
  number                 integer not null check (number >= 1),
  -- The number as a person reads it. Generated, so it can never drift from
  -- the number it renders.
  reference              text generated always as ('INV-' || lpad(number::text, 6, '0')) stored,
  kind                   invoice_kind not null,
  issued_on              date not null,
  -- What this invoice is for, and the kind says which. A session invoice
  -- names a session, a package invoice names a purchase, a statement names
  -- neither; before, the constraint only refused *both*, so a package
  -- invoice naming nothing at all was accepted and rendered as a bill for
  -- an unnamed thing.
  session_id             uuid,
  package_purchase_id    uuid,  -- bound by a foreign key in 403, once the table exists
  -- The practice as it was on the day, for the FTA. Filled by the trigger
  -- below from the tenant and its studio address; never typed by a caller,
  -- and never updated, because this row never is.
  supplier_legal_name    text not null,
  supplier_trn           text,
  supplier_address       text,
  net_fils               integer not null check (net_fils >= 0),
  vat_fils               integer not null check (vat_fils >= 0),
  gross_fils             integer not null check (gross_fils >= 0),
  -- The rendered PDF. Nullable, and written by nothing in this pull request.
  document_id            uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid references app_user (id),
  constraint invoice_totals_agree check (gross_fils = net_fils + vat_fils),
  constraint invoice_source_matches_kind check (
    case kind
      when 'session' then session_id is not null and package_purchase_id is null
      when 'package' then package_purchase_id is not null and session_id is null
      when 'statement' then session_id is null and package_purchase_id is null
    end
  ),
  unique (tenant_id, number),
  unique (tenant_id, id),
  foreign key (tenant_id, client_id) references client (tenant_id, id),
  foreign key (tenant_id, session_id) references session (tenant_id, id),
  foreign key (tenant_id, document_id) references document (tenant_id, id)
);
comment on table public.invoice is 'audited: client';
create index invoice_tenant_idx on invoice (tenant_id);
create index invoice_client_idx on invoice (tenant_id, client_id, issued_on);
create index invoice_created_by_idx on invoice (created_by);
create index invoice_document_idx on invoice (document_id);
-- One invoice per session, ever: the single-visit charge the consumption
-- trigger writes (404) can be attempted twice and land once.
create unique index invoice_one_per_session
  on invoice (tenant_id, session_id) where session_id is not null;
create trigger set_updated_at before update on invoice
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on public.invoice
  for each row execute function app.audit_row();
alter table public.invoice enable always trigger audit_row;

-- A line, and a payment, name the invoice *and* the client it belongs to, so
-- neither can be filed against one client under another's invoice. Postgres
-- wants the referenced combination declared unique, which it is by
-- construction — id is the primary key — but not until it is said.
alter table public.invoice add constraint invoice_tenant_id_client_key
  unique (tenant_id, id, client_id);

------------------------------------------------------------------------------
-- 3. invoice_line — what the invoice is made of.
------------------------------------------------------------------------------
create table invoice_line (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenant (id),
  invoice_id             uuid not null,
  -- Denormalised so the audit trigger attributes the row to a client without
  -- a join (097; session_event does the same), and bound to the invoice's own
  -- client by the composite key below so it can never name a different one.
  client_id              uuid not null references client (id),
  line_no                integer not null check (line_no >= 1),
  -- The description as it was written, snapshotted: renaming a service next
  -- year must not rewrite an invoice issued this year.
  description            text not null check (length(btrim(description)) between 1 and 200),
  description_ar         text,
  service_type_id        uuid,
  package_id             uuid,
  quantity               integer not null check (quantity >= 1),
  unit_net_fils          integer not null check (unit_net_fils >= 0),
  net_fils               integer not null check (net_fils >= 0),
  vat_rate_basis_points  integer not null check (vat_rate_basis_points between 0 and 10000),
  vat_setting_version    integer not null,
  vat_fils               integer not null check (vat_fils >= 0),
  gross_fils             integer not null check (gross_fils >= 0),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid references app_user (id),
  constraint invoice_line_totals_agree check (gross_fils = net_fils + vat_fils),
  constraint invoice_line_net_is_quantity_times_unit check (net_fils = quantity * unit_net_fils),
  unique (tenant_id, invoice_id, line_no),
  unique (tenant_id, id),
  foreign key (tenant_id, invoice_id, client_id) references invoice (tenant_id, id, client_id),
  foreign key (tenant_id, service_type_id) references service_type (tenant_id, id),
  foreign key (tenant_id, package_id) references package (tenant_id, id),
  foreign key (tenant_id, vat_setting_version) references vat_setting (tenant_id, version)
);
comment on table public.invoice_line is 'audited: client';
create index invoice_line_tenant_idx on invoice_line (tenant_id);
create index invoice_line_invoice_idx on invoice_line (tenant_id, invoice_id, line_no);
create index invoice_line_client_idx on invoice_line (client_id);
create index invoice_line_service_type_idx on invoice_line (service_type_id);
create index invoice_line_package_idx on invoice_line (package_id);
create index invoice_line_created_by_idx on invoice_line (created_by);
create trigger set_updated_at before update on invoice_line
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on public.invoice_line
  for each row execute function app.audit_row();
alter table public.invoice_line enable always trigger audit_row;

------------------------------------------------------------------------------
-- 4. payment — money received. Append-only.
------------------------------------------------------------------------------
create table payment (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant (id),
  client_id     uuid not null references client (id),
  method        payment_method not null,
  amount_fils   integer not null check (amount_fils > 0),
  received_at   timestamptz not null,
  -- A transfer reference or a payment link's own id, and nothing else. Never
  -- a card number, and no longer a free-text note: this column has no update
  -- and no delete grant, app.erase_client does not reach it (billing-03.md
  -- asks client-record to add it), and it lands verbatim in the audit trail,
  -- so anything a person could type into it would outlive the record it
  -- belongs to. Letters, digits, space, hyphen, slash, full stop, hash and
  -- colon are what a bank reference is made of; forty characters is longer
  -- than any of the UAE bank formats the practice will meet.
  reference     text check (
                  reference ~ '^[A-Za-z0-9][A-Za-z0-9 /.:#-]{0,39}$'
                  and btrim(reference) = reference
                ),
  invoice_id    uuid,
  -- The same request twice is the same payment once. A drawer generates this
  -- when the person presses the button, so a retry, a double tap or a lost
  -- response replays the original rather than taking the money twice into a
  -- table with no delete.
  idempotency_key uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references app_user (id),
  unique (tenant_id, id),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, client_id) references client (tenant_id, id),
  -- A payment settles one of its own client's invoices, or none at all.
  foreign key (tenant_id, invoice_id, client_id) references invoice (tenant_id, id, client_id)
);
comment on table public.payment is 'audited: client';
create index payment_tenant_idx on payment (tenant_id);
create index payment_client_idx on payment (tenant_id, client_id, received_at);
create index payment_invoice_idx on payment (invoice_id);
create index payment_created_by_idx on payment (created_by);
create trigger set_updated_at before update on payment
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on public.payment
  for each row execute function app.audit_row();
alter table public.payment enable always trigger audit_row;

------------------------------------------------------------------------------
-- 5. The supplier's identity, stamped at the moment an invoice is allocated.
--    Before insert, so every caller gets it without asking and none can
--    forget; security definer, so it can read the tenant row whatever role
--    is closing the visit. A value already supplied is left alone, which is
--    what lets a later migration or a correction pass its own snapshot in.
------------------------------------------------------------------------------
create function app.stamp_invoice_supplier() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_name    text;
  v_trn     text;
  v_address text;
begin
  if new.supplier_legal_name is not null then
    return new;
  end if;
  select t.legal_name, t.trn, l.display_address
    into v_name, v_trn, v_address
    from public.tenant t
    left join public.location l on l.id = t.location_id
   where t.id = new.tenant_id;
  new.supplier_legal_name := v_name;
  new.supplier_trn        := coalesce(new.supplier_trn, v_trn);
  new.supplier_address    := coalesce(new.supplier_address, v_address);
  return new;
end
$$;
revoke execute on function app.stamp_invoice_supplier() from public;
create trigger stamp_supplier before insert on public.invoice
  for each row execute function app.stamp_invoice_supplier();
alter table public.invoice enable always trigger stamp_supplier;

------------------------------------------------------------------------------
-- Privileges and row security. All three business tables are append-only:
-- select and insert, never update, never delete.
------------------------------------------------------------------------------
do $$
declare
  t text;
  has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
                       and exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  foreach t in array array['invoice', 'invoice_line', 'payment', 'invoice_number_series'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public', t);
    if has_api_roles then
      execute format('revoke all on public.%I from anon, authenticated', t);
    end if;
  end loop;
  grant select, insert on public.invoice to app_role;
  grant select, insert on public.invoice_line to app_role;
  grant select, insert on public.payment to app_role;
  -- The counter is moved only through app.next_invoice_number(), which is
  -- security definer: app_role is granted nothing on the table at all, not
  -- even select, so nobody can read or set another practice's next number.
end
$$;

-- Data step: every practice that already exists gets its counter, the way
-- 400 backfilled the VAT rate for practices that predated its trigger.
insert into invoice_number_series (tenant_id) select id from tenant
  on conflict (tenant_id) do nothing;

-- rollback:
--   revoke select, insert on public.payment from app_role;
--   revoke select, insert on public.invoice_line from app_role;
--   revoke select, insert on public.invoice from app_role;
--   drop trigger if exists default_invoice_number_series on public.tenant;
--   drop function if exists app.default_invoice_number_series();
--   drop function if exists app.next_invoice_number();
--   drop trigger if exists audit_row on public.payment;
--   drop table if exists payment;
--   drop trigger if exists audit_row on public.invoice_line;
--   drop table if exists invoice_line;
--   drop trigger if exists stamp_supplier on public.invoice;
--   drop function if exists app.stamp_invoice_supplier();
--   drop trigger if exists audit_row on public.invoice;
--   drop table if exists invoice;
--   drop trigger if exists audit_row on public.invoice_number_series;
--   drop table if exists invoice_number_series;
--   drop type if exists payment_method;
--   drop type if exists invoice_kind;
