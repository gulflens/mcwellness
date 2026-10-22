-- 418_credit_note_document.sql
-- Where a rendered credit note is filed: the same table, the same one-per-source
-- rule and the same definer function as an invoice's and a receipt's (407).
--
-- **The enum value and its first use are kept apart.** `credit_note` is added to
-- `billing_document_kind` here, and Postgres will not let a value added in a
-- transaction be used in that transaction. So the reworked check constraint
-- compares `kind::text` against text literals (the 408 precedent), and the
-- function body does the same, so nothing below uses the new label as a value.
--
-- **Sending is not part of this.** Nothing here touches `domain/shared/sending`:
-- a credit note's PDF is filed and fetched through a signed link, and the send
-- route refuses the kind (`app/api/billing/documents.ts`).
--
-- Needs: 407 (billing_document and app.file_billing_document), 416
-- (credit_note, and the composite key (tenant_id, id, client_id) it carries).

alter type billing_document_kind add value 'credit_note';

alter table billing_document add column credit_note_id uuid;
alter table billing_document add constraint billing_document_credit_note_fkey
  foreign key (tenant_id, credit_note_id, client_id)
  references credit_note (tenant_id, id, client_id);

-- Each kind names exactly its own source and none of the others.
alter table billing_document drop constraint billing_document_names_its_source;
alter table billing_document add constraint billing_document_names_its_source check (
  case kind::text
    when 'invoice' then invoice_id is not null and payment_id is null and credit_note_id is null
    when 'receipt' then payment_id is not null and invoice_id is null and credit_note_id is null
    when 'credit_note' then credit_note_id is not null and invoice_id is null and payment_id is null
  end
);

create unique index billing_document_one_per_credit_note
  on billing_document (tenant_id, credit_note_id) where credit_note_id is not null;
create index billing_document_credit_note_idx on billing_document (credit_note_id);

create or replace function app.file_billing_document(
  p_kind            billing_document_kind,
  p_source_id       uuid,
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
  v_kind        text := p_kind::text;
  v_client_id   uuid;
  v_document_id uuid;
  v_existing    uuid;
begin
  if v_tenant_id is null then
    raise exception 'No practice in context; a document cannot be filed.'
      using errcode = 'invalid_parameter_value';
  end if;

  -- The client comes off the row being rendered, never from the caller.
  if v_kind = 'invoice' then
    select client_id into v_client_id from public.invoice
     where tenant_id = v_tenant_id and id = p_source_id;
  elsif v_kind = 'receipt' then
    select client_id into v_client_id from public.payment
     where tenant_id = v_tenant_id and id = p_source_id;
  else
    select client_id into v_client_id from public.credit_note
     where tenant_id = v_tenant_id and id = p_source_id;
  end if;
  if v_client_id is null then
    raise exception 'There is no such invoice, payment or credit note in this practice.'
      using errcode = 'no_data_found';
  end if;

  select document_id into v_existing from public.billing_document
   where tenant_id = v_tenant_id
     and ((v_kind = 'invoice' and invoice_id = p_source_id)
       or (v_kind = 'receipt' and payment_id = p_source_id)
       or (v_kind = 'credit_note' and credit_note_id = p_source_id));
  if v_existing is not null then
    return v_existing;
  end if;

  insert into public.document (
    id, tenant_id, client_id, kind, storage_key, mime_type, sha256,
    uploaded_by, retention_until, is_immutable, created_by
  ) values (
    p_document_id, v_tenant_id, v_client_id, v_kind, p_storage_key,
    'application/pdf', p_sha256, v_actor_id, p_retention_until, true, v_actor_id
  ) returning id into v_document_id;

  insert into public.billing_document (
    tenant_id, client_id, kind, document_id, invoice_id, payment_id, credit_note_id, created_by
  ) values (
    v_tenant_id, v_client_id, p_kind, v_document_id,
    case when v_kind = 'invoice' then p_source_id end,
    case when v_kind = 'receipt' then p_source_id end,
    case when v_kind = 'credit_note' then p_source_id end,
    v_actor_id
  );

  return v_document_id;
end
$$;

-- rollback:
--   -- An enum label cannot be dropped; `credit_note` stays on the type, unused.
--   -- Restore 407's function body first, then the column's dependants:
--   drop index if exists billing_document_one_per_credit_note;
--   drop index if exists billing_document_credit_note_idx;
--   alter table billing_document drop constraint if exists billing_document_names_its_source;
--   alter table billing_document drop constraint if exists billing_document_credit_note_fkey;
--   alter table billing_document drop column if exists credit_note_id;
--   alter table billing_document add constraint billing_document_names_its_source check (
--     case kind::text
--       when 'invoice' then invoice_id is not null and payment_id is null
--       when 'receipt' then payment_id is not null and invoice_id is null
--     end
--   );
--   -- (then re-run the create function from 407)
