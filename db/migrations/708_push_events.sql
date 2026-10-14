-- 708_push_events.sql
-- Phone notifications for events (the practice's list of 6 October 2026,
-- items 6 and 7; docs/OPERATOR/2026-10-15-event-notifications.md): a visit
-- booked, moved or called off and a report ready, to the household's adults;
-- a new website enquiry, to the members of staff who can see Enquiries. The
-- plumbing is round 75's (707): the same key pair, the same sealing, the same
-- three push services, delivered from inside the API process once the act
-- that caused it has committed (app/api/portal/push/events.ts).
--
-- Two tables and five functions. Nothing in 707 changes.
--
-- **`push_event`** — every event the practice notified, once: which kind, the
-- id of what it was about (the appointment, the report or the enquiry — by id
-- alone, with no foreign key, because each belongs to another stream and an
-- erasure must never be refused for a notice), to how many people and how
-- many devices, and what the delivery found. **Never a word of what was
-- sent**: the words are the domain's (domain/portal/pushEvents.ts) and are
-- written from the kind and the visit's time at the moment of sending, so the
-- record carries no personal data at all. Unique per kind and subject, so an
-- event is notified once however its trigger arrives. Born with its counts;
-- never edited, except that the delivery's four outcome columns are written
-- once, together (app.guard_push_event). No delete is granted to anybody.
-- `created_by` is null: nobody pressed Send; the act that caused it is on the
-- trail under the person who did it.
--
-- **`staff_push_subscription`** — one browser of one member of staff, to
-- which the new-enquiry notice goes. Kept apart from 707's
-- `push_subscription` on purpose: that table is a household adult's, every
-- one of its functions and policies is written for a household, and a staff
-- device in it would be one `app.push_audience` row away from receiving the
-- households' announcements. The columns carry 707's names (`push_endpoint`,
-- `push_p256dh`, `push_auth`), so 975's `app.audit_redact` already drops them
-- from the trail without a line of this file. The person reads and removes
-- only their own (db/policies/portal/push_events.sql); nobody reads another's.
--
-- **Audited, with no client.** Neither table names a record: an event is
-- recorded by kind, subject id and counts, and a staff browser belongs to a
-- colleague. So each is `audited: no client` (tests/db/audit.test.ts).
--
-- Needs: 000 (schema app, app.current_tenant_id, app.set_updated_at), 010
-- (tenant), 020 (app_user, user_role, locale), 060 (client, contact), 080
-- (app.audit_row), 095 (app.actor_has_role), 100 (app.current_actor_id),
-- 707 (push_subscription, whose devices the household events go to).

create type push_event_kind as enum (
  'visit_booked', 'visit_moved', 'visit_called_off', 'report_ready', 'enquiry_new'
);

------------------------------------------------------------------------------
-- 1. push_event
------------------------------------------------------------------------------
create table push_event (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenant (id),
  kind             push_event_kind not null,
  -- The appointment, report or enquiry it was about. By id alone.
  subject_id       uuid not null,
  recipient_count  integer not null check (recipient_count >= 0),
  device_count     integer not null check (device_count >= recipient_count),
  delivered_count  integer check (delivered_count >= 0),
  gone_count       integer check (gone_count >= 0),
  failed_count     integer check (failed_count >= 0),
  delivered_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references app_user (id),
  unique (tenant_id, id),
  constraint push_event_once unique (tenant_id, kind, subject_id),
  constraint push_event_delivery_together
    check (num_nonnulls(delivered_count, gone_count, failed_count, delivered_at) in (0, 4)),
  constraint push_event_delivery_adds_up
    check (delivered_at is null
           or delivered_count + gone_count + failed_count <= device_count)
);
comment on table public.push_event is
  'audited: no client - every event the practice notified to phones, once: its kind, the id '
  'of what it was about, to how many, and what the delivery found; never its words.';
create index push_event_tenant_created_idx on push_event (tenant_id, created_at);
create index push_event_created_by_idx on push_event (created_by);

create trigger set_updated_at before update on push_event
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on public.push_event
  for each row execute function app.audit_row();
alter table public.push_event enable always trigger audit_row;

create function app.guard_push_event() returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_outcome text[] := array['delivered_count', 'gone_count', 'failed_count', 'delivered_at',
                            'updated_at'];
begin
  if old.delivered_at is not null then
    raise exception 'push event % has been delivered and cannot change', old.id
      using errcode = 'check_violation', hint = 'push_event_delivered';
  end if;
  if (to_jsonb(new) - v_outcome) is distinct from (to_jsonb(old) - v_outcome) then
    raise exception 'a notified event is never edited'
      using errcode = 'check_violation', hint = 'push_event_sent';
  end if;
  return new;
end
$$;
create trigger guard_push_event before update on public.push_event
  for each row execute function app.guard_push_event();

------------------------------------------------------------------------------
-- 2. staff_push_subscription
------------------------------------------------------------------------------
create table staff_push_subscription (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant (id),
  user_id       uuid not null references app_user (id),
  push_endpoint text not null
    constraint staff_push_subscription_endpoint_shape
      check (push_endpoint like 'https://%' and char_length(push_endpoint) <= 2048),
  push_p256dh   text not null
    constraint staff_push_subscription_p256dh_shape
      check (push_p256dh ~ '^[A-Za-z0-9_-]{86,88}={0,2}$'),
  push_auth     text not null
    constraint staff_push_subscription_auth_shape
      check (push_auth ~ '^[A-Za-z0-9_-]{22,24}={0,2}$'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references app_user (id),
  unique (tenant_id, id),
  constraint staff_push_subscription_one_per_device unique (tenant_id, push_endpoint)
);
comment on table public.staff_push_subscription is
  'audited: no client - one browser of one member of staff, to which the practice''s staff '
  'notices (a new website enquiry) are delivered through the browser''s own push service.';
create index staff_push_subscription_user_idx on staff_push_subscription (tenant_id, user_id);
create index staff_push_subscription_created_by_idx on staff_push_subscription (created_by);

create trigger set_updated_at before update on staff_push_subscription
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on public.staff_push_subscription
  for each row execute function app.audit_row();
alter table public.staff_push_subscription enable always trigger audit_row;

------------------------------------------------------------------------------
-- 3. app.staff_subscribe_push(endpoint, p256dh, auth) — this browser, for the
--    member of staff signed in. The roles that can see Enquiries
--    (domain/shared/actor.ts, `enquiry.list`), restated; 42501 otherwise. A
--    browser that was a colleague's becomes this person's, in one call.
------------------------------------------------------------------------------
create function app.staff_subscribe_push(p_endpoint text, p_p256dh text, p_auth text)
returns uuid
language plpgsql volatile security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_actor uuid := app.current_actor_id();
  v_tenant uuid := app.current_tenant_id();
  v_id uuid;
begin
  if v_actor is null or v_tenant is null
     or not (app.actor_has_role('owner') or app.actor_has_role('admin')
             or app.actor_has_role('lead_practitioner')) then
    raise exception 'staff notifications are for the people who see Enquiries'
      using errcode = 'insufficient_privilege', hint = 'push_not_offered';
  end if;
  delete from public.staff_push_subscription s
   where s.tenant_id = v_tenant and s.push_endpoint = p_endpoint and s.user_id <> v_actor;
  insert into public.staff_push_subscription (tenant_id, user_id, push_endpoint, push_p256dh,
                                              push_auth, created_by)
  values (v_tenant, v_actor, p_endpoint, p_p256dh, p_auth, v_actor)
  on conflict (tenant_id, push_endpoint) do update
     set push_p256dh = excluded.push_p256dh, push_auth = excluded.push_auth
  returning id into v_id;
  return v_id;
end
$$;
revoke execute on function app.staff_subscribe_push(text, text, text) from public;
grant execute on function app.staff_subscribe_push(text, text, text) to app_role;

------------------------------------------------------------------------------
-- 4. app.push_event_household_targets(client) — the devices of one record's
--    portal logins, with the facts the domain decides from.
--
--    For the owner and an admin (42501 otherwise) — in practice the event
--    delivery, which runs in the API process after the act's own commit,
--    stamped `admin` with no actor (app/api/portal/push/events.ts). One row
--    per device of every active login holding the `client_contact` role that
--    is a contact of this record, the record not erased: the login's language,
--    every contact row it holds on records not erased (relationship and the
--    client's date of birth, which is how the domain tells a young person's
--    own login), and its own row on this record (relationship, legal guardian
--    or not, the date of birth), which is how it tells who may read a report.
--    domain/portal/pushEvents.ts (`householdEventRecipients`) decides; this
--    function decides nothing. The one place, beside 707's, a household
--    device's address leaves its table, and it leaves to be sealed and posted.
------------------------------------------------------------------------------
create function app.push_event_household_targets(p_client_id uuid)
returns table (subscription_id uuid, user_id uuid, locale locale, push_endpoint text,
               push_p256dh text, push_auth text, contacts jsonb, on_record jsonb)
language plpgsql stable security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if not (app.actor_has_role('owner') or app.actor_has_role('admin')) then
    raise exception 'delivering a notification is the owner''s and an admin''s'
      using errcode = 'insufficient_privilege';
  end if;
  return query
  select s.id, u.id, u.preferred_locale, s.push_endpoint, s.push_p256dh, s.push_auth,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'relationship', oc.relationship::text,
                    'dateOfBirth', to_char(ocl.date_of_birth, 'YYYY-MM-DD'))
                  order by oc.id)
             from public.contact oc
             join public.client ocl on ocl.id = oc.client_id and ocl.tenant_id = oc.tenant_id
            where oc.tenant_id = u.tenant_id and oc.user_id = u.id and ocl.status <> 'erased'
         ), '[]'::jsonb),
         jsonb_build_object('relationship', ct.relationship::text,
                            'isLegalGuardian', ct.is_legal_guardian,
                            'dateOfBirth', to_char(cl.date_of_birth, 'YYYY-MM-DD'))
    from public.contact ct
    join public.client cl on cl.id = ct.client_id and cl.tenant_id = ct.tenant_id
    join public.app_user u on u.id = ct.user_id and u.tenant_id = ct.tenant_id
    join public.push_subscription s on s.user_id = u.id and s.tenant_id = u.tenant_id
   where ct.tenant_id = app.current_tenant_id()
     and ct.client_id = p_client_id
     and cl.status <> 'erased'
     and u.status = 'active'
     and exists (select 1 from public.user_role r
                  where r.user_id = u.id and r.tenant_id = u.tenant_id
                    and r.role::text = 'client_contact')
   order by u.id, s.id;
end
$$;
revoke execute on function app.push_event_household_targets(uuid) from public;
grant execute on function app.push_event_household_targets(uuid) to app_role;

------------------------------------------------------------------------------
-- 5. app.push_event_staff_targets() — every staff browser, with the roles its
--    person holds now. The owner and an admin, as the delivery runs (42501
--    otherwise). Active people only; the domain decides which roles hear of
--    what (`staffEventRecipients`).
------------------------------------------------------------------------------
create function app.push_event_staff_targets()
returns table (subscription_id uuid, user_id uuid, roles text[], push_endpoint text,
               push_p256dh text, push_auth text)
language plpgsql stable security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if not (app.actor_has_role('owner') or app.actor_has_role('admin')) then
    raise exception 'delivering a notification is the owner''s and an admin''s'
      using errcode = 'insufficient_privilege';
  end if;
  return query
  select s.id, u.id,
         coalesce((select array_agg(r.role::text order by r.role)
                     from public.user_role r
                    where r.user_id = u.id and r.tenant_id = u.tenant_id), '{}'::text[]),
         s.push_endpoint, s.push_p256dh, s.push_auth
    from public.staff_push_subscription s
    join public.app_user u on u.id = s.user_id and u.tenant_id = s.tenant_id
   where s.tenant_id = app.current_tenant_id()
     and u.status = 'active'
   order by u.id, s.id;
end
$$;
revoke execute on function app.push_event_staff_targets() from public;
grant execute on function app.push_event_staff_targets() to app_role;

------------------------------------------------------------------------------
-- 6. app.staff_push_subscriptions_gone(ids) — the staff browsers a push
--    service said are no longer there (404 or 410), as 707's
--    app.push_subscriptions_gone does for a household's. The owner and an
--    admin, as the delivery runs. Answers how many went.
------------------------------------------------------------------------------
create function app.staff_push_subscriptions_gone(p_ids uuid[])
returns integer
language plpgsql volatile security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_count integer;
begin
  if not (app.actor_has_role('owner') or app.actor_has_role('admin')) then
    raise exception 'clearing a device is the delivery''s, for the owner and an admin'
      using errcode = 'insufficient_privilege';
  end if;
  delete from public.staff_push_subscription s
   where s.tenant_id = app.current_tenant_id() and s.id = any (p_ids);
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
revoke execute on function app.staff_push_subscriptions_gone(uuid[]) from public;
grant execute on function app.staff_push_subscriptions_gone(uuid[]) to app_role;

------------------------------------------------------------------------------
-- 7. Grants. Which rows, and to whom, is db/policies/portal/push_events.sql.
--    push_event: read, write once, and the delivery's one update; never deleted.
--    staff_push_subscription: read, add, remove — never edited by a person.
------------------------------------------------------------------------------
do $$
declare
  has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
                       and exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  alter table public.push_event enable row level security;
  alter table public.staff_push_subscription enable row level security;
  revoke all on public.push_event, public.staff_push_subscription from public;
  if has_api_roles then
    revoke all on public.push_event, public.staff_push_subscription from anon, authenticated;
  end if;
  grant select, insert, update on public.push_event to app_role;
  grant select, insert, delete on public.staff_push_subscription to app_role;
end
$$;

-- rollback:
--   -- Remove db/policies/portal/push_events.sql from the tree first: the
--   -- runner re-applies every policy file on each migrate, and its policies
--   -- name the two tables dropped below.
--   drop function if exists app.staff_push_subscriptions_gone(uuid[]);
--   drop function if exists app.push_event_staff_targets();
--   drop function if exists app.push_event_household_targets(uuid);
--   drop function if exists app.staff_subscribe_push(text, text, text);
--   drop table if exists staff_push_subscription;
--   drop table if exists push_event;
--   drop function if exists app.guard_push_event();
--   drop type if exists push_event_kind;
