-- 963_backfill_primary_location.sql
-- Needs: 060 (client.primary_location_id), 030 (location.is_primary, created_at)
--
-- Every client enrolled through the app until trunk round 43 (2026-09-10) has
-- primary_location_id null: the location routes wrote the flag on the
-- location and never the link on the client, and only the seed wrote both.
-- The list's Emirate column reads the link, so those clients showed no
-- emirate. From this round the routes write both (app/api/clients/locations.ts,
-- makePrimary); this fills in the past.
--
-- Three rules, in order. A flagged primary wins, and — the first task-5
-- review round found the schema could hold more than one for a client,
-- because nothing before this file ever stopped it — the newest one
-- (`created_at` desc, `id` desc as the tie-break) is taken deterministically
-- rather than whichever one a plan happens to visit first. A client with
-- exactly one location and no flag gets that one, since it is the only place
-- a practitioner could be sent. A client with several unflagged locations is
-- left null: the office marks one, and the list shows no emirate until it
-- does, as today. Idempotent: only null links are written.
--
-- The third statement then makes every location's flag agree with the link,
-- for every client that has one — not only the ones this file just linked,
-- so a client already linked before this file ran, whose flag had drifted
-- from it, is corrected too. That is also what demotes the loser: the client
-- with two flagged locations has its non-chosen one turned false here, once
-- the link names the winner. Only after that agreement is universal does the
-- partial unique index below get to hold.
--
-- Audit context, as 956 sets it: the client table's triggers stamp an actor
-- and a reason on every change, and a migration has neither.
do $$
begin
  perform set_config('app.reason', '963_backfill_primary_location.sql: the link the routes never wrote', true),
          set_config('app.request_id', gen_random_uuid()::text, true),
          set_config('app.actor_id', '', true),
          set_config('app.actor_roles', '', true);

  update public.client c
     set primary_location_id = pick.id
    from (
      select distinct on (owner_id) owner_id, id
        from public.location
       where owner_type = 'client'
         and is_primary
       order by owner_id, created_at desc, id desc
    ) pick
   where pick.owner_id = c.id
     and c.primary_location_id is null;

  update public.client c
     set primary_location_id = only_one.id
    from (
      select owner_id, min(id::text)::uuid as id
        from public.location
       where owner_type = 'client'
       group by owner_id
      having count(*) = 1
    ) only_one
   where only_one.owner_id = c.id
     and c.primary_location_id is null;

  update public.location l
     set is_primary = (l.id = c.primary_location_id)
    from public.client c
   where l.owner_type = 'client'
     and l.owner_id = c.id
     and c.primary_location_id is not null
     and l.is_primary <> (l.id = c.primary_location_id);
end
$$;

-- The invariant the routes already keep (app/api/clients/locations.ts,
-- makePrimary) made the schema's own, the way goal_one_primary_per_client
-- (100_client_record.sql) already does for a client's primary goal: at most
-- one location per owner may carry is_primary, across every owner_type this
-- table has, not only 'client'. A plain unique index, not deferrable, so a
-- writer that would create a second one is refused at the statement that
-- tries rather than let two stand even inside one transaction.
create unique index location_one_primary_per_owner on location (owner_type, owner_id) where is_primary;

-- rollback:
--   drop index if exists location_one_primary_per_owner;
--   -- The data the do $$ block wrote (primary_location_id and is_primary)
--   -- is not reverted: rolling it back would mean re-nulling every
--   -- primary_location_id this file set, which cannot be told apart from one
--   -- the routes have since written for real, so no automated rollback is
--   -- given for that part.
