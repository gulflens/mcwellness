-- 413_document_locale.sql
-- An invoice and a receipt are each in one language, fixed when they are issued.
--
-- The operator's decision of 15 October 2026: no document the practice
-- produces carries both English and Arabic. Each is in the client's language
-- (`client.preferred_locale`, migration 060), and the whole page is laid out in
-- it (`domain/billing/document`, docs/CHANGE-REQUESTS/docfix-03.md).
--
-- **Why a column and not a read of the client at render time.** An issued
-- invoice is append-only, and a filed document is recovered by rendering it
-- again from its row and comparing the hash its `document` row holds
-- (`app/api/billing/documents.ts`). A client who changes their language next
-- year must not change the language of last year's invoice, so the language
-- is the row's own, written once, at issue, and never again.
--
-- **Null means "issued before this file".** Every invoice and payment already
-- on a database was rendered in both languages and filed so. Giving those rows
-- a language would make the renderer draw them in one, and their filed bytes
-- could then never be re-made: a lost file would answer
-- `document_bytes_differ` for ever. So the existing rows stay null, and the
-- renderer draws a null row in both languages, exactly as it was filed. No
-- default, no backfill.
--
-- **Every new row gets one**, whoever writes it — the sale routes, the
-- single-session sale, the payment route and the call-out fee trigger
-- (`app.billing_on_appointment_charged`, 408) alike — because the language is
-- set by a trigger before insert rather than by each writer: what the writer
-- said, else the client's preferred language, else English. A writer that
-- forgets cannot leave a new row in both languages.
--
-- **And once written it does not move.** An update that changes `locale` is
-- refused, in either direction: a language given to a row that had none would
-- redraw a filed document as surely as a changed one (CLAUDE.md rule 7).
--
-- Needs: 060 (client.preferred_locale, the `locale` type), 402 (invoice,
-- payment).

------------------------------------------------------------------------------
-- 1. The columns. Nullable, no default: null is "issued in both languages".
------------------------------------------------------------------------------
alter table public.invoice add column locale locale;
alter table public.payment add column locale locale;

comment on column public.invoice.locale is
  'The one language the invoice is set in, fixed at issue from client.preferred_locale. '
  'Null on an invoice issued before 15 October 2026, which is set in both.';
comment on column public.payment.locale is
  'The one language the receipt is set in, fixed at issue from client.preferred_locale. '
  'Null on a payment recorded before 15 October 2026, whose receipt is set in both.';

------------------------------------------------------------------------------
-- 2. Set at insert: what the writer said, else the client's own language.
------------------------------------------------------------------------------
create or replace function app.document_locale_from_client() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if new.locale is null then
    select c.preferred_locale into new.locale
      from public.client c
     where c.id = new.client_id and c.tenant_id = new.tenant_id;
    new.locale := coalesce(new.locale, 'en'::public.locale);
  end if;
  return new;
end;
$$;
revoke execute on function app.document_locale_from_client() from public;

create trigger document_locale_from_client before insert on public.invoice
  for each row execute function app.document_locale_from_client();
create trigger document_locale_from_client before insert on public.payment
  for each row execute function app.document_locale_from_client();

------------------------------------------------------------------------------
-- 3. Never changed once the row exists.
------------------------------------------------------------------------------
create or replace function app.guard_document_locale() returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if new.locale is distinct from old.locale then
    raise exception 'A document''s language is fixed when it is issued.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke execute on function app.guard_document_locale() from public;

create trigger guard_document_locale before update on public.invoice
  for each row execute function app.guard_document_locale();
create trigger guard_document_locale before update on public.payment
  for each row execute function app.guard_document_locale();

-- rollback:
--   drop trigger if exists guard_document_locale on public.payment;
--   drop trigger if exists guard_document_locale on public.invoice;
--   drop function if exists app.guard_document_locale();
--   drop trigger if exists document_locale_from_client on public.payment;
--   drop trigger if exists document_locale_from_client on public.invoice;
--   drop function if exists app.document_locale_from_client();
--   alter table public.payment drop column if exists locale;
--   alter table public.invoice drop column if exists locale;
