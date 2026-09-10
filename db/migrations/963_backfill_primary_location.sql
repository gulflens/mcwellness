-- 963_backfill_primary_location.sql
-- Needs: 060 (client.primary_location_id), 030 (location.is_primary)
--
-- Every client enrolled through the app until trunk round 43 (2026-09-10) has
-- primary_location_id null: the location routes wrote the flag on the
-- location and never the link on the client, and only the seed wrote both.
-- The list's Emirate column reads the link, so those clients showed no
-- emirate. From this round the routes write both (app/api/clients/locations.ts,
-- makePrimary); this fills in the past.
--
-- Two rules, in order. A flagged primary wins. A client with exactly one
-- location and no flag gets that one, since it is the only place a
-- practitioner could be sent. A client with several unflagged locations is
-- left null: the office marks one, and the list shows no emirate until it
-- does, as today.
-- Idempotent: only null links are written.
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
     set primary_location_id = l.id
    from public.location l
   where l.owner_type = 'client'
     and l.owner_id = c.id
     and l.is_primary
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
     set is_primary = true
    from public.client c
   where c.primary_location_id = l.id
     and not l.is_primary;
end
$$;

-- rollback:
--   -- Nothing to structurally revert: this migration writes data
--   -- (primary_location_id and is_primary), not schema. Rolling back the
--   -- backfill itself would mean re-nulling every primary_location_id this
--   -- file set, which cannot be told apart from one the routes wrote for real
--   -- afterwards — so there is no safe automated rollback, and none is given.
