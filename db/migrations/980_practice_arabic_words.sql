-- 980_practice_arabic_words.sql
-- The practice's address and licensing authority in Arabic, for a document in Arabic.
--
-- Since the operator's decision of 15 October 2026 a document is in one
-- language, the client's (docs/CHANGE-REQUESTS/docfix-03.md, migration 413).
-- The practice's legal name has an Arabic half (905, `tenant.legal_name_ar`);
-- its address and its licensing authority did not, so an Arabic invoice or
-- report printed both in English. These are the two practice fields that print
-- as words; the licence number, the registrations, the telephone, email and
-- website are codes and addresses a reader keys in, and stay as they are, as
-- the bank's own details do.
--
-- **Where each lives.** The English address is a `location` row
-- (`tenant.location_id -> location.display_address`, 905); a location is a
-- place with a point, and the Arabic is not a second place but the same one
-- said in another language, so it sits on `tenant` beside `legal_name_ar`.
--
-- **Snapshotted, as everything a document says about the practice is.** An
-- invoice copies the practice at insert (`supplier_*`, 402, 905, 959) and a
-- report at issue (`practice_*`, 600), so a document issued last year keeps
-- saying what was true then. These two join each snapshot: stamped by their own
-- triggers, written beside 959's stamp and 600's `app.issue_report` rather
-- than replacing either, so neither function's text moves. A value already
-- supplied is left alone, as 905's stamp leaves one.
--
-- **Nothing invented and nothing backfilled.** The tenant columns start
-- empty: the practice types its own Arabic in Settings › Practice. An Arabic
-- document prints the English value until it does, and the screen says so.
-- Rows written before this file have no Arabic snapshot; a document issued
-- before 15 October 2026 is drawn in both languages from its English columns,
-- exactly as it was filed, and one issued since in English never reads these.
--
-- Trunk range, second half (950-999): it alters `tenant` and two streams'
-- snapshot tables together. 976 is left for the session round 77 reserved it
-- for (docs/CHANGE-REQUESTS/trunk-round-77.md).
--
-- Needs: 402 (invoice), 600 (report), 905 (the practice's identity on tenant).

------------------------------------------------------------------------------
-- 1. The practice's own Arabic, typed in Settings › Practice.
------------------------------------------------------------------------------
alter table public.tenant
  add column address_ar             text,
  add column licensing_authority_ar text;

comment on column public.tenant.address_ar is
  'The practice''s registered address in Arabic, as an Arabic document prints it. '
  'Empty: an Arabic document prints the English address.';
comment on column public.tenant.licensing_authority_ar is
  'The licensing authority''s name in Arabic, as an Arabic document prints it. '
  'Empty: an Arabic document prints the English name.';

------------------------------------------------------------------------------
-- 2. The snapshots.
------------------------------------------------------------------------------
alter table public.invoice
  add column supplier_address_ar             text,
  add column supplier_licensing_authority_ar text;

alter table public.report
  add column practice_address_ar             text,
  add column practice_licensing_authority_ar text;

------------------------------------------------------------------------------
-- 3. An invoice copies them as it is written.
------------------------------------------------------------------------------
create or replace function app.stamp_invoice_supplier_arabic() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_address_ar   text;
  v_authority_ar text;
begin
  select t.address_ar, t.licensing_authority_ar
    into v_address_ar, v_authority_ar
    from public.tenant t
   where t.id = new.tenant_id;
  new.supplier_address_ar             := coalesce(new.supplier_address_ar, v_address_ar);
  new.supplier_licensing_authority_ar := coalesce(new.supplier_licensing_authority_ar, v_authority_ar);
  return new;
end;
$$;
revoke execute on function app.stamp_invoice_supplier_arabic() from public;

create trigger stamp_supplier_arabic before insert on public.invoice
  for each row execute function app.stamp_invoice_supplier_arabic();

------------------------------------------------------------------------------
-- 4. A report copies them at the moment it is issued.
--
--    `app.issue_report` (600) moves a draft to issued and writes the rest of
--    the practice's snapshot in that one update; this trigger fires on that
--    same update, after `guard_report_write` (which lets any change to a
--    draft through) and only on that transition, so an issued row is never
--    touched again by it.
------------------------------------------------------------------------------
create or replace function app.stamp_report_practice_arabic() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_address_ar   text;
  v_authority_ar text;
begin
  if old.status = 'draft' and new.status = 'issued' and new.practice_legal_name is not null then
    select t.address_ar, t.licensing_authority_ar
      into v_address_ar, v_authority_ar
      from public.tenant t
     where t.id = new.tenant_id;
    new.practice_address_ar             := coalesce(new.practice_address_ar, v_address_ar);
    new.practice_licensing_authority_ar :=
      coalesce(new.practice_licensing_authority_ar, v_authority_ar);
  end if;
  return new;
end;
$$;
revoke execute on function app.stamp_report_practice_arabic() from public;

create trigger stamp_practice_arabic before update on public.report
  for each row execute function app.stamp_report_practice_arabic();

-- rollback:
--   drop trigger if exists stamp_practice_arabic on public.report;
--   drop function if exists app.stamp_report_practice_arabic();
--   drop trigger if exists stamp_supplier_arabic on public.invoice;
--   drop function if exists app.stamp_invoice_supplier_arabic();
--   alter table public.report
--     drop column if exists practice_licensing_authority_ar,
--     drop column if exists practice_address_ar;
--   alter table public.invoice
--     drop column if exists supplier_licensing_authority_ar,
--     drop column if exists supplier_address_ar;
--   alter table public.tenant
--     drop column if exists licensing_authority_ar,
--     drop column if exists address_ar;
