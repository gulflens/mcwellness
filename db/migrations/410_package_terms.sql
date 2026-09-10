-- 410_package_terms.sql
-- A programme runs six months, and may be extended twice by three months each
-- (docs/PLAN/package-terms.md, the operator's decision 9 of 2026-09-10,
-- approved as written the same day at 15:49 on their clock).
--
-- **The term.** package.expiry_months keeps its meaning (403 reads it at the
-- sale) and changes its default from twelve to six. Programmes already sold
-- keep the term they were sold with: expires_on was written at the sale and
-- nothing here rewrites it. The three programmes on the live price list move
-- to six by a data step at the live pass, owed in
-- docs/CHANGE-REQUESTS/billing-10.md and recorded in docs/PRODUCTION.md when
-- it is run.
--
-- **The extension.** Until now an extension was one open-ended date typed by
-- the coordinator with a reason (403: extended_to, extension_reason). From
-- this round an extension is always exactly three months from the current
-- end and a programme may have two, so a programme runs twelve months at
-- most — the ceiling it had before, reached only by asking. Each extension is
-- its own row here, numbered 1 or 2, so the count is the database's to keep
-- and not a route's to remember. package_purchase.extended_to and
-- extension_reason stay: they are what every reader of a programme's end
-- already reads — app.oldest_available_entitlement (403 lines 351-355),
-- app/api/billing/balance.ts, app/api/portal/money.ts,
-- app/api/billing/stop-balance.ts, app/api/billing/sales.ts and
-- app/api/billing/extensions.ts — and the route keeps them equal to the
-- latest extension's to_on and reason.
--
-- Needs: 000 (app.set_updated_at, app_role), 010 (tenant), 020 (app_user),
-- 060 (client), 080 (app.audit_row), 099 (tenant-scoped keys), 401
-- (package.expiry_months), 403 (package_purchase, its extension columns and
-- its tenant-scoped key).

alter table public.package
  alter column expiry_months set default 6;

comment on column public.package.expiry_months is
  'How many months a programme runs from purchase. Six by default (the operator, 2026-09-10); a programme keeps the term it was sold with.';

create table public.package_extension (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant (id),
  client_id    uuid not null,
  purchase_id  uuid not null,
  -- The first or the second; the check and the unique key together are the
  -- two-per-programme guard.
  ordinal      integer not null,
  -- The end it extended from, and the end it extended to: always three months.
  from_on      date not null,
  to_on        date not null,
  reason       text not null check (length(btrim(reason)) between 1 and 200),
  created_by   uuid not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint package_extension_ordinal_is_one_or_two check (ordinal in (1, 2)),
  constraint package_extension_purchase_id_ordinal_key unique (purchase_id, ordinal),
  constraint package_extension_moves_forward check (to_on > from_on),
  -- Three months, at the database as well as in the rule
  -- (domain/billing/extension.ts). Postgres clamps a date to the target
  -- month's end exactly as `expiryOn` does — 30 November plus three months is
  -- 28 February, 31 January plus three is 30 April — so the two agree on
  -- every date there is.
  constraint package_extension_is_three_months
    check (to_on = (from_on + interval '3 months')::date),
  constraint package_extension_tenant_id_id_key unique (tenant_id, id),
  constraint package_extension_purchase_id_fkey
    foreign key (tenant_id, purchase_id) references public.package_purchase (tenant_id, id),
  constraint package_extension_client_id_fkey
    foreign key (tenant_id, client_id) references public.client (tenant_id, id),
  constraint package_extension_created_by_fkey
    foreign key (tenant_id, created_by) references public.app_user (tenant_id, id)
);

comment on table public.package_extension is
  'audited: client — one row per extension of a programme; at most two, of three months each (docs/PLAN/package-terms.md)';

-- No index of this table's own. The unique key above builds one leading with
-- purchase_id, which serves every lookup by programme, and that is the only
-- way anything reads these rows: no query in the round filters them by
-- client_id, and an index nothing uses is a write to keep right for nobody.

create trigger set_updated_at before update on public.package_extension
  for each row execute function app.set_updated_at();

create trigger audit_row after insert or update or delete on public.package_extension
  for each row execute function app.audit_row();
alter table public.package_extension enable always trigger audit_row;

------------------------------------------------------------------------------
-- Privileges and row security. Select and insert, and nothing else: an
-- extension is written once and never edited or withdrawn — a mistaken one is
-- a fact the trail keeps, not a row somebody tidies away. The `anon` and
-- `authenticated` revoke follows 403's shape, guarded because those two roles
-- exist on the hosted database and not on a laptop's.
------------------------------------------------------------------------------
do $$
declare
  has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
                       and exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  alter table public.package_extension enable row level security;
  revoke all on public.package_extension from public;
  if has_api_roles then
    revoke all on public.package_extension from anon, authenticated;
  end if;
  grant select, insert on public.package_extension to app_role;
end
$$;

-- rollback:
--   drop table if exists public.package_extension;
--   alter table public.package alter column expiry_months set default 12;
--   comment on column public.package.expiry_months is null;
--   -- and remove this table's three policies from db/policies/billing/ledger.sql,
--   -- which the runner re-applies and which name the table.
