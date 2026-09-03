-- 407_billing_rendered_document.sql
-- Where a rendered invoice or receipt is filed.
--
-- **Why not `invoice.document_id`.** 402 left that column nullable and wrote
-- nothing to it, and said the pull request that rendered the PDF would have to
-- decide how a rendered document attaches to a row nobody may update — because
-- `invoice` grants neither update nor delete, by construction, so there is no
-- way to fill it in afterwards. This is that decision: a small table of its own,
-- so the invoice stays append-only and a document can be filed for a row that
-- was written months ago. `invoice.document_id` stays null and nothing writes
-- it; the honest thing would be to drop it, but a merged migration is never
-- edited and dropping a column from another commit's table is not this one's
-- business.
--
-- **One document per invoice, one per payment.** Both by unique index, not by
-- the route's good manners: a document is immutable once filed, and two
-- renderings of the same invoice with different numbers on them is exactly the
-- fault an append-only ledger exists to make impossible. A second attempt finds
-- the first and hands it back.
--
-- **Why filing runs security definer.** `db/policies/client/writers.sql` floors
-- a client document to the owner, an admin or the lead practitioner. Finance
-- records money and may not file a document — which is right for a referral
-- letter or a consent, and wrong for the receipt that has to exist the moment
-- finance records a payment. So the practice files it, not the person, exactly
-- as `app.charge_single_visit` (404) writes an invoice while a practitioner
-- closes a visit. The function is narrow on purpose: it takes an invoice or a
-- payment, reads that row's own client itself, and refuses anything that is not
-- one of its own practice's. A caller cannot name a client, so it cannot be
-- used to file a document against somebody else's record.
--
-- **The bytes are not this migration's.** The document row names a
-- `storage_key`; what is behind it goes through the storage seam
-- (docs/SEAMS.md) from the route, after the commit. Nothing in SQL talks to a
-- store.
--
-- Needs: 010 (tenant), 020 (app_user), 060 (client, document), 080
-- (app.audit_row), 095 (app.actor_has_role), 100 (app.current_actor_id),
-- 402 (invoice, payment).

create type billing_document_kind as enum ('invoice', 'receipt');

create table billing_document (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant (id),
  -- Denormalised so the audit trigger attributes the row to a client without a
  -- join (097), and bound to the named invoice's or payment's own client by the
  -- composite keys below so it can never name a different one.
  client_id    uuid not null references client (id),
  kind         billing_document_kind not null,
  document_id  uuid not null,
  invoice_id   uuid,
  payment_id   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references app_user (id),
  constraint billing_document_names_its_source check (
    case kind
      when 'invoice' then invoice_id is not null and payment_id is null
      when 'receipt' then payment_id is not null and invoice_id is null
    end
  ),
  unique (tenant_id, id),
  unique (tenant_id, document_id),
  foreign key (tenant_id, client_id) references client (tenant_id, id),
  foreign key (tenant_id, document_id) references document (tenant_id, id),
  foreign key (tenant_id, invoice_id, client_id) references invoice (tenant_id, id, client_id),
  foreign key (tenant_id, payment_id) references payment (tenant_id, id)
);
comment on table public.billing_document is 'audited: client';
create index billing_document_tenant_idx on billing_document (tenant_id);
create index billing_document_client_idx on billing_document (client_id);
create index billing_document_document_idx on billing_document (document_id);
create index billing_document_created_by_idx on billing_document (created_by);
-- One rendering per invoice and per payment, ever.
create unique index billing_document_one_per_invoice
  on billing_document (tenant_id, invoice_id) where invoice_id is not null;
create unique index billing_document_one_per_payment
  on billing_document (tenant_id, payment_id) where payment_id is not null;
create trigger set_updated_at before update on billing_document
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on public.billing_document
  for each row execute function app.audit_row();
alter table public.billing_document enable always trigger audit_row;

------------------------------------------------------------------------------
-- Filing one. Writes the `document` row and the link together, or neither.
--
-- `p_retention_until` is the application's arithmetic, never invented here:
-- `documentRetentionUntil` in domain/shared/storage.ts is the one place that
-- decides how long a document is kept, and a financial record keeps five years
-- regardless (CLAUDE.md rule 8).
------------------------------------------------------------------------------
create function app.file_billing_document(
  p_kind            billing_document_kind,
  p_source_id       uuid,
  -- The document's id is the caller's, not a default, because the storage key
  -- is built from it (`tenant/<t>/client/<c>/<d>`, domain/shared/storage.ts) and
  -- the bytes are written under that key. A row whose id the caller did not know
  -- would need the key patched in afterwards, onto a document that is immutable.
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
  v_document_id uuid;
  v_existing    uuid;
begin
  if v_tenant_id is null then
    raise exception 'No practice in context; a document cannot be filed.'
      using errcode = 'invalid_parameter_value';
  end if;

  -- The client comes off the row being rendered, never from the caller. This is
  -- what stops a security definer function from being a way to file a document
  -- against any client at all.
  if p_kind = 'invoice' then
    select client_id into v_client_id from public.invoice
     where tenant_id = v_tenant_id and id = p_source_id;
  else
    select client_id into v_client_id from public.payment
     where tenant_id = v_tenant_id and id = p_source_id;
  end if;
  if v_client_id is null then
    raise exception 'There is no such invoice or payment in this practice.'
      using errcode = 'no_data_found';
  end if;

  -- Already filed: hand back what is there rather than rendering a second
  -- document for the same row.
  select document_id into v_existing from public.billing_document
   where tenant_id = v_tenant_id
     and ((p_kind = 'invoice' and invoice_id = p_source_id)
       or (p_kind = 'receipt' and payment_id = p_source_id));
  if v_existing is not null then
    return v_existing;
  end if;

  insert into public.document (
    id, tenant_id, client_id, kind, storage_key, mime_type, sha256,
    uploaded_by, retention_until, is_immutable, created_by
  ) values (
    p_document_id, v_tenant_id, v_client_id, p_kind::text, p_storage_key,
    'application/pdf', p_sha256, v_actor_id, p_retention_until, true, v_actor_id
  ) returning id into v_document_id;

  insert into public.billing_document (
    tenant_id, client_id, kind, document_id, invoice_id, payment_id, created_by
  ) values (
    v_tenant_id, v_client_id, p_kind, v_document_id,
    case when p_kind = 'invoice' then p_source_id end,
    case when p_kind = 'receipt' then p_source_id end,
    v_actor_id
  );

  return v_document_id;
end
$$;
revoke execute on function app.file_billing_document(
  billing_document_kind, uuid, uuid, text, bytea, timestamptz) from public;
grant execute on function app.file_billing_document(
  billing_document_kind, uuid, uuid, text, bytea, timestamptz) to app_role;

------------------------------------------------------------------------------
-- Privileges. Read only: the one way a row arrives is the function above, and
-- a filed document is never changed or removed (migration 903 says the same of
-- the `document` row it points at).
------------------------------------------------------------------------------
do $$
declare
  has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
                       and exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  alter table public.billing_document enable row level security;
  revoke all on public.billing_document from public;
  if has_api_roles then
    revoke all on public.billing_document from anon, authenticated;
  end if;
  grant select on public.billing_document to app_role;
end
$$;

-- rollback:
--   revoke select on public.billing_document from app_role;
--   drop function if exists app.file_billing_document(
--     billing_document_kind, uuid, uuid, text, bytea, timestamptz);
--   drop trigger if exists audit_row on public.billing_document;
--   drop table if exists billing_document;
--   drop type if exists billing_document_kind;
--   -- The `document` rows and the bytes behind them are not removed here: a
--   -- filed document is immutable and an erasure is what takes one away.
