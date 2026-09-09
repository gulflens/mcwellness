-- 916_enquiry.sql
-- Needs: 000 (tenant), 010 (app_user), 060 (client, app.set_updated_at),
--        090 (the API role's grants), 095 (app.actor_has_role,
--        app.current_tenant_id)
--
-- Where the website's enquiries land: the practice system's first public
-- write path (docs/superpowers/specs/2026-09-09-enquiries-design.md).
--
-- **A quarantine, not a client.** The endpoint that fills this table has no
-- signed-in person behind it — a stranger on the internet pressed Send. So an
-- enquiry lands here and nowhere else, and a person on the practice's side
-- turns it into a lead or dismisses it. Writing straight into `client` would
-- let anyone create records in the practice system.
--
-- **Outside the audit trail until a person touches it** — the operator's
-- Option B, 9 September 2026. Every absolute rule that touches client data
-- assumes an authenticated actor; a public write has none. So this table
-- carries no `created_by` and no audit trigger, and both are declared as
-- exemptions in .claude/rules/data-model.md. The moment a person reads the
-- list, that read is logged under their name (app/api/enquiries), and the
-- client row a conversion creates is audited from its first byte.
--
-- **Kept until actioned, then scrubbed.** The operator's rule is that an
-- enquiry stays until it is converted or dismissed. Once it is, the personal
-- fields go and the row keeps only what happened: when, from which form, what
-- was done, by whom, and which client — enforced by the two check constraints
-- below rather than by a route remembering to.
--
-- Trunk core range (900–949): a new table streams may build on.
create table enquiry (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenant (id),
  received_at     timestamptz not null default now(),
  source          text not null check (source in ('website', 'discovery_call')),
  -- The person, as the form gave them. Null once actioned.
  name            text,
  whatsapp_e164   text,
  email           text,
  area            text,
  message         text,
  -- The discovery-call form's three answers; the widget sends none.
  concern         text,
  preferred_time  text,
  contact_method  text,
  -- Three-valued: a form with no consent box sends nothing, and that is
  -- "never asked", not a refusal. Only an actual tick is true.
  consent         boolean,
  -- sha256 of the caller's address, for the budget in app.lodge_enquiry.
  -- Pseudonymous, and scrubbed with the rest.
  ip_hash         text,
  status          text not null default 'new' check (status in ('new', 'converted', 'dismissed')),
  actioned_at     timestamptz,
  actioned_by     uuid references app_user (id),
  client_id       uuid references client (id),
  dismiss_reason  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- A new enquiry is a person who can be rung.
  constraint enquiry_new_is_complete check (
    status <> 'new' or (name is not null and whatsapp_e164 is not null and ip_hash is not null)
  ),
  -- An actioned one keeps nothing about them.
  constraint enquiry_actioned_is_scrubbed check (
    status = 'new' or (
      name is null and whatsapp_e164 is null and email is null and area is null
      and message is null and concern is null and preferred_time is null
      and contact_method is null and ip_hash is null
      and actioned_at is not null and actioned_by is not null
    )
  ),
  constraint enquiry_converted_names_client check (status <> 'converted' or client_id is not null),
  constraint enquiry_dismissed_has_reason check (status <> 'dismissed' or dismiss_reason is not null),
  -- The (tenant_id, id) key every tenant-scoped table carries (099), so a
  -- composite foreign key can one day name a row and its tenant together.
  constraint enquiry_tenant_id_id_key unique (tenant_id, id)
);

comment on table enquiry is
  'unaudited by decision: a public write with no actor (Option B, 2026-09-09); '
  'reads are logged by the route, and the client a conversion creates is audited';

create index enquiry_tenant_status_received_idx on enquiry (tenant_id, status, received_at desc);
create index enquiry_ip_hash_received_idx on enquiry (ip_hash, received_at desc) where status = 'new';

create trigger set_updated_at before update on enquiry
  for each row execute function app.set_updated_at();

alter table enquiry enable row level security;
-- Select and update only. There is no insert grant on purpose: the one way in
-- is the definer below, and the API role never inserts here directly.
grant select, update on enquiry to app_role;

-- The door. Resolves the practice — exactly one tenant, or nothing is lodged;
-- refuses the sixth lodging from one address in ten minutes; inserts. It
-- answers null for every refusal, and the route answers that null exactly as
-- it answers success: a form that says "you have been rate limited" tells a
-- script what to change, and one that says "thank you" tells it nothing.
create function app.lodge_enquiry(p jsonb) returns uuid
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_tenant uuid;
  v_recent integer;
  v_id     uuid;
begin
  if (select count(*) from public.tenant) <> 1 then
    return null;
  end if;
  select id into v_tenant from public.tenant limit 1;

  select count(*) into v_recent
    from public.enquiry
   where ip_hash = p->>'ip_hash'
     and received_at > now() - interval '10 minutes';
  if v_recent >= 5 then
    return null;
  end if;

  insert into public.enquiry (
    tenant_id, source, name, whatsapp_e164, email, area, message,
    concern, preferred_time, contact_method, consent, ip_hash
  ) values (
    v_tenant,
    p->>'source',
    p->>'name',
    p->>'whatsapp_e164',
    nullif(p->>'email', ''),
    nullif(p->>'area', ''),
    nullif(p->>'message', ''),
    nullif(p->>'concern', ''),
    nullif(p->>'preferred_time', ''),
    nullif(p->>'contact_method', ''),
    (p->>'consent')::boolean,
    p->>'ip_hash'
  )
  returning id into v_id;
  return v_id;
end
$$;
revoke execute on function app.lodge_enquiry(jsonb) from public;
grant execute on function app.lodge_enquiry(jsonb) to app_role;

-- rollback:
--   drop function if exists app.lodge_enquiry(jsonb);
--   drop table if exists enquiry;
--   -- and remove db/policies/enquiry/*.sql, which the runner re-applies and
--   -- which name the table.
