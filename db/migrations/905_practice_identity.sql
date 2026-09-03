-- 905_practice_identity.sql
-- Who the practice is, and whether it charges VAT.
--
-- **Two tax numbers, not one.** `tenant.trn` already exists and is renamed by
-- nothing here: it is the tax registration number the practice holds today,
-- which is a corporate-tax one. VAT registration is a separate event with a
-- separate number, and it has not happened yet — the threshold is AED 375,000
-- of taxable supplies (docs/SPEC/billing.md section 5.1). So `vat_registered`
-- arrives false and `vat_trn` arrives null. Putting the VAT number in the
-- column that already holds a different number would have been the cheap
-- change and the wrong one: a tax invoice would then carry a corporate-tax
-- registration labelled as a VAT registration, which is exactly the
-- misstatement the Federal Tax Authority reads an invoice to check.
--
-- **What these columns do not yet do.** They record the registration; they do
-- not charge anything. Today every price stamps the standard rate
-- (400_billing_catalogue.sql) and `app.charge_single_visit` (404) writes VAT
-- on every sale, whatever `vat_registered` says. Making the charge and the
-- rendered invoice follow this column is the billing stream's work and is
-- asked for in `docs/CHANGE-REQUESTS/trunk-notes.md` (round 20, request 1).
-- Nothing in this migration, in the settings screen or in their comments may
-- claim otherwise: a column that reads as a switch on VAT while VAT is
-- charged regardless is worse than no column at all.
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
  'is crossed and the registration is granted. This records the fact; as of migration '
  '905 it changes no charge — every price still stamps the standard rate and '
  'app.charge_single_visit writes VAT on every sale (docs/CHANGE-REQUESTS/trunk-notes.md).';
comment on column public.tenant.vat_trn is
  'The VAT registration number to be printed on a tax invoice as the supplier''s VAT '
  'number. Fifteen digits, and required while vat_registered is true.';
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
  'Null on an invoice issued before migration 905: unknown, never false. The renderer '
  'reads this column and never the tenant, so an invoice keeps saying what was true '
  'when it was issued.';
-- Said here exactly as it is said on tenant.trn, because the person who writes
-- the PDF reads this column and not that one, and mislabelling it is the whole
-- risk the two columns exist to remove.
comment on column public.invoice.supplier_trn is
  'The corporate-tax registration number the practice held when this invoice was '
  'numbered. Not the VAT number: that is supplier_vat_trn, and it is set only when '
  'supplier_vat_registered is true. Never print this as a VAT registration number.';
comment on column public.invoice.supplier_vat_trn is
  'The supplier''s VAT registration number as at numbering. Fifteen digits, and '
  'present only on an invoice whose supplier_vat_registered is true.';

-- What the columns are allowed to say together. An invoice is append-only, so
-- these are the only chance to refuse a combination that would render as a
-- false statement to the Federal Tax Authority: a VAT number on an invoice
-- from an unregistered practice, or a number that is not the fifteen digits
-- the authority issues.
alter table invoice add constraint invoice_supplier_vat_trn_fifteen_digits
  check (supplier_vat_trn is null or supplier_vat_trn ~ '^[0-9]{15}$');
alter table invoice add constraint invoice_supplier_vat_trn_needs_registration
  check (supplier_vat_trn is null or supplier_vat_registered);

-- The third constraint this pair obviously wants —
--   check (supplier_vat_registered is null or supplier_vat_registered or vat_fils = 0)
-- — is deliberately NOT here, and it is not an oversight. Today
-- app.charge_single_visit (404) and the package-sale path write VAT on every
-- sale whatever the practice is registered for, so adding it now refuses every
-- charge the platform makes: fourteen tests in tests/billing prove exactly
-- that, which is how this was established rather than argued. The constraint
-- and the behaviour have to land together, in the billing stream's own
-- migration, and `docs/CHANGE-REQUESTS/trunk-notes.md` (round 20, request 1)
-- carries it as the line to add in the same commit that makes the charge
-- follow tenant.vat_registered.


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
  -- A row that already names its supplier is a correction passing its own
  -- snapshot in, and is left alone — but only the *stamping* is skipped. The
  -- checks below run on every insert, whichever way the values arrived, so
  -- the early return can never be the way round them.
  if new.supplier_legal_name is null then
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
  end if;

  -- The two check constraints above, said again here so a caller gets a
  -- sentence naming what is wrong rather than a constraint name, and so a
  -- correction that supplies its own snapshot is held to the same rule as a
  -- stamped one.
  if new.supplier_vat_trn is not null and new.supplier_vat_trn !~ '^[0-9]{15}$' then
    raise exception 'a VAT registration number is fifteen digits'
      using errcode = 'check_violation',
            hint    = 'supplier_vat_trn is the Federal Tax Authority''s fifteen-digit number.';
  end if;
  if new.supplier_vat_trn is not null and new.supplier_vat_registered is not true then
    raise exception 'an invoice cannot carry a VAT number for a practice that is not registered'
      using errcode = 'check_violation',
            hint    = 'Set supplier_vat_registered, or leave supplier_vat_trn null.';
  end if;
  return new;
end
$$;
revoke execute on function app.stamp_invoice_supplier() from public;

------------------------------------------------------------------------------
-- 4. Who may edit the practice's identity: an owner or an admin, nobody else.
--
--    Two tables, because the identity lives in two. `tenant` carries the
--    name, the licence and the registrations; the registered address an
--    invoice snapshots is the tenant's own `location` row, and
--    db/policies/client/writers.sql admits a lead practitioner to every
--    location's insert and update — which is right for a household's address
--    and wrong for the practice's own, since `app.stamp_invoice_supplier`
--    copies `display_address` onto every invoice issued. So the same guard
--    covers a location whose owner_type is 'tenant', and only that one:
--    `app.guard_location_notes` (100) still decides everything about a
--    client's.
------------------------------------------------------------------------------
create function app.guard_tenant_identity() returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  -- On location, only the practice's own address is fenced here — including a
  -- row being moved onto or off the practice, which is why both sides are read.
  -- Nested rather than one condition: plpgsql evaluates a whole boolean as a
  -- single SQL expression, so `new.owner_type` must not be named at all while
  -- the trigger is running on `tenant`, and `old` must not be named on insert.
  if tg_table_name = 'location' then
    if tg_op = 'INSERT' then
      if new.owner_type <> 'tenant' then
        return new;
      end if;
    elsif new.owner_type <> 'tenant' and old.owner_type <> 'tenant' then
      return new;
    end if;
  end if;

  if app.actor_has_role('owner') or app.actor_has_role('admin') then
    return new;
  end if;

  -- No role stamped: a migration, the seed, or the runner as table owner.
  -- The same standing-aside app.guard_location_notes() and migration 903's
  -- document guard do, and for the same reason.
  if nullif(current_setting('app.actor_roles', true), '') is null then
    return new;
  end if;

  if tg_table_name = 'location' then
    raise exception 'the practice''s own address is the owner''s to change'
      using errcode = 'insufficient_privilege',
            hint    = 'Only an owner or an admin may change the address every '
                      'invoice is issued from.';
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
-- Insert as well as update on location: creating the practice's address is
-- the same decision as changing it.
create trigger guard_tenant_identity before insert or update on public.location
  for each row execute function app.guard_tenant_identity();

-- rollback:
--   drop trigger if exists guard_tenant_identity on public.location;
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
--   alter table invoice drop constraint if exists invoice_supplier_vat_trn_needs_registration;
--   alter table invoice drop constraint if exists invoice_supplier_vat_trn_fifteen_digits;
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
