-- 916_enquiry.sql
-- Needs: 000 (app_role, app.set_updated_at), 010 (tenant), 020 (app_user),
--        060 (client), 090 (app_role's usage on public), 099 (the
--        tenant-scoped keys on app_user and client)
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
  actioned_by     uuid,
  client_id       uuid,
  dismiss_reason  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- A new enquiry is a person who can be rung, and nothing has been done yet.
  constraint enquiry_new_is_complete check (
    status <> 'new' or (
      name is not null and whatsapp_e164 is not null and ip_hash is not null
      and actioned_at is null and actioned_by is null and client_id is null and dismiss_reason is null
    )
  ),
  -- An actioned one keeps nothing about them: not even the tick.
  constraint enquiry_actioned_is_scrubbed check (
    status = 'new' or (
      name is null and whatsapp_e164 is null and email is null and area is null
      and message is null and concern is null and preferred_time is null
      and contact_method is null and consent is null and ip_hash is null
      and actioned_at is not null and actioned_by is not null
    )
  ),
  constraint enquiry_converted_names_client check (status <> 'converted' or client_id is not null),
  constraint enquiry_converted_has_no_reason check (status <> 'converted' or dismiss_reason is null),
  constraint enquiry_dismissed_has_reason check (status <> 'dismissed' or dismiss_reason is not null),
  constraint enquiry_dismissed_names_no_client check (status <> 'dismissed' or client_id is null),
  constraint enquiry_reason_length check (dismiss_reason is null or length(dismiss_reason) between 1 and 200),
  -- The (tenant_id, id) key every tenant-scoped table carries (099), so a
  -- composite foreign key can one day name a row and its tenant together.
  constraint enquiry_tenant_id_id_key unique (tenant_id, id),
  -- Bound to a person and a client of the same practice (099's keys), so a
  -- cross-tenant id is refused at write time rather than filtered at read.
  constraint enquiry_actioned_by_fkey foreign key (tenant_id, actioned_by) references app_user (tenant_id, id),
  constraint enquiry_client_id_fkey foreign key (tenant_id, client_id) references client (tenant_id, id)
);

comment on table enquiry is
  'unaudited by decision: a public write with no actor (Option B, 2026-09-09); '
  'reads and actions are logged by the route, and the client a conversion creates is audited';

-- Each personal field, and why the practice keeps it until the row is actioned.
comment on column enquiry.name is
  'How the person asked to be addressed when the practice rings back. Required: an enquiry nobody can be rung about is not one.';
comment on column enquiry.whatsapp_e164 is
  'The number to ring or message back on, in E.164. Required, for the same reason.';
comment on column enquiry.email is
  'A second way to reply if the person gave one; the lead''s contact carries it forward. Optional.';
comment on column enquiry.area is
  'Where in the emirates they are, so the office can say whether a home visit reaches them before anyone is rung. Optional.';
comment on column enquiry.message is
  'What they asked, in their words, so the call answers it. Shown on the screen; not carried to the lead. Optional.';
comment on column enquiry.concern is
  'The discovery-call form''s "what brings you" choice, from its fixed list, so the caller opens with the right thing. Optional.';
comment on column enquiry.preferred_time is
  'When they asked to be rung, so the office rings then. Optional.';
comment on column enquiry.contact_method is
  'How they asked to be reached (call, WhatsApp, email), so the office does that and not another. Optional.';
comment on column enquiry.consent is
  'The website form''s tick: "By submitting, you agree to be contacted by McWellness about your enquiry." Records only that the box was ticked (true), left (null) or refused (false). It is not a consent row and no purpose is ever read from it; the practice''s consents are recorded on the client, from the wording filed as documents.';
comment on column enquiry.ip_hash is
  'SHA-256 of the sender''s address under a fixed prefix, for app.lodge_enquiry''s budget only; the address itself is never stored. Null once actioned.';
comment on column enquiry.dismiss_reason is
  'Why the office set it aside, in a few words. The route refuses a reason that carries a number or an address, so nothing personal returns to a scrubbed row.';

create index enquiry_tenant_status_received_idx on enquiry (tenant_id, status, received_at desc);
-- The throttle's own index: its predicate is implied by the function's
-- `ip_hash = ...`, which is what lets the planner use it (an actioned row has
-- no hash, so this is the same set of rows as "new").
create index enquiry_ip_hash_received_idx on enquiry (ip_hash, received_at desc) where ip_hash is not null;
create index enquiry_actioned_by_idx on enquiry (actioned_by) where actioned_by is not null;
create index enquiry_client_idx on enquiry (client_id) where client_id is not null;

create trigger set_updated_at before update on enquiry
  for each row execute function app.set_updated_at();

do $$
declare
  has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
                       and exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  execute 'alter table public.enquiry enable row level security';
  execute 'revoke all on public.enquiry from public';
  if has_api_roles then
    -- Supabase: default privileges grant every new table in public to these roles.
    execute 'revoke all on public.enquiry from anon, authenticated';
  end if;
  -- Select and update only. There is no insert grant on purpose: the one way
  -- in is the definer below, and the API role never inserts here directly.
  execute 'grant select, update on public.enquiry to app_role';
end
$$;

-- The door. Resolves the practice — exactly one tenant, or nothing is lodged;
-- refuses the sixth lodging from one address in ten minutes; inserts. It
-- answers null for every refusal, and the route answers that null exactly as
-- it answers success: a form that says "you have been rate limited" tells a
-- script what to change, and one that says "thank you" tells it nothing.
create function app.lodge_enquiry(p jsonb) returns uuid
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_tenant uuid;
  v_recent integer;
  v_id     uuid;
begin
  -- The door clamps every field before it gets here; this makes the table's
  -- own guarantee hold whoever the caller is.
  if p is null or pg_column_size(p) > 16384 then
    return null;
  end if;
  if (select count(*) from public.tenant) <> 1 then
    return null;
  end if;
  select id into v_tenant from public.tenant limit 1;

  -- One lodging at a time per address, so a burst cannot all pass the count
  -- before any of them is written.
  perform pg_advisory_xact_lock(hashtext(p->>'ip_hash'));
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
