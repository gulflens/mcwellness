-- 601_report_delivery.sql
-- Every time a report was put in front of a household
-- (docs/SPEC/reports-v1.md sections 6 and 7.2).
--
-- **Why this is a table and not two columns on `report`.** The draft of this
-- specification put `delivered_to_contact_ids` and `delivered_at` on the row
-- itself. A delivery is a fact that happens *after* issue, and an issued row is
-- immutable, so writing a delivery onto it contradicts the rule the row exists
-- to keep — the same fault migration 407 found in `invoice.document_id`, seen
-- early this time. A delivery is also plural: the same report goes to a mother
-- and a father, on different days, through different doors, and a column can
-- hold one of those.
--
-- **The composite key binds the contact to the report's own client.** A
-- delivery names the client as well as the report and the contact, and both
-- foreign keys carry it, so a contact id from another household cannot be
-- filed against this household's report — refused at insert time by the key
-- rather than caught later by a query that happens to filter.
--
-- That needs `contact` to declare (tenant_id, id, client_id) unique, which it
-- does not today: 099 gave every core table (tenant_id, id) for exactly this
-- purpose and the client-scoped form was not needed until now. It is added
-- here, and it is additive and unfailable — `id` is already the primary key,
-- so the wider key is a superset of one that already holds — but it *is* a
-- change to a core table from a stream's range, and it is written up in
-- `docs/CHANGE-REQUESTS/reports-01.md` so the integrator can move it into the
-- trunk's own range if it belongs there. `invoice` declares the same key for
-- the same reason (402, `invoice_tenant_id_client_key`).
--
-- **What the trail carries.** The contact's id and the channel, and never the
-- number and never the address (section 7.2, docs/SPEC/audit.md section 8).
-- The route writes that row through `logAction`, which refuses a value that
-- reads as a telephone number before the insert runs.
--
-- Needs: 010 (tenant), 020 (app_user), 060 (client, contact), 080
-- (app.audit_row), 099 (the tenant-scoped keys), 600 (report).

create type report_delivery_channel as enum ('whatsapp', 'email');

-- The client-scoped key this table's contact foreign key needs. A superset of
-- the primary key, so it can never fail on existing data.
alter table public.contact add constraint contact_tenant_id_client_key
  unique (tenant_id, id, client_id);

create table report_delivery (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant (id),
  report_id    uuid not null,
  -- Denormalised so the audit trigger attributes the row to a client without a
  -- join (097), and bound to the report's *and* the contact's own client by
  -- the two composite keys below, so it can never name a different one.
  client_id    uuid not null references client (id),
  contact_id   uuid not null,
  channel      report_delivery_channel not null,
  sent_at      timestamptz not null default now(),
  sent_by      uuid references app_user (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references app_user (id),
  unique (tenant_id, id),
  foreign key (tenant_id, report_id, client_id) references report (tenant_id, id, client_id),
  foreign key (tenant_id, contact_id, client_id) references contact (tenant_id, id, client_id)
);
comment on table public.report_delivery is 'audited: client';
create index report_delivery_report_idx on report_delivery (tenant_id, report_id, sent_at desc);
create index report_delivery_client_idx on report_delivery (client_id);
create index report_delivery_contact_idx on report_delivery (contact_id);
create index report_delivery_sent_by_idx on report_delivery (sent_by);
create index report_delivery_created_by_idx on report_delivery (created_by);

comment on column public.report_delivery.contact_id is
  'Who the report was handed to. The id, never the number and never the address: those '
  'are on the contact row, and the trail is kept five years and read by people who have '
  'no business knowing how to reach a family (docs/SPEC/audit.md section 8).';

create trigger set_updated_at before update on report_delivery
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on public.report_delivery
  for each row execute function app.audit_row();
alter table public.report_delivery enable always trigger audit_row;

------------------------------------------------------------------------------
-- A delivery happened. It is not edited and it is not withdrawn: the record
-- of what a household received is the whole point of the table.
------------------------------------------------------------------------------
create function app.guard_report_delivery_write() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  -- An erasure takes the deliveries with the report's narrative and its bytes
  -- (migration 107): what the household received is about the household.
  if exists (select 1 from app.erasure_active where txid = txid_current()) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'a delivery is a record of what a household received and is not removed'
      using errcode = 'restrict_violation';
  end if;
  raise exception 'a delivery is a record of what a household received and is not changed'
    using errcode = 'restrict_violation',
          hint    = 'Send it again; that is another delivery.';
end
$$;
revoke execute on function app.guard_report_delivery_write() from public;
create trigger guard_report_delivery_write before update or delete on public.report_delivery
  for each row execute function app.guard_report_delivery_write();
alter table public.report_delivery enable always trigger guard_report_delivery_write;

------------------------------------------------------------------------------
-- Whether a report has ever been handed to anybody.
--
-- security definer, and that is the point of it rather than a convenience: the
-- household's own read policy on `report` admits a superseded version only
-- where one was actually sent, and asking that as a subquery over
-- `report_delivery` — whose own policies read `report` — is a policy loop
-- Postgres refuses at query time. This reads the table directly, as
-- `app.actor_is_contact_of` reads `contact`, and answers nothing but yes or no.
------------------------------------------------------------------------------
create function app.report_was_delivered(p_report_id uuid) returns boolean
language sql security definer stable
set search_path = pg_catalog, pg_temp
as $$
  select exists (
    select 1 from public.report_delivery d
     where d.tenant_id = app.current_tenant_id() and d.report_id = p_report_id
  );
$$;
revoke execute on function app.report_was_delivered(uuid) from public;
grant execute on function app.report_was_delivered(uuid) to app_role;

------------------------------------------------------------------------------
-- Privileges. Select and insert; never update, never delete. A delivery
-- happened or it did not.
------------------------------------------------------------------------------
do $$
declare
  has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
                       and exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  alter table public.report_delivery enable row level security;
  revoke all on public.report_delivery from public;
  if has_api_roles then
    revoke all on public.report_delivery from anon, authenticated;
  end if;
  grant select, insert on public.report_delivery to app_role;
end
$$;

-- rollback:
--   revoke select, insert on public.report_delivery from app_role;
--   drop function if exists app.report_was_delivered(uuid);
--   drop trigger if exists guard_report_delivery_write on public.report_delivery;
--   drop function if exists app.guard_report_delivery_write();
--   drop trigger if exists audit_row on public.report_delivery;
--   drop table if exists report_delivery;
--   alter table public.contact drop constraint if exists contact_tenant_id_client_key;
--   drop type if exists report_delivery_channel;
