-- 700_portal_invite.sql
-- The door into the client portal (docs/SPEC/client-portal.md section 6.1).
--
-- A household reaches its own record through an invitation the practice
-- issues: a link that lives seven days, is shown once, is single use, and can
-- be revoked. What is stored here is the sha256 of the token and never the
-- token itself, so a copy of this table is not a set of working links; the
-- link exists in the practice's hands and in the message they send, and
-- nowhere else.
--
-- **client_id is denormalised on purpose.** An invitation belongs to a
-- contact, and a contact belongs to a client; carrying the client here lets
-- the audit trigger attribute the row to the household without a join (097),
-- which is what makes an invitation show up on that record's own timeline.
-- The composite foreign key below binds the contact to the same client, so
-- the two can never disagree.
--
-- **Three functions, all security definer.** The portal's routes need to ask
-- questions row security cannot answer for them: which clients the person
-- signing in belongs to, and — from outside the fence, with nobody signed in
-- at all — whether a link works and, if it does, whose account it opens. Each
-- pins its search_path, each is revoked from public, and the two that take a
-- token take its hash and answer either one word or one id.
--
-- Needs: 000 (schema app, app.current_tenant_id, app.set_updated_at), 010
-- (tenant), 020 (app_user, locale), 060 (client, contact), 080 (app.audit_row),
-- 097 (client_id attribution for any table), 099 (the tenant-scoped keys the
-- composite foreign keys below reference), 100 (app.current_actor_id).

create type portal_invite_kind as enum ('first_sign_in', 'password_reset');

create table portal_invite (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenant (id),
  -- Denormalised for the audit trigger; bound to the contact's own client below.
  client_id    uuid not null references client (id),
  contact_id   uuid not null references contact (id),
  -- The account the invitation opens. Created by the invite route when the
  -- contact has none, so this is never null: an invitation with nobody to
  -- admit is not an invitation.
  user_id      uuid not null references app_user (id),
  kind         portal_invite_kind not null,
  locale       locale not null default 'en',
  -- sha256 of the 32 random bytes the practice hands over. The bytes
  -- themselves are never written down.
  token_hash   bytea not null check (octet_length(token_hash) = 32),
  expires_at   timestamptz not null,
  used_at      timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references app_user (id),
  unique (tenant_id, token_hash),
  unique (tenant_id, id),
  foreign key (tenant_id, client_id) references client (tenant_id, id),
  foreign key (tenant_id, contact_id) references contact (tenant_id, id),
  foreign key (tenant_id, user_id) references app_user (tenant_id, id)
);
comment on table public.portal_invite is 'audited: client - carries client_id directly';

create index portal_invite_client_idx on portal_invite (client_id, created_at);
create index portal_invite_contact_idx on portal_invite (contact_id);
create index portal_invite_user_idx on portal_invite (user_id);
create index portal_invite_created_by_idx on portal_invite (created_by);

create trigger set_updated_at before update on portal_invite
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on public.portal_invite
  for each row execute function app.audit_row();
alter table public.portal_invite enable always trigger audit_row;

------------------------------------------------------------------------------
-- Grants. Select, insert and update for the API role; never delete — an
-- invitation is revoked, never removed, so the trail of who was let in and
-- when survives. Which rows, and to whom, is db/policies/portal/access.sql.
------------------------------------------------------------------------------
do $$
declare
  has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
                       and exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  alter table public.portal_invite enable row level security;
  revoke all on public.portal_invite from public;
  if has_api_roles then
    revoke all on public.portal_invite from anon, authenticated;
  end if;
  grant select, insert, update on public.portal_invite to app_role;
end
$$;

------------------------------------------------------------------------------
-- 1. app.portal_client_ids() — the household, resolved from the actor stamp
--    and from nothing a request claims (docs/SPEC/client-portal.md section 2).
--
--    Security definer for the reason app.actor_is_contact_of is: a policy on
--    one table must not consult another through that table's own policies, or
--    Postgres reports SQLSTATE 42P17. An erased client is excluded outright,
--    because an erased record's contacts have already lost their user_id in
--    app.erase_client and this says the same thing a second way.
--
--    With no actor stamped, `user_id = null` matches nothing, so the answer is
--    the empty array rather than somebody else's household.
------------------------------------------------------------------------------
create function app.portal_client_ids() returns uuid[]
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(array_agg(distinct ct.client_id), '{}'::uuid[])
    from public.contact ct
    join public.client cl on cl.id = ct.client_id and cl.tenant_id = ct.tenant_id
   where ct.tenant_id = app.current_tenant_id()
     and ct.user_id = app.current_actor_id()
     and cl.status <> 'erased'
$$;
revoke execute on function app.portal_client_ids() from public;
grant execute on function app.portal_client_ids() to app_role;

------------------------------------------------------------------------------
-- 2. app.portal_invite_status() — one word about a link, to somebody who is
--    not signed in.
--
--    The door (POST /api/portal/invite/redeem) runs with no tenant and no
--    actor stamped, because the person on the other end of it has no account
--    yet. So this reads without a tenant filter and answers a word and
--    nothing else: never whose invitation it is, never when it was issued,
--    never which contact it names. The route turns 'unknown' into a 404 and
--    the other three into a 410, so a caller cannot tell a link that never
--    existed from one that has been revoked.
--
--    The hash is unique per practice rather than globally, so in principle two
--    practices could hold one; with 32 random bytes they will not, and the
--    order below makes the answer deterministic if they ever did.
--
--    One word is not about the link's own state at all. 'not_a_household' is
--    what an invitation naming a member of the practice answers, and it is
--    asked before anything else, because the door acts on 'valid' by creating
--    or repointing a sign-in: a link against an owner's or a member of staff's
--    account must never reach that step, however it came to exist. The route
--    that issues invitations refuses the same case (app/api/portal/access.ts),
--    and this is the floor beneath it — the one thing standing between a
--    hand-written portal_invite row and somebody else's console.
------------------------------------------------------------------------------
create function app.portal_invite_status(p_token_hash bytea) returns text
language plpgsql stable security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_invite record;
begin
  select used_at, revoked_at, expires_at, user_id into v_invite
    from public.portal_invite
   where token_hash = p_token_hash
   order by created_at desc, id
   limit 1;
  if not found then
    return 'unknown';
  end if;
  if exists (
    select 1 from public.user_role ur
     where ur.user_id = v_invite.user_id
       and ur.role <> 'client_contact'
  ) then
    return 'not_a_household';
  end if;
  if v_invite.revoked_at is not null then
    return 'revoked';
  end if;
  if v_invite.used_at is not null then
    return 'used';
  end if;
  if v_invite.expires_at <= now() then
    return 'expired';
  end if;
  return 'valid';
end
$$;
revoke execute on function app.portal_invite_status(bytea) from public;
grant execute on function app.portal_invite_status(bytea) to app_role;

------------------------------------------------------------------------------
-- 3. app.redeem_portal_invite() — spend the link, once.
--
--    Locks the row by its primary key and re-reads it under that lock, so two
--    redemptions of one link cannot both win: the second waits, sees used_at
--    standing, and is refused. Locking by id rather than by the token's own
--    query keeps the re-check simple and exact.
--
--    It links the sign-in onto the account and, for a first sign-in, writes
--    the address the person chose onto it. A password reset touches neither
--    the address nor the roles: the account already exists and this only puts
--    a new sign-in behind it.
--
--    Every refusal is a bare code, because the route answers 410 for all of
--    them without saying which (section 10). No actor is stamped in the
--    door's transaction, so the audit rows the row triggers write here are
--    the system's, which is what the trail already reads a null actor as.
------------------------------------------------------------------------------
create function app.redeem_portal_invite(p_token_hash bytea, p_auth_id uuid, p_email text)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_id      uuid;
  v_invite  record;
begin
  if p_auth_id is null then
    raise exception 'portal_invite_needs_a_sign_in' using errcode = 'invalid_parameter_value';
  end if;

  select id into v_id
    from public.portal_invite
   where token_hash = p_token_hash
   order by created_at desc, id
   limit 1;
  if v_id is null then
    raise exception 'portal_invite_unknown' using errcode = 'invalid_parameter_value';
  end if;

  select * into v_invite from public.portal_invite where id = v_id for update;
  -- Only a household account is ever admitted through this door. An invitation
  -- names an app_user, and an app_user may be several things at once: the
  -- founder is a contact of her own child's record as well as the owner of the
  -- practice. Rebinding auth_id on an account that holds any role but
  -- client_contact would hand whoever redeemed the link her console, so the
  -- state is refused here as well as in app.portal_invite_status, and the row
  -- is left exactly as it was.
  if exists (
    select 1 from public.user_role ur
     where ur.user_id = v_invite.user_id
       and ur.role <> 'client_contact'
  ) then
    raise exception 'portal_invite_not_a_household' using errcode = 'invalid_parameter_value';
  end if;
  if v_invite.revoked_at is not null then
    raise exception 'portal_invite_revoked' using errcode = 'invalid_parameter_value';
  end if;
  if v_invite.used_at is not null then
    raise exception 'portal_invite_used' using errcode = 'invalid_parameter_value';
  end if;
  if v_invite.expires_at <= now() then
    raise exception 'portal_invite_expired' using errcode = 'invalid_parameter_value';
  end if;

  update public.app_user
     set auth_id = p_auth_id,
         email = case
                   when v_invite.kind = 'first_sign_in' then coalesce(p_email, email)
                   else email
                 end
   where id = v_invite.user_id;

  update public.portal_invite set used_at = now() where id = v_invite.id;
  return v_invite.user_id;
end
$$;
revoke execute on function app.redeem_portal_invite(bytea, uuid, text) from public;
grant execute on function app.redeem_portal_invite(bytea, uuid, text) to app_role;

-- rollback:
--   -- Remove db/policies/portal/access.sql from the tree first: the runner
--   -- re-applies every policy file on each migrate and its policies name this
--   -- table (the discipline 100_client_record.sql's own rollback describes).
--   drop policy if exists tenant_isolation on public.portal_invite;
--   drop policy if exists portal_access_readers on public.portal_invite;
--   drop policy if exists portal_access_writers on public.portal_invite;
--   drop policy if exists portal_access_amenders on public.portal_invite;
--   drop function if exists app.redeem_portal_invite(bytea, uuid, text);
--   drop function if exists app.portal_invite_status(bytea);
--   drop function if exists app.portal_client_ids();
--   revoke select, insert, update on public.portal_invite from app_role;
--   drop trigger if exists audit_row on public.portal_invite;
--   drop table if exists portal_invite;
--   drop type if exists portal_invite_kind;
