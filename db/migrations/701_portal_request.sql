-- 701_portal_request.sql
-- What a household asks the practice for (docs/SPEC/client-portal.md sections
-- 3.5 and 6.2).
--
-- Two asks, and only two: withdraw a consent, or erase the record. Neither is
-- carried out by the portal. A row here says a household has asked and when,
-- and the practice does the thing itself through the record's own screens,
-- where a withdrawal is a consent write and an erasure runs app.erase_client
-- with a typed reason. That separation is the whole design: the portal is
-- where a family speaks, not where an irreversible act is triggered by a tap
-- at eleven at night.
--
-- **Append-only, except for the handling.** A request is a statement of fact
-- about a moment; it is never edited afterwards. The guard trigger below lets
-- the three handling columns move and refuses every other change
-- structurally, so a column added later is guarded without anyone remembering
-- to name it. No delete grant at all.
--
-- Needs: 000 (schema app, app.current_tenant_id, app.set_updated_at), 010
-- (tenant), 020 (app_user), 060 (client, contact, consent), 080
-- (app.audit_row), 097 (client_id attribution), 099 (tenant-scoped keys).

create type portal_request_kind as enum ('consent_withdrawal', 'erasure');
create type portal_request_status as enum ('open', 'handled');

create table portal_request (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant (id),
  client_id    uuid not null references client (id),
  -- Who asked. A contact of that client, bound to it by the composite key below.
  contact_id   uuid not null references contact (id),
  kind         portal_request_kind not null,
  -- Which consent, when the ask is to withdraw one. Null for an erasure, and
  -- the check refuses either half of that pair being wrong.
  consent_id   uuid references consent (id),
  -- Optional, and short. Cleaned at the API boundary (app/api/_middleware/text.ts)
  -- and capped there at 200 characters; the column holds the same ceiling so a
  -- write that never went through a route cannot be longer.
  note         text check (note is null or length(btrim(note)) between 1 and 200),
  status       portal_request_status not null default 'open',
  handled_at   timestamptz,
  handled_by   uuid references app_user (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references app_user (id),
  constraint portal_request_names_its_consent check (
    case kind
      when 'consent_withdrawal' then consent_id is not null
      else consent_id is null
    end
  ),
  constraint portal_request_handling_is_whole check (
    case status
      when 'handled' then handled_at is not null
      else handled_at is null and handled_by is null
    end
  ),
  unique (tenant_id, id),
  foreign key (tenant_id, client_id) references client (tenant_id, id),
  foreign key (tenant_id, contact_id) references contact (tenant_id, id),
  foreign key (tenant_id, consent_id) references consent (tenant_id, id)
);
comment on table public.portal_request is 'audited: client - carries client_id directly';

create index portal_request_client_idx on portal_request (client_id, created_at);
create index portal_request_contact_idx on portal_request (contact_id);
create index portal_request_consent_idx on portal_request (consent_id);
create index portal_request_handled_by_idx on portal_request (handled_by);
create index portal_request_created_by_idx on portal_request (created_by);
-- The office's own view: what is still open, most recent first.
create index portal_request_open_idx on portal_request (tenant_id, created_at desc)
  where status = 'open';

create trigger set_updated_at before update on portal_request
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on public.portal_request
  for each row execute function app.audit_row();
alter table public.portal_request enable always trigger audit_row;

------------------------------------------------------------------------------
-- The column boundary. Row security says who may update a request; this says
-- what an update may change. Structural, in the pattern of
-- app.guard_location_notes (100): everything but the handling columns and
-- updated_at is compared as jsonb, so nothing added to this table later slips
-- past a list somebody forgot to extend.
--
-- It stands aside when no role is stamped, exactly as the other guards do: a
-- migration, the seed and the runner write as the table owner, and there is
-- nothing to guard against there.
------------------------------------------------------------------------------
create function app.guard_portal_request() returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if nullif(current_setting('app.actor_roles', true), '') is null then
    return new;
  end if;
  if (to_jsonb(new) - array['status', 'handled_at', 'handled_by', 'updated_at'])
     is distinct from (to_jsonb(old) - array['status', 'handled_at', 'handled_by', 'updated_at'])
  then
    raise exception 'a request records what was asked; only its handling may change'
      using errcode = 'insufficient_privilege',
            hint    = 'Mark a request as handled. What the household asked for is not editable.';
  end if;
  return new;
end
$$;
revoke execute on function app.guard_portal_request() from public;
create trigger guard_portal_request before update on public.portal_request
  for each row execute function app.guard_portal_request();

------------------------------------------------------------------------------
-- Grants. Select, insert and update; never delete. Which rows, and to whom,
-- is db/policies/portal/access.sql.
------------------------------------------------------------------------------
do $$
declare
  has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
                       and exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  alter table public.portal_request enable row level security;
  revoke all on public.portal_request from public;
  if has_api_roles then
    revoke all on public.portal_request from anon, authenticated;
  end if;
  grant select, insert, update on public.portal_request to app_role;
end
$$;

-- rollback:
--   -- Remove db/policies/portal/access.sql from the tree first, as 700's own
--   -- rollback says: the runner re-applies every policy file on each migrate.
--   drop policy if exists tenant_isolation on public.portal_request;
--   drop policy if exists portal_request_readers on public.portal_request;
--   drop policy if exists portal_request_writers on public.portal_request;
--   drop policy if exists portal_request_handlers on public.portal_request;
--   revoke select, insert, update on public.portal_request from app_role;
--   drop trigger if exists guard_portal_request on public.portal_request;
--   drop function if exists app.guard_portal_request();
--   drop trigger if exists audit_row on public.portal_request;
--   drop table if exists portal_request;
--   drop type if exists portal_request_status;
--   drop type if exists portal_request_kind;
