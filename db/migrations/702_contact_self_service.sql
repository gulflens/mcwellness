-- 702_contact_self_service.sql
-- The two rules underneath the portal's one form and its one hidden figure
-- (docs/SPEC/client-portal.md section 6.3).
--
-- **What a household may correct about itself.** A contact may change their
-- own telephone, their own email and whether they are happy to be messaged on
-- WhatsApp. Not their name, not their relationship, not what they may consent
-- to, not the Emirates ID columns, and above all not which client they belong
-- to. Row security says which rows an actor may reach and says nothing about
-- which columns, so the column boundary is a guard trigger, in the pattern of
-- app.guard_location_notes (100) and app.guard_tenant_identity (905):
-- everything but the three fields and updated_at is compared as jsonb, so a
-- column added to contact later is guarded without anyone remembering it.
--
-- The address is deliberately not on that list, and not because it was
-- forgotten. The day sheet reads it live, so an edit moves where a
-- practitioner drives, and a move may change the zone, which is the practice's
-- call.
--
-- **Who counts as an adult in their own household.** Every adult contact sees
-- the household's money, because the household is the billing unit. A young
-- person's own login — relationship 'self' on a client under eighteen today —
-- sees visits and agreements and no figure. The same rule is moneyVisibleTo in
-- domain/portal/money.ts, and tests/portal/db/money_visibility.test.ts asks
-- both on the day the birthday falls.
--
-- Needs: 000 (schema app), 010 (tenant, for its timezone), 020 (app_user), 060
-- (client, contact), 095 (app.actor_has_role), 100 (app.current_actor_id).

------------------------------------------------------------------------------
-- 1. app.guard_contact_self_service()
------------------------------------------------------------------------------
create function app.guard_contact_self_service() returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  -- No role stamped at all: a migration, the seed, or the runner as table
  -- owner. The same standing-aside every other guard in this schema does.
  if nullif(current_setting('app.actor_roles', true), '') is null then
    return new;
  end if;

  -- A staff role passes; who among them may write a contact at all is
  -- db/policies/client/writers.sql's answer, not this trigger's.
  if app.actor_has_role('owner') or app.actor_has_role('admin')
     or app.actor_has_role('lead_practitioner') or app.actor_has_role('practitioner')
     or app.actor_has_role('finance') then
    return new;
  end if;

  -- Anyone else who is not a client contact has no write path here in the
  -- first place; row security has already refused them the row.
  if not app.actor_has_role('client_contact') then
    return new;
  end if;

  -- Their own row, before and after: a household may not hand its row to
  -- somebody else, nor take somebody else's.
  if old.user_id is distinct from app.current_actor_id()
     or new.user_id is distinct from app.current_actor_id() then
    raise exception 'a contact may correct only their own details'
      using errcode = 'insufficient_privilege',
            hint    = 'A household edits the row that carries its own sign-in, and no other.';
  end if;

  if (to_jsonb(new) - array['phone', 'email', 'whatsapp_opt_in', 'updated_at'])
     is distinct from (to_jsonb(old) - array['phone', 'email', 'whatsapp_opt_in', 'updated_at'])
  then
    raise exception 'only a telephone, an email and a WhatsApp preference may be corrected here'
      using errcode = 'insufficient_privilege',
            hint    = 'The address is the practice''s to change: the day sheet drives to it.';
  end if;

  return new;
end
$$;
revoke execute on function app.guard_contact_self_service() from public;

create trigger guard_contact_self_service before update on public.contact
  for each row execute function app.guard_contact_self_service();

------------------------------------------------------------------------------
-- 2. app.actor_is_adult_contact_of()
--
--    Security definer, like app.actor_is_contact_of beside it (100), so the
--    restrictive money policies in db/policies/portal/money.sql can ask it
--    without contact's and client's own policies being evaluated as part of
--    answering — which is what Postgres reports as SQLSTATE 42P17.
--
--    Age is decided in the practice's own time zone, from tenant.timezone,
--    because "today" in Dubai is not "today" in UTC for four hours of every
--    day and a birthday must not arrive early or late. A client with no date
--    of birth is treated as an adult: the column is optional
--    (docs/SPEC/00-data-model.md section 3), and inventing a birthday to
--    withhold a figure from an adult is the worse mistake.
------------------------------------------------------------------------------
create function app.actor_is_adult_contact_of(p_client_id uuid) returns boolean
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select exists (
    select 1
      from public.contact ct
      join public.client cl on cl.id = ct.client_id and cl.tenant_id = ct.tenant_id
      join public.tenant t on t.id = cl.tenant_id
     where ct.client_id = p_client_id
       and ct.user_id = app.current_actor_id()
       and not (
         ct.relationship = 'self'
         and cl.date_of_birth is not null
         and cl.date_of_birth
             > ((now() at time zone t.timezone)::date - interval '18 years')::date
       )
  )
$$;
revoke execute on function app.actor_is_adult_contact_of(uuid) from public;
grant execute on function app.actor_is_adult_contact_of(uuid) to app_role;

-- rollback:
--   -- Remove db/policies/portal/money.sql from the tree first: its six
--   -- restrictive policies name the function dropped below, and the runner
--   -- re-applies every policy file on each migrate.
--   drop policy if exists portal_money_adults on public.package_purchase;
--   drop policy if exists portal_money_adults on public.entitlement;
--   drop policy if exists portal_money_adults on public.invoice;
--   drop policy if exists portal_money_adults on public.invoice_line;
--   drop policy if exists portal_money_adults on public.payment;
--   drop policy if exists portal_money_adults on public.billing_document;
--   drop function if exists app.actor_is_adult_contact_of(uuid);
--   drop trigger if exists guard_contact_self_service on public.contact;
--   drop function if exists app.guard_contact_self_service();
