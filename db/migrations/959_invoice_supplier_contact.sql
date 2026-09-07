-- 959_invoice_supplier_contact.sql
-- What an invoice snapshots of the practice's contact details
-- (912, and docs/SPEC/billing.md section 5.6).
--
-- **Why they are snapshotted at all.** Everything a rendered document says
-- about the supplier comes off the invoice's own `supplier_*` columns and
-- never off the live `tenant` row — that is the whole point of the snapshot
-- (402, 905, and docs/CHANGE-REQUESTS/trunk-notes.md round 20 request 1c).
-- A footer is no different from a legal name: an invoice issued last year
-- must keep saying the number the practice answered on last year, and a
-- practice that changes its telephone must not silently rewrite what it has
-- already handed a family.
--
-- **The stamp is replaced whole, and 905's is the reference.** It gains three
-- lines and changes nothing else: the same before-insert trigger, the same
-- security definer, the same rule that a value already supplied is left alone
-- so a correction can pass its own snapshot in, and the same two checks
-- underneath it worded as sentences. `create or replace` has no undo, so
-- 905's own text is written out in the rollback block below.
--
-- **No check constraints on the three columns.** `tenant` checks them at the
-- point a person types them (912); an invoice copies what was there. A
-- constraint here would refuse to number an invoice for a practice whose
-- footer has a typo in it, which is a charge the family still owes and a visit
-- that has already happened. The two constraints this table does carry are
-- about the VAT registration, where a false statement is the thing the
-- Federal Tax Authority reads an invoice to find; a telephone number is not
-- that.
--
-- Trunk range, second half (950-999): it alters `invoice`, a stream's own
-- table, so it must sort last (docs/SPEC/OWNERSHIP.md).
--
-- Needs: 402 (invoice, app.stamp_invoice_supplier), 905 (the version of that
--        function this one replaces), 912 (the tenant columns it copies).

alter table invoice
  add column supplier_contact_phone text,
  add column supplier_contact_email text,
  add column supplier_website       text;

comment on column public.invoice.supplier_contact_phone is
  'The telephone number the practice answered on when this invoice was numbered, '
  'printed in the document''s footer. Copied from tenant.contact_phone at numbering '
  'time and never read back from it (migration 959).';
comment on column public.invoice.supplier_contact_email is
  'The email address the practice gave when this invoice was numbered, printed in '
  'the document''s footer (migration 959).';
comment on column public.invoice.supplier_website is
  'The practice''s website as at numbering, printed in the document''s footer '
  '(migration 959).';

------------------------------------------------------------------------------
-- The stamp, extended. Same trigger, same before-insert moment, same rule that
-- a value already supplied is left alone.
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
  v_phone     text;
  v_email     text;
  v_website   text;
begin
  -- A row that already names its supplier is a correction passing its own
  -- snapshot in, and is left alone — but only the *stamping* is skipped. The
  -- checks below run on every insert, whichever way the values arrived, so
  -- the early return can never be the way round them.
  if new.supplier_legal_name is null then
    select t.legal_name, t.legal_name_ar, t.trn, l.display_address,
           t.licence_number, t.licensing_authority, t.vat_registered, t.vat_trn,
           t.contact_phone, t.contact_email, t.website
      into v_name, v_name_ar, v_trn, v_address,
           v_licence, v_authority, v_vat_reg, v_vat_trn,
           v_phone, v_email, v_website
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
    new.supplier_contact_phone        := coalesce(new.supplier_contact_phone, v_phone);
    new.supplier_contact_email        := coalesce(new.supplier_contact_email, v_email);
    new.supplier_website              := coalesce(new.supplier_website, v_website);
  end if;

  -- The two check constraints 905 added, said again here so a caller gets a
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

-- rollback:
--   -- The stamp goes back to 905's eight columns. Written out rather than
--   -- named, because `create or replace` has no undo of its own.
--   create or replace function app.stamp_invoice_supplier() returns trigger
--   language plpgsql security definer
--   set search_path = pg_catalog, pg_temp
--   as $fn$
--   declare
--     v_name      text;
--     v_name_ar   text;
--     v_trn       text;
--     v_address   text;
--     v_licence   text;
--     v_authority text;
--     v_vat_reg   boolean;
--     v_vat_trn   text;
--   begin
--     if new.supplier_legal_name is null then
--       select t.legal_name, t.legal_name_ar, t.trn, l.display_address,
--              t.licence_number, t.licensing_authority, t.vat_registered, t.vat_trn
--         into v_name, v_name_ar, v_trn, v_address,
--              v_licence, v_authority, v_vat_reg, v_vat_trn
--         from public.tenant t
--         left join public.location l on l.id = t.location_id
--        where t.id = new.tenant_id;
--       new.supplier_legal_name           := v_name;
--       new.supplier_legal_name_ar        := coalesce(new.supplier_legal_name_ar, v_name_ar);
--       new.supplier_trn                  := coalesce(new.supplier_trn, v_trn);
--       new.supplier_address              := coalesce(new.supplier_address, v_address);
--       new.supplier_licence_number       := coalesce(new.supplier_licence_number, v_licence);
--       new.supplier_licensing_authority  := coalesce(new.supplier_licensing_authority, v_authority);
--       new.supplier_vat_registered       := coalesce(new.supplier_vat_registered, v_vat_reg);
--       new.supplier_vat_trn              := coalesce(new.supplier_vat_trn, v_vat_trn);
--     end if;
--     if new.supplier_vat_trn is not null and new.supplier_vat_trn !~ '^[0-9]{15}$' then
--       raise exception 'a VAT registration number is fifteen digits'
--         using errcode = 'check_violation',
--               hint    = 'supplier_vat_trn is the Federal Tax Authority''s fifteen-digit number.';
--     end if;
--     if new.supplier_vat_trn is not null and new.supplier_vat_registered is not true then
--       raise exception 'an invoice cannot carry a VAT number for a practice that is not registered'
--         using errcode = 'check_violation',
--               hint    = 'Set supplier_vat_registered, or leave supplier_vat_trn null.';
--     end if;
--     return new;
--   end
--   $fn$;
--   revoke execute on function app.stamp_invoice_supplier() from public;
--   alter table invoice
--     drop column if exists supplier_website,
--     drop column if exists supplier_contact_email,
--     drop column if exists supplier_contact_phone;
