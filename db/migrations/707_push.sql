-- 707_push.sql
-- Phone notifications from the practice: each adult's devices, every message
-- sent, and who it went to (the push memo's decisions 2 and 3,
-- docs/OPERATOR/2026-09-17-push-notifications.md, answered "as recommended"
-- on 6 October 2026; steps 4 and 5 of its "What gets built").
--
-- **Web push.** The portal, on a phone, asks the phone's own push service —
-- Apple's, Google's or Mozilla's, the vendor register's row — for an address
-- to deliver to, and hands that address and two public keys to this server.
-- The server seals each message so the service cannot read it (RFC 8291) and
-- signs each delivery with the practice's own key (RFC 8292). The service
-- learns a device address and the size and timing of a sealed message, never
-- a name, a number or a word of it.
--
-- Three tables.
--
-- **`push_subscription`** — one device of one adult portal login. The person
-- reads and removes only their own (db/policies/portal/push.sql); the
-- practice reads none of them, and learns only how many there are, through
-- `app.push_audience` below. A young person's own login holds none: the
-- portal does not offer the step to them and the insert policy and
-- `app.portal_subscribe_push` both refuse. The columns are named
-- `push_endpoint`, `push_p256dh` and `push_auth`, never the bare words, so a
-- redaction of them in the trail (docs/CHANGE-REQUESTS/client-portal-07.md)
-- can name them without touching any other table's column.
--
-- **`push_message`** — every message sent, once: what it said in both
-- languages, which kind, who sent it (`created_by`) and when (`created_at`),
-- to how many people and how many devices, and — once the delivery has run —
-- how many devices took it, how many the services reported gone and how many
-- failed. Born at the moment of sending; never edited, except that the
-- delivery's four outcome columns are written once, together
-- (app.guard_push_message). No delete is granted to anybody: this is the
-- record the memo's decision 3 asks for, "so the practice can show a
-- regulator, or a household, exactly what it did".
--
-- **`push_recipient`** — one row per person a message went to: who, how many
-- of their devices, and their marketing consent standing at that moment
-- (`on` with the consent row it stood on, or `off`). The text is never copied
-- here: the message row holds it once and every recipient row points at it.
-- Never edited and never deleted.
--
-- **At most two offers a calendar month** is the domain's rule
-- (domain/portal/push.ts, `offersLeft`), which the route asks first; the
-- trigger app.guard_push_offer_ceiling restates it beneath, in the practice's
-- own days, so a third offer cannot be written however it arrives.
--
-- **Audited, with no client.** Each table names a person or a message and no
-- one record: a household adult's devices follow them across every record
-- they are a contact of, and a message is addressed to many. So each is
-- `audited: no client` (tests/db/audit.test.ts).
--
-- Needs: 000 (schema app, app.current_tenant_id, app.set_updated_at), 010
-- (tenant), 020 (app_user, locale), 060 (client, contact, consent), 080
-- (app.audit_row), 095 (app.actor_has_role), 099, 100 (app.current_actor_id),
-- 705 (app.actor_reads_announcements), 706 (the marketing consent).

create type push_kind as enum ('announcement', 'offer');
create type push_consent_standing as enum ('on', 'off');

------------------------------------------------------------------------------
-- 1. push_subscription
------------------------------------------------------------------------------
create table push_subscription (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenant (id),
  user_id       uuid not null references app_user (id),
  -- The push service's own address for this device. https, and one of the
  -- three services on the register — the route asks
  -- domain/portal/push.ts's pushEndpointAllowed before it is stored.
  push_endpoint text not null
    constraint push_subscription_endpoint_shape
      check (push_endpoint like 'https://%' and char_length(push_endpoint) <= 2048),
  -- The device's public key (65 bytes) and its authentication secret (16
  -- bytes), base64url, as the browser hands them over (RFC 8291 section 3).
  push_p256dh   text not null
    constraint push_subscription_p256dh_shape check (push_p256dh ~ '^[A-Za-z0-9_-]{86,88}={0,2}$'),
  push_auth     text not null
    constraint push_subscription_auth_shape check (push_auth ~ '^[A-Za-z0-9_-]{22,24}={0,2}$'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references app_user (id),
  unique (tenant_id, id),
  -- One device, one row: the address is the device.
  constraint push_subscription_one_per_device unique (tenant_id, push_endpoint)
);
comment on table public.push_subscription is
  'audited: no client - one device of one adult portal login, to which the practice''s '
  'notifications are delivered through the phone''s own push service; follows the person '
  'across every record they are a contact of.';
create index push_subscription_user_idx on push_subscription (tenant_id, user_id);
create index push_subscription_created_by_idx on push_subscription (created_by);

create trigger set_updated_at before update on push_subscription
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on public.push_subscription
  for each row execute function app.audit_row();
alter table public.push_subscription enable always trigger audit_row;

------------------------------------------------------------------------------
-- 2. push_message
------------------------------------------------------------------------------
create table push_message (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenant (id),
  kind             push_kind not null,
  -- The domain's lengths (PUSH_TITLE_MAX, PUSH_BODY_MAX), restated.
  title_en         text not null
    constraint push_message_title_en_length check (char_length(btrim(title_en)) between 1 and 60),
  title_ar         text not null
    constraint push_message_title_ar_length check (char_length(btrim(title_ar)) between 1 and 60),
  body_en          text not null
    constraint push_message_body_en_length check (char_length(btrim(body_en)) between 1 and 240),
  body_ar          text not null
    constraint push_message_body_ar_length check (char_length(btrim(body_ar)) between 1 and 240),
  -- How many it was sent to, at the moment of sending.
  recipient_count  integer not null check (recipient_count >= 1),
  device_count     integer not null check (device_count >= recipient_count),
  -- What the delivery found. All four null until it has run, then all four set.
  delivered_count  integer check (delivered_count >= 0),
  gone_count       integer check (gone_count >= 0),
  failed_count     integer check (failed_count >= 0),
  delivered_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid not null references app_user (id),
  unique (tenant_id, id),
  constraint push_message_delivery_together
    check (num_nonnulls(delivered_count, gone_count, failed_count, delivered_at) in (0, 4)),
  constraint push_message_delivery_adds_up
    check (delivered_at is null
           or delivered_count + gone_count + failed_count <= device_count)
);
comment on table public.push_message is
  'audited: no client - every notification the practice sent, once: its words in both '
  'languages, its kind, who sent it and when, to how many, and what the delivery found.';
create index push_message_tenant_created_idx on push_message (tenant_id, created_at);
create index push_message_created_by_idx on push_message (created_by);

create trigger set_updated_at before update on push_message
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on public.push_message
  for each row execute function app.audit_row();
alter table public.push_message enable always trigger audit_row;

------------------------------------------------------------------------------
-- 3. push_recipient
------------------------------------------------------------------------------
create table push_recipient (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenant (id),
  message_id            uuid not null,
  user_id               uuid not null references app_user (id),
  devices               integer not null check (devices >= 1),
  -- The person's marketing consent at the moment of sending, and the row it
  -- stood on, which names the exact wording they agreed to.
  marketing_standing    push_consent_standing not null,
  marketing_consent_id  uuid references consent (id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid references app_user (id),
  unique (tenant_id, id),
  foreign key (tenant_id, message_id) references push_message (tenant_id, id),
  constraint push_recipient_once unique (message_id, user_id),
  constraint push_recipient_standing_names_its_consent
    check ((marketing_standing = 'on') = (marketing_consent_id is not null))
);
comment on table public.push_recipient is
  'audited: no client - one person a notification went to, with their marketing consent '
  'standing at that moment; the words are the message''s, held once.';
create index push_recipient_message_idx on push_recipient (tenant_id, message_id);
create index push_recipient_user_idx on push_recipient (user_id);
create index push_recipient_consent_idx on push_recipient (marketing_consent_id);
create index push_recipient_created_by_idx on push_recipient (created_by);

create trigger set_updated_at before update on push_recipient
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on public.push_recipient
  for each row execute function app.audit_row();
alter table public.push_recipient enable always trigger audit_row;

------------------------------------------------------------------------------
-- 4. app.guard_push_message() — sent once, never edited; the delivery's
--    outcome written once.
------------------------------------------------------------------------------
create function app.guard_push_message() returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  v_outcome text[] := array['delivered_count', 'gone_count', 'failed_count', 'delivered_at',
                            'updated_at'];
begin
  if old.delivered_at is not null then
    raise exception 'push message % has been delivered and cannot change', old.id
      using errcode = 'check_violation', hint = 'push_message_delivered';
  end if;
  if (to_jsonb(new) - v_outcome) is distinct from (to_jsonb(old) - v_outcome) then
    raise exception 'a sent message is never edited'
      using errcode = 'check_violation', hint = 'push_message_sent';
  end if;
  return new;
end
$$;
create trigger guard_push_message before update on public.push_message
  for each row execute function app.guard_push_message();

------------------------------------------------------------------------------
-- 5. app.guard_push_offer_ceiling() — two offers a calendar month.
--
--    The domain's offersLeft, restated for a row that bypassed the route.
--    The month is the practice's own (tenant.timezone). Serialised per
--    practice with a transaction lock, so two offers pressed at once cannot
--    both be the second.
------------------------------------------------------------------------------
create function app.guard_push_offer_ceiling() returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_zone text;
  v_sent integer;
begin
  if new.kind <> 'offer' then
    return new;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('push_message:' || new.tenant_id::text, 0));
  select t.timezone into v_zone from public.tenant t where t.id = new.tenant_id;
  select count(*) into v_sent
    from public.push_message m
   where m.tenant_id = new.tenant_id
     and m.kind = 'offer'
     and date_trunc('month', m.created_at at time zone v_zone)
         = date_trunc('month', new.created_at at time zone v_zone);
  if v_sent >= 2 then
    raise exception 'two offers have already gone this month'
      using errcode = 'check_violation', hint = 'offer_ceiling';
  end if;
  return new;
end
$$;
revoke execute on function app.guard_push_offer_ceiling() from public;
create trigger guard_push_offer_ceiling before insert on public.push_message
  for each row execute function app.guard_push_offer_ceiling();

------------------------------------------------------------------------------
-- 6. app.portal_subscribe_push(endpoint, p256dh, auth) — this device, for the
--    person signed in.
--
--    The address is the device, so a device that was another person's (a
--    shared tablet, signed in as somebody else) becomes this person's: the
--    old row goes and this one is written, in one call. Refused (42501) to
--    anybody but an adult of some household (705's rule, the same one the
--    announcements and the marketing switch ask).
------------------------------------------------------------------------------
create function app.portal_subscribe_push(p_endpoint text, p_p256dh text, p_auth text)
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
     or not app.actor_has_role('client_contact')
     or not app.actor_reads_announcements() then
    raise exception 'notifications are for an adult of a household, on their own portal'
      using errcode = 'insufficient_privilege', hint = 'push_not_offered';
  end if;
  delete from public.push_subscription s
   where s.tenant_id = v_tenant and s.push_endpoint = p_endpoint and s.user_id <> v_actor;
  insert into public.push_subscription (tenant_id, user_id, push_endpoint, push_p256dh,
                                        push_auth, created_by)
  values (v_tenant, v_actor, p_endpoint, p_p256dh, p_auth, v_actor)
  on conflict (tenant_id, push_endpoint) do update
     set push_p256dh = excluded.push_p256dh, push_auth = excluded.push_auth
  returning id into v_id;
  return v_id;
end
$$;
revoke execute on function app.portal_subscribe_push(text, text, text) from public;
grant execute on function app.portal_subscribe_push(text, text, text) to app_role;

------------------------------------------------------------------------------
-- 7. app.push_audience() — who could be sent a message now, as counts and
--    facts and never an address.
--
--    For the owner and an admin (42501 otherwise). One row per active login
--    holding at least one device: how many devices, its contact rows on
--    records not erased (relationship and the client's date of birth, which
--    is all the domain needs to tell a young person's own login), the
--    language it reads in, and its own standing marketing consent, if any —
--    the most recently given of its own rows given with the portal's switch
--    (`portal_switch`, 706), never another adult's on the same record and
--    never a row filed any other way. domain/portal/push.ts (`pushRecipients`) decides from
--    these who receives what; this function decides nothing.
--
--    plpgsql for 706's reason: the consent's new method arrives in 706 and
--    the wording's columns after this file.
------------------------------------------------------------------------------
create function app.push_audience()
returns table (user_id uuid, devices integer, locale locale, contacts jsonb,
               marketing_consent_id uuid)
language plpgsql stable security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if not (app.actor_has_role('owner') or app.actor_has_role('admin')) then
    raise exception 'the audience of a notification is the owner''s and an admin''s'
      using errcode = 'insufficient_privilege';
  end if;
  return query
  select u.id,
         d.devices::integer,
         u.preferred_locale,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'relationship', ct.relationship::text,
                    'dateOfBirth', to_char(cl.date_of_birth, 'YYYY-MM-DD'))
                  order by ct.id)
             from public.contact ct
             join public.client cl on cl.id = ct.client_id and cl.tenant_id = ct.tenant_id
            where ct.tenant_id = u.tenant_id and ct.user_id = u.id and cl.status <> 'erased'
         ), '[]'::jsonb),
         (select cs.id
            from public.consent cs
            join public.contact ct on ct.id = cs.given_by_contact_id
                                  and ct.tenant_id = cs.tenant_id
            join public.client cl on cl.id = cs.client_id and cl.tenant_id = cs.tenant_id
           where cs.tenant_id = u.tenant_id
             and cs.purpose = 'marketing'
             and cs.status = 'active'
             and cs.method = 'portal_switch'
             and ct.user_id = u.id
             and cl.status <> 'erased'
           order by cs.given_at desc, cs.id
           limit 1)
    from public.app_user u
    join (select s.user_id, count(*) as devices
            from public.push_subscription s
           where s.tenant_id = app.current_tenant_id()
           group by s.user_id) d on d.user_id = u.id
   where u.tenant_id = app.current_tenant_id()
     and u.status = 'active'
   order by u.id;
end
$$;
revoke execute on function app.push_audience() from public;
grant execute on function app.push_audience() to app_role;

------------------------------------------------------------------------------
-- 8. app.push_delivery_targets(message) — the devices a sent message goes to.
--
--    For the owner and an admin (42501 otherwise) — in practice the delivery
--    that runs in the API process straight after the send's own commit,
--    stamped as the person who pressed Send (app/api/portal/push/sender.ts).
--    Every device of every recipient the record names; for an offer, only
--    while that person's own marketing consent, given with the portal's
--    switch on a record not erased, still stands — so a withdrawal pressed
--    between the send and the delivery is honoured too. This is the
--    one place a device's address leaves the table, and it leaves to be
--    sealed and posted, never to a screen.
------------------------------------------------------------------------------
create function app.push_delivery_targets(p_message_id uuid)
returns table (subscription_id uuid, user_id uuid, locale locale, push_endpoint text,
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
  select s.id, s.user_id, u.preferred_locale, s.push_endpoint, s.push_p256dh, s.push_auth
    from public.push_message m
    join public.push_recipient r on r.message_id = m.id and r.tenant_id = m.tenant_id
    join public.push_subscription s on s.user_id = r.user_id and s.tenant_id = r.tenant_id
    join public.app_user u on u.id = r.user_id and u.tenant_id = r.tenant_id
   where m.id = p_message_id
     and m.tenant_id = app.current_tenant_id()
     and m.delivered_at is null
     and u.status = 'active'
     and (m.kind = 'announcement' or exists (
           select 1
             from public.consent cs
             join public.contact ct on ct.id = cs.given_by_contact_id
                                   and ct.tenant_id = cs.tenant_id
             join public.client cl on cl.id = cs.client_id and cl.tenant_id = cs.tenant_id
            where cs.tenant_id = m.tenant_id
              and cs.purpose = 'marketing'
              and cs.status = 'active'
              and cs.method = 'portal_switch'
              and cl.status <> 'erased'
              and ct.user_id = r.user_id))
   order by s.user_id, s.id;
end
$$;
revoke execute on function app.push_delivery_targets(uuid) from public;
grant execute on function app.push_delivery_targets(uuid) to app_role;

------------------------------------------------------------------------------
-- 9. app.push_subscriptions_gone(ids) — the devices a push service said are
--    no longer there (404 or 410). Deleted, because an address that answers
--    "gone" will never answer again and keeping it keeps nothing but a
--    device's old address. The owner and an admin, as the delivery runs
--    (42501 otherwise). Answers how many went.
------------------------------------------------------------------------------
create function app.push_subscriptions_gone(p_ids uuid[])
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
  delete from public.push_subscription s
   where s.tenant_id = app.current_tenant_id() and s.id = any (p_ids);
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
revoke execute on function app.push_subscriptions_gone(uuid[]) from public;
grant execute on function app.push_subscriptions_gone(uuid[]) to app_role;

------------------------------------------------------------------------------
-- 10. Grants. Which rows, and to whom, is db/policies/portal/push.sql.
--     push_subscription: read, add, remove — never edited by a person.
--     push_message: read, send, and the delivery's one update; never deleted.
--     push_recipient: read and write once; never edited, never deleted.
------------------------------------------------------------------------------
do $$
declare
  has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
                       and exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  alter table public.push_subscription enable row level security;
  alter table public.push_message enable row level security;
  alter table public.push_recipient enable row level security;
  revoke all on public.push_subscription, public.push_message, public.push_recipient from public;
  if has_api_roles then
    revoke all on public.push_subscription, public.push_message, public.push_recipient
      from anon, authenticated;
  end if;
  grant select, insert, delete on public.push_subscription to app_role;
  grant select, insert, update on public.push_message to app_role;
  grant select, insert on public.push_recipient to app_role;
end
$$;

-- rollback:
--   -- Remove db/policies/portal/push.sql from the tree first: the runner
--   -- re-applies every policy file on each migrate, and its policies name
--   -- the three tables dropped below.
--   drop function if exists app.push_subscriptions_gone(uuid[]);
--   drop function if exists app.push_delivery_targets(uuid);
--   drop function if exists app.push_audience();
--   drop function if exists app.portal_subscribe_push(text, text, text);
--   drop table if exists push_recipient;
--   drop table if exists push_message;
--   drop table if exists push_subscription;
--   drop function if exists app.guard_push_offer_ceiling();
--   drop function if exists app.guard_push_message();
--   drop type if exists push_consent_standing;
--   drop type if exists push_kind;
