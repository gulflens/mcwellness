-- 414_package_position.sql
-- The order the practice lists its packages in, set by hand.
--
-- The operator's request of 20 October 2026: Silver, Gold, Platinum, then
-- Complimentary, and the means to change it. No price or name gives that
-- order (Complimentary and Gold share a list price), so it is a fact the
-- practice keeps, stored on the package as `position`, 1 first.
--
-- **Existing rows** are numbered in the order the list showed them until now,
-- by list price and then name (`app/api/billing/packages.ts`), so nothing
-- moves on screen until somebody moves it.
--
-- **Every new row gets one**, whoever writes it — the add-a-package route,
-- the seed, a test — because a trigger before insert puts a package with no
-- position at the end of its practice's list, as 413 sets a document's
-- language rather than trusting each writer to.
--
-- **No unique key.** A move renumbers the whole list in one transaction
-- (`domain/billing/packageOrder.ts`), and two packages added at the same
-- moment may share a number until then; the list breaks a tie by name.
--
-- **Why "goes last" is SQL and not `domain/`.** Rule 4 keeps business rules
-- in `domain/`; how a package *moves* is there. Where a new one lands is a
-- default for a column, like 413's document language, and only a trigger
-- holds it for every writer — the seed and tests insert packages too. The
-- reinstate route's `max(position) + 1` is the same default, applied when a
-- withdrawn bundle comes back (docs/SPEC/billing.md section 2.5).
--
-- A move is an update to `package`, so the audit trigger it already carries
-- (401) records it, with the reason the request gives.
--
-- Needs: 401 (package).

alter table public.package add column position integer;

update public.package p
   set position = ranked.n
  from (
    select id, row_number() over (partition by tenant_id order by list_price_fils, name, id) as n
      from public.package
  ) ranked
 where ranked.id = p.id;

alter table public.package alter column position set not null;
alter table public.package
  add constraint package_position_from_one check (position >= 1);

comment on column public.package.position is
  'Where the package sits in the practice''s list, 1 first. Set by hand (operator, 2026-10-20); a new package goes last.';

create function app.package_position_last() returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if new.position is null then
    select coalesce(max(position), 0) + 1 into new.position
      from public.package
     where tenant_id = new.tenant_id;
  end if;
  return new;
end;
$$;

revoke execute on function app.package_position_last() from public;

create trigger package_position_last before insert on public.package
  for each row execute function app.package_position_last();

-- rollback:
--   drop trigger if exists package_position_last on public.package;
--   drop function if exists app.package_position_last();
--   alter table public.package drop column if exists position;
