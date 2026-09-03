-- 905_practice_identity.sql
-- Who the practice is, and whether it charges VAT.
--
-- **Two tax numbers, not one.** `tenant.trn` already exists and is renamed by
-- nothing here: it is the tax registration number the practice holds today,
-- which is a corporate-tax one. VAT registration is a separate event with a
-- separate number, and it has not happened yet — the threshold is AED 375,000
-- of taxable supplies (docs/SPEC/billing.md section 5.1). So `vat_registered`
-- arrives false and `vat_trn` arrives null, and an invoice prints a VAT number
-- only when both say it should. Putting the VAT number in the column that
-- already holds a different number would have been the cheap change and the
-- wrong one: a tax invoice would then carry a corporate-tax registration
-- labelled as a VAT registration, which is exactly the misstatement the
-- Federal Tax Authority reads an invoice to check.
--
-- **The licence.** A wellness business in the UAE holds a trade licence from
-- an emirate's economic department or a free zone, not a health-authority
-- licence (CLAUDE.md rule 1: McWellness is a wellness business, not a clinic,
-- and the re-baselining of 2026-09-02 removed the health-authority columns for
-- that reason). These three columns say which licence, from whom, and until
-- when. Nothing in the platform reads the expiry to enforce anything; it is on
-- the invoice and in front of the owner because a lapsed licence is a thing a
-- practice must notice by itself.
--
-- **Snapshots, again.** `invoice` gains a column per new fact and the
-- before-insert trigger fills them at numbering time, exactly as it already
-- does for the legal name, the TRN and the address (402_billing_document.sql):
-- an issued invoice can never be updated, so it must carry what was true on
-- the day. The five new columns are nullable with no default, so an invoice
-- issued before this migration says nothing rather than claiming false.
--
-- **Who may change any of it.** `app.guard_tenant_identity()`, a before-update
-- trigger in the pattern of `app.guard_location_notes()` (100) and migration
-- 903's write floor under `document`: row security asks which rows, and this
-- asks who is acting. Only an owner or an admin may edit the practice's own
-- identity. Like both of those guards it stands aside when no role is stamped,
-- so a migration, the seed and the runner still write as the table owner.
--
-- Audited classification is untouched: `tenant` and `invoice` already carry
-- the audit trigger and their `comment on table` lines, and new columns on an
-- audited table are audited by construction.
--
-- Needs: 010 (tenant), 030 (location — the trigger reads the studio's
-- display_address), 080 (app.audit_row, already on both tables),
-- 402 (invoice and app.stamp_invoice_supplier: this migration extends that
-- trigger rather than adding a second one, and names the dependency here
-- rather than assuming its own number is higher — docs/SPEC/OWNERSHIP.md,
-- "Apply order across these ranges is not fixed").

------------------------------------------------------------------------------
-- 1. The practice's identity.
------------------------------------------------------------------------------
alter table tenant
  add column legal_name_ar       text,
  add column licence_number      text,
  add column licensing_authority text,
  add column licence_expires_on  date,
  add column vat_registered      boolean not null default false,
  add column vat_trn             text;

-- Fifteen digits is the Federal Tax Authority's format, and the number is
-- printed on every invoice the practice issues, so a typo is worth refusing
-- at the column rather than discovering on a tax return.
alter table tenant add constraint tenant_vat_trn_fifteen_digits
  check (vat_trn is null or vat_trn ~ '^[0-9]{15}$');

-- A practice that says it is VAT registered and cannot say under what number
-- would print an invoice claiming a registration it does not name.
alter table tenant add constraint tenant_vat_registration_has_a_number
  check (not vat_registered or vat_trn is not null);

comment on column public.tenant.trn is
  'The tax registration number the practice holds today, which is a corporate-tax '
  'one. Not the VAT number: that is vat_trn, and it exists only while '
  'vat_registered is true (migration 905, docs/SPEC/billing.md section 5.1).';
comment on column public.tenant.vat_registered is
  'Whether the practice is registered for VAT. False until the AED 375,000 threshold '
  'is crossed and the registration is granted; invoices carry VAT only while it is true.';
comment on column public.tenant.vat_trn is
  'The VAT registration number printed on a tax invoice as the supplier''s VAT number. '
  'Fifteen digits, and required while vat_registered is true.';
comment on column public.tenant.licence_expires_on is
  'When the trade licence lapses. Read by nobody as a gate: it is printed and shown, '
  'because noticing is the practice''s own job.';

------------------------------------------------------------------------------
-- 2. What an invoice snapshots of all that.
------------------------------------------------------------------------------
alter table invoice
  add column supplier_legal_name_ar       text,
  add column supplier_licence_number      text,
  add column supplier_licensing_authority text,
  add column supplier_vat_registered      boolean,
  add column supplier_vat_trn             text;

comment on column public.invoice.supplier_vat_registered is
  'Whether the practice was registered for VAT on the day this invoice was numbered. '
  'Null on an invoice issued before migration 905: unknown, never false.';

------------------------------------------------------------------------------
-- 3. The stamp, extended. Same trigger, same before-insert moment, same rule
--    that a value already supplied is left alone — which is what lets a
--    correction pass its own snapshot in.
------------------------------------------------------------------------------
create or replace function app.stamp_invoice_supplier() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_name      text;
  v_name_ar   text;
  v_trn       text;
  v_address   text;
  v_licence   text;
  v_authority text;
  v_vat_reg   boolean;
  v_vat_trn   text;
begin
  if new.supplier_legal_name is not null then
    return new;
  end if;
  select t.legal_name, t.legal_name_ar, t.trn, l.display_address,
         t.licence_number, t.licensing_authority, t.vat_registered, t.vat_trn
    into v_name, v_name_ar, v_trn, v_address,
         v_licence, v_authority, v_vat_reg, v_vat_trn
    from public.tenant t
    left join public.location l on l.id = t.location_id
   where t.id = new.tenant_id;
  new.supplier_legal_name           := v_name;
  new.supplier_legal_name_ar        := coalesce(new.supplier_legal_name_ar, v_name_ar);
  new.supplier_trn                  := coalesce(new.supplier_trn, v_trn);
  new.supplier_address              := coalesce(new.supplier_address, v_address);
  new.supplier_licence_number       := coalesce(new.supplier_licence_number, v_licence);
  new.supplier_licensing_authority  := coalesce(new.supplier_licensing_authority, v_authority);
  new.supplier_vat_registered       := coalesce(new.supplier_vat_registered, v_vat_reg);
  new.supplier_vat_trn              := coalesce(new.supplier_vat_trn, v_vat_trn);
  return new;
end
$$;
revoke execute on function app.stamp_invoice_supplier() from public;

------------------------------------------------------------------------------
-- 4. Who may edit the practice's identity: an owner or an admin, nobody else.
------------------------------------------------------------------------------
create function app.guard_tenant_identity() returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if app.actor_has_role('owner') or app.actor_has_role('admin') then
    return new;
  end if;

  -- No role stamped: a migration, the seed, or the runner as table owner.
  -- The same standing-aside app.guard_location_notes() and migration 903's
  -- document guard do, and for the same reason.
  if nullif(current_setting('app.actor_roles', true), '') is null then
    return new;
  end if;

  raise exception 'the practice''s own details are the owner''s to change'
    using errcode = 'insufficient_privilege',
          hint    = 'Only an owner or an admin may edit the practice''s identity, '
                    'its licence or its VAT registration.';
end
$$;
revoke execute on function app.guard_tenant_identity() from public;
create trigger guard_tenant_identity before update on public.tenant
  for each row execute function app.guard_tenant_identity();

-- rollback:
--   drop trigger if exists guard_tenant_identity on public.tenant;
--   drop function if exists app.guard_tenant_identity();
--   -- The stamp goes back to 402's three columns. Written out rather than
--   -- named, because `create or replace` has no undo of its own.
--   create or replace function app.stamp_invoice_supplier() returns trigger
--   language plpgsql security definer
--   set search_path = pg_catalog, pg_temp
--   as $fn$
--   declare
--     v_name    text;
--     v_trn     text;
--     v_address text;
--   begin
--     if new.supplier_legal_name is not null then
--       return new;
--     end if;
--     select t.legal_name, t.trn, l.display_address
--       into v_name, v_trn, v_address
--       from public.tenant t
--       left join public.location l on l.id = t.location_id
--      where t.id = new.tenant_id;
--     new.supplier_legal_name := v_name;
--     new.supplier_trn        := coalesce(new.supplier_trn, v_trn);
--     new.supplier_address    := coalesce(new.supplier_address, v_address);
--     return new;
--   end
--   $fn$;
--   alter table invoice
--     drop column if exists supplier_vat_trn,
--     drop column if exists supplier_vat_registered,
--     drop column if exists supplier_licensing_authority,
--     drop column if exists supplier_licence_number,
--     drop column if exists supplier_legal_name_ar;
--   alter table tenant drop constraint if exists tenant_vat_registration_has_a_number;
--   alter table tenant drop constraint if exists tenant_vat_trn_fifteen_digits;
--   alter table tenant
--     drop column if exists vat_trn,
--     drop column if exists vat_registered,
--     drop column if exists licence_expires_on,
--     drop column if exists licensing_authority,
--     drop column if exists licence_number,
--     drop column if exists legal_name_ar;
--   -- Dropping these discards what every invoice issued since said about the
--   -- practice. The invoice rows themselves are append-only and survive; the
--   -- five facts they carried do not come back.
