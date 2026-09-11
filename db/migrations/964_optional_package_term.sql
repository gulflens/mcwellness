-- 964_optional_package_term.sql
-- A household keeps every session it paid for.
--
-- The catalogue has always forced a term. `package.expiry_months` is not null
-- — twelve by default until 410 made it six — and a single session sold ahead
-- of its visit took twelve months from a constant in the code that could not
-- be changed without a build. The operator's ruling of 11 September 2026, and
-- the shape they set on 12 September, end that: **an empty term means the
-- credits never expire; a number with a unit beside it means that term, for
-- that exact programme or that exact price.**
--
-- This file changes no catalogue's meaning. Every programme keeps the term it
-- has today, carried across into the new pair unchanged. The three live
-- programmes are blanked at the live pass by a data step of the operator's
-- own, recorded in docs/PRODUCTION.md when it is run: a migration fixes
-- structure, and what a practice charges for — and for how long — is the
-- practice's to set.
--
-- **Why a pair and not one column.** A term is a number and a unit, and the
-- unit is the operator's to choose per programme: a programme runs in months,
-- a trial credit may run in days. The operator took that surface area
-- knowingly on 12 September. Two columns can go wrong in exactly one way, a
-- number with no unit beside it, and a constraint on each table refuses that
-- outright — so a half-set term cannot be stored at all, let alone read by two
-- readers who then disagree about what it meant.
--
-- **Neither column takes a default.** A programme written without naming them
-- has no term, which is what the practice runs today. Nothing acquires a term
-- by accident, and nothing has to remember to clear one.
--
-- **What already understood an empty term.** `app.oldest_available_entitlement`
-- (403) has always counted a credit with no expiry as usable and sorted it
-- `nulls last`, and `entitlement.expires_on` has always been nullable. This
-- file teaches the consumption rule nothing new; it lets the catalogue say
-- what that rule could already hear.
--
-- **Extensions go.** 410 shipped an extension hard-wired to three months,
-- twice, with `package_extension` recording each one and
-- `package_purchase.extended_to` / `extension_reason` carrying the latest.
-- Three months cannot fit a term measured in days, and a programme with no
-- term has nothing to extend. The operator's decision of 11 September,
-- reaffirmed on 12 September once that tension was put to them, is that the
-- whole of it is removed. If an extension is wanted later it is a new round
-- with a clearer brief than the one being deleted.
--
-- **410 is merged and applied to staging and production, and is not edited**
-- (.claude/rules/data-model.md). This file drops forward what that one added,
-- which is the only way the history stays true on the databases that have
-- already run it.
--
-- **Why a trunk number for billing's tables.** The round spans three streams —
-- the catalogue, the household's portal and the trunk's own documents — so it
-- is numbered in the trunk's 900–999 half rather than billing's 400–449, and
-- names every range it depends on below. The runner applies pending files in
-- numeric order, so 401, 403, 409 and 410 have all run by the time this one
-- does on any database that carries them.
--
-- Needs: 400 (price), 401 (package and package.expiry_months), 403
-- (package_purchase with its extension columns and their constraints;
-- entitlement; and app.oldest_available_entitlement, the version this file
-- replaces), 409 (the discount columns price carries beside the new pair), 410
-- (package_extension, with its triggers, grants and row security).

------------------------------------------------------------------------------
-- 1. The term on a programme.
--
--    Added, filled from the term the programme already has, and only then is
--    the old column dropped — so a populated database never crosses this file
--    through a moment in which a programme says nothing about its term. Every
--    `package` row today has `expiry_months`, because the column is not null,
--    so every row comes out of this section with a whole term in months and
--    nothing comes out blank. Blanking the three live programmes is the
--    operator's data step at the live pass, not this file's.
------------------------------------------------------------------------------
alter table public.package add column expiry_amount integer;
alter table public.package add column expiry_unit text;

alter table public.package add constraint package_expiry_amount_is_positive
  check (expiry_amount is null or expiry_amount > 0);
alter table public.package add constraint package_expiry_unit_is_known
  check (expiry_unit is null or expiry_unit in ('day', 'month'));
alter table public.package add constraint package_expiry_term_is_whole
  check ((expiry_amount is null) = (expiry_unit is null));

update public.package
   set expiry_amount = expiry_months,
       expiry_unit   = 'month';

alter table public.package drop column expiry_months;

comment on column public.package.expiry_amount is
  'How long the credits in this programme last, as a number to read beside expiry_unit. Null '
  'means they never expire (the operator, 2026-09-11), which is what the practice runs today.';
comment on column public.package.expiry_unit is
  'The unit expiry_amount is counted in: ''day'' or ''month''. Null means no term. There is no '
  'default, so a term is never acquired by accident — it is chosen, per programme, or it is absent.';
comment on constraint package_expiry_term_is_whole on public.package is
  'A term is whole or absent, never half. A number with no unit beside it is the one way a '
  'two-column term goes wrong, and it is refused here rather than guessed at by a reader.';

------------------------------------------------------------------------------
-- 2. The same term on a price.
--
--    `price` has never carried a term at all: a single session sold ahead of
--    its visit took twelve months from SINGLE_SESSION_MONTHS, a constant in
--    the code. The same pair, with the same constraints and the same meaning,
--    so the answer to "how long do these credits last" is read the same way
--    whichever half of the catalogue was sold. Every price on the list is
--    added without a term, which is the ruling: credits do not expire unless
--    the practice deliberately says they do.
------------------------------------------------------------------------------
alter table public.price add column expiry_amount integer;
alter table public.price add column expiry_unit text;

alter table public.price add constraint price_expiry_amount_is_positive
  check (expiry_amount is null or expiry_amount > 0);
alter table public.price add constraint price_expiry_unit_is_known
  check (expiry_unit is null or expiry_unit in ('day', 'month'));
alter table public.price add constraint price_expiry_term_is_whole
  check ((expiry_amount is null) = (expiry_unit is null));

comment on column public.price.expiry_amount is
  'How long a credit sold at this price lasts, as a number to read beside expiry_unit. Null '
  'means it never expires, which is what every price on the list says: this is what retires '
  'SINGLE_SESSION_MONTHS, the twelve months a single session used to take from the code.';
comment on column public.price.expiry_unit is
  'The unit expiry_amount is counted in: ''day'' or ''month''. Null means no term, and there is '
  'no default — the same pair public.package carries, read the same way.';
comment on constraint price_expiry_term_is_whole on public.price is
  'A term is whole or absent, never half. The same rule public.package carries, stated where a '
  'price is written so the two halves of the catalogue cannot drift apart.';

------------------------------------------------------------------------------
-- 3. The extension machinery goes.
--
--    The table first, with the triggers, grants and row security 410 gave it;
--    then the two columns 403 put on the purchase, and with them the three
--    constraints that named them. The constraints are dropped by name rather
--    than left to fall with their columns — Postgres would drop them anyway —
--    because a reader of this file should be able to see which rules stopped
--    applying and not have to work it out from the catalogue.
--
--    `package_extension` is the only table dropped here. It held two dates and
--    a sentence about why a family asked for longer, and no environment has
--    ever had a row in it: nothing has been sold on production, and staging's
--    rows are synthetic. Its policies live in db/policies/billing/ledger.sql
--    and db/policies/portal/money.sql, which the runner re-applies on every
--    migrate; they go in the same pull request as this file, or the policy
--    pass fails on a table that is no longer there.
------------------------------------------------------------------------------
drop table public.package_extension;

alter table public.package_purchase drop constraint package_purchase_extension_is_reasoned;
alter table public.package_purchase drop constraint package_purchase_extension_moves_forward;
alter table public.package_purchase drop constraint package_purchase_extension_reason_check;
alter table public.package_purchase drop column extended_to;
alter table public.package_purchase drop column extension_reason;

------------------------------------------------------------------------------
-- 4. The consumption rule, restated without the extension.
--
--    `app.oldest_available_entitlement` (403 section 5) read
--    `coalesce(pp.extended_to, e.expires_on)` and joined the purchase for the
--    one column it needed. With that column gone the join has nothing left to
--    fetch, so the credit's own `expires_on` is the whole of the answer.
--
--    **Nothing about what the rule decides changes.** A credit with a null
--    `expires_on` is still always valid, and still sorts `nulls last`, so the
--    credit closest to running out is still the one spent and a household
--    never loses a dated credit while an undated one is used first. That
--    behaviour is what the whole round rests on, and it is older than the
--    round: it has been true since 403.
--
--    Replaced rather than patched, and 403's text is written out in the
--    rollback below, for the reason 406 and 409 give: `create or replace` has
--    no undo of its own.
------------------------------------------------------------------------------
create or replace function app.oldest_available_entitlement(
  p_client_id uuid, p_service_type_id uuid, p_on date
) returns uuid
language sql volatile security definer
set search_path = pg_catalog, pg_temp
as $$
  select e.id from public.entitlement e
   where e.tenant_id = app.current_tenant_id()
     and e.client_id = p_client_id
     and e.service_type_id = p_service_type_id
     and e.status = 'available'
     -- A credit with no expiry is always valid. This is 403's own rule with
     -- the extension taken out of it, not a new one: `expires_on` has been
     -- nullable since the ledger was written, and a null has always meant
     -- "does not run out". From this round the catalogue can say so at the
     -- sale, which is the only thing that is new.
     and (e.expires_on is null or e.expires_on >= p_on)
   -- Oldest first, so the credit closest to running out is the one used, and
   -- a client never loses a credit to expiry while a newer one is spent.
   -- `nulls last`: a credit that never runs out waits until the dated ones
   -- are gone, which is the same ordering for the same reason.
   order by e.expires_on nulls last, e.created_at, e.id
   limit 1
   -- The read is the lock. Two visits for the same client and service
   -- completing at the same moment would otherwise both read the same credit
   -- id, and the second update would overwrite the first: one credit spent
   -- twice, and the second visit never invoiced, because only one row exists
   -- and entitlement_one_per_session never fires. Locking the row this
   -- returns, and skipping one another transaction already holds, hands the
   -- second visit the next credit — or none, which charges it properly.
   -- `of e` is kept though `e` is now the only table here: it says what is
   -- locked, and it is the line a later join would otherwise get wrong.
   for no key update of e skip locked
$$;
revoke execute on function app.oldest_available_entitlement(uuid, uuid, date) from public;
grant execute on function app.oldest_available_entitlement(uuid, uuid, date) to app_role;

------------------------------------------------------------------------------
-- 5. A programme sold with no term has no end date to write.
--
--    `package_purchase.expires_on` has been not null since 403, when every
--    programme had a term by construction. A programme with no term has no end
--    to record, and a sale of one cannot be written at all while the column
--    refuses a null — so the catalogue would be able to say "these credits
--    never expire" and the sale would be unable to record it. The column
--    becomes nullable, with the same meaning `entitlement.expires_on` has
--    carried all along: null is not "unknown", it is "does not run out".
--
--    `package_purchase_expires_after_purchase` (403) is left exactly as it is.
--    `null > purchased_on` is unknown, and a check constraint admits anything
--    it cannot call false, so a termless purchase passes it and a dated one is
--    held to the same rule it always was.
--
--    A household keeps the term it was sold: nothing here rewrites a date on a
--    purchase that already has one.
------------------------------------------------------------------------------
alter table public.package_purchase alter column expires_on drop not null;

comment on column public.package_purchase.expires_on is
  'The day the credits from this sale stop being usable, or null when they never do (migration '
  '964). Written at the sale from the programme''s own term and never rewritten afterwards: a '
  'household keeps the term it was sold, whatever the catalogue says later.';

-- rollback:
--   -- Section 5. A programme sold with no term has no date to put back, so
--   -- this line refuses until each such purchase has been given one; that is
--   -- the point, not an oversight.
--   alter table public.package_purchase alter column expires_on set not null;
--   comment on column public.package_purchase.expires_on is null;
--
--   -- Section 4. 403's own text, written out: `create or replace` has no undo,
--   -- and the column its coalesce names is restored by the section below.
--   create or replace function app.oldest_available_entitlement(
--     p_client_id uuid, p_service_type_id uuid, p_on date
--   ) returns uuid
--   language sql volatile security definer
--   set search_path = pg_catalog, pg_temp
--   as $$
--     select e.id from public.entitlement e
--       -- A purchase the coordinator extended runs to the new date. Two readers
--       -- of one expiry must not disagree: domain/billing/balance.ts counts a
--       -- credit as remaining while the extension holds, and this must find the
--       -- same credit, or the balance would promise a session that a delivered
--       -- visit could not find and the family would be invoiced for it a second
--       -- time.
--       left join public.package_purchase pp
--         on pp.tenant_id = e.tenant_id and pp.id = e.package_purchase_id
--      where e.tenant_id = app.current_tenant_id()
--        and e.client_id = p_client_id
--        and e.service_type_id = p_service_type_id
--        and e.status = 'available'
--        and (coalesce(pp.extended_to, e.expires_on) is null
--             or coalesce(pp.extended_to, e.expires_on) >= p_on)
--      -- Oldest first, so the credit closest to running out is the one used, and
--      -- a client never loses a credit to expiry while a newer one is spent.
--      order by coalesce(pp.extended_to, e.expires_on) nulls last, e.created_at, e.id
--      limit 1
--      -- The read is the lock. Two visits for the same client and service
--      -- completing at the same moment would otherwise both read the same credit
--      -- id, and the second update would overwrite the first: one credit spent
--      -- twice, and the second visit never invoiced, because only one row exists
--      -- and entitlement_one_per_session never fires. Locking the row this
--      -- returns, and skipping one another transaction already holds, hands the
--      -- second visit the next credit — or none, which charges it properly.
--      -- `of e`: the purchase is the nullable side of the join and cannot be
--      -- locked, and does not need to be.
--      for no key update of e skip locked
--   $$;
--   revoke execute on function app.oldest_available_entitlement(uuid, uuid, date) from public;
--   grant execute on function app.oldest_available_entitlement(uuid, uuid, date) to app_role;
--
--   -- Section 3. The purchase's two columns and their three constraints, then
--   -- 410's table whole, with the triggers, grants and row security it gave it.
--   -- Every extension ever recorded is gone for good: this restores the shape,
--   -- never the rows.
--   alter table public.package_purchase add column extended_to date;
--   alter table public.package_purchase add column extension_reason text
--     check (length(btrim(extension_reason)) between 1 and 200);
--   alter table public.package_purchase add constraint package_purchase_extension_is_reasoned
--     check ((extended_to is null) = (extension_reason is null));
--   alter table public.package_purchase add constraint package_purchase_extension_moves_forward
--     check (extended_to is null or extended_to > expires_on);
--   create table public.package_extension (
--     id           uuid primary key default gen_random_uuid(),
--     tenant_id    uuid not null references public.tenant (id),
--     client_id    uuid not null,
--     purchase_id  uuid not null,
--     ordinal      integer not null,
--     from_on      date not null,
--     to_on        date not null,
--     reason       text not null check (length(btrim(reason)) between 1 and 200),
--     created_by   uuid not null,
--     created_at   timestamptz not null default now(),
--     updated_at   timestamptz not null default now(),
--     constraint package_extension_ordinal_is_one_or_two check (ordinal in (1, 2)),
--     constraint package_extension_purchase_id_ordinal_key unique (purchase_id, ordinal),
--     constraint package_extension_moves_forward check (to_on > from_on),
--     constraint package_extension_is_three_months
--       check (to_on = (from_on + interval '3 months')::date),
--     constraint package_extension_tenant_id_id_key unique (tenant_id, id),
--     constraint package_extension_purchase_id_fkey
--       foreign key (tenant_id, purchase_id) references public.package_purchase (tenant_id, id),
--     constraint package_extension_client_id_fkey
--       foreign key (tenant_id, client_id) references public.client (tenant_id, id),
--     constraint package_extension_created_by_fkey
--       foreign key (tenant_id, created_by) references public.app_user (tenant_id, id)
--   );
--   comment on table public.package_extension is
--     'audited: client — one row per extension of a programme; at most two, of three months each (docs/PLAN/package-terms.md)';
--   create trigger set_updated_at before update on public.package_extension
--     for each row execute function app.set_updated_at();
--   create trigger audit_row after insert or update or delete on public.package_extension
--     for each row execute function app.audit_row();
--   alter table public.package_extension enable always trigger audit_row;
--   do $$
--   declare
--     has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
--                          and exists (select 1 from pg_roles where rolname = 'authenticated');
--   begin
--     alter table public.package_extension enable row level security;
--     revoke all on public.package_extension from public;
--     if has_api_roles then
--       revoke all on public.package_extension from anon, authenticated;
--     end if;
--     grant select, insert on public.package_extension to app_role;
--   end
--   $$;
--   -- and put this table's three policies back into db/policies/billing/ledger.sql
--   -- and its name back into db/policies/portal/money.sql's array, which the
--   -- runner re-applies and which both name the table.
--
--   -- Section 2. The term on a price, which nothing had before this file.
--   alter table public.price drop constraint if exists price_expiry_term_is_whole;
--   alter table public.price drop constraint if exists price_expiry_unit_is_known;
--   alter table public.price drop constraint if exists price_expiry_amount_is_positive;
--   alter table public.price drop column if exists expiry_unit;
--   alter table public.price drop column if exists expiry_amount;
--
--   -- Section 1. expiry_months back, filled from the pair. The reverse is
--   -- lossy and says so: a programme with no term and a programme whose term
--   -- is in days have no number of months to go back to, so the first takes
--   -- 410's default of six and the second is rounded up to whole months, both
--   -- held inside the one-to-sixty bound the column carried.
--   alter table public.package add column expiry_months integer;
--   update public.package set expiry_months = least(60, greatest(1, case
--     when expiry_unit = 'month' then expiry_amount
--     when expiry_unit = 'day' then ceil(expiry_amount / 30.0)::integer
--     else 6 end));
--   alter table public.package alter column expiry_months set not null;
--   alter table public.package alter column expiry_months set default 6;
--   alter table public.package add constraint package_expiry_months_check
--     check (expiry_months between 1 and 60);
--   comment on column public.package.expiry_months is
--     'How many months a programme runs from purchase. Six by default (the operator, 2026-09-10); a programme keeps the term it was sold with.';
--   alter table public.package drop constraint if exists package_expiry_term_is_whole;
--   alter table public.package drop constraint if exists package_expiry_unit_is_known;
--   alter table public.package drop constraint if exists package_expiry_amount_is_positive;
--   alter table public.package drop column if exists expiry_unit;
--   alter table public.package drop column if exists expiry_amount;
