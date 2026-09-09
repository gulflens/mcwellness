-- 962_erasure_guard_admits_the_sweep.sql
-- Needs: 104 (storage_keys_pending, files_cleared_at, requested_by_phone), 105 (the guard)
--
-- The erasure request's guard (105) lets a row change after `performed_at`
-- only in its letter columns, and steps aside only for a connection with no
-- roles stamped — the owner's own, which is what `pnpm job:erasure-files` ran
-- on. From trunk round 39 (2026-09-10) the sweep runs from inside the API
-- process as the API role with an admin's roles stamped (app/api/scheduler.ts),
-- so the guard met it and refused every key it struck off: the bytes went,
-- the worklist never emptied, and `files_cleared_at` was never written. The
-- compliance review of the round found it before it shipped.
--
-- The sweep's three columns each move one way, and that is what the guard now
-- admits: `storage_keys_pending` only shrinks, `files_cleared_at` is written
-- once, `requested_by_phone` only goes to null. Everything else after the act
-- is as 105 left it: the letter, and nothing more.
--
-- Trunk 950–999 half: it replaces a function the client-record stream created.
create or replace function app.guard_erasure_request_write() returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
declare
  afterwards constant text[] := array[
    'letter_document_id', 'letter_version', 'letter_sent_at', 'updated_at',
    'storage_keys_pending', 'files_cleared_at', 'requested_by_phone'
  ];
begin
  if nullif(current_setting('app.actor_roles', true), '') is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'an erasure request is never deleted'
      using errcode = 'insufficient_privilege',
            hint    = 'It is the record that an erasure happened; it keeps its own five years.';
  end if;

  -- (a) The act closing the row: everything it writes, once.
  if old.performed_at is null and new.performed_at is not null then
    return new;
  end if;

  -- (b) Afterwards, only the letter and the sweep's bookkeeping. Structural
  -- rather than an enumerated list of what may not change, so a column added
  -- to this table later is guarded by this trigger rather than slipping past.
  if (to_jsonb(new) - afterwards) is distinct from (to_jsonb(old) - afterwards) then
    raise exception 'an erasure request records what happened and is not rewritten'
      using errcode = 'insufficient_privilege',
            hint    = 'Only the confirmation letter, when it was sent, and the file sweep''s own bookkeeping may be written afterwards.';
  end if;

  -- (c) And the sweep's three columns each move one way.
  if new.storage_keys_pending is distinct from old.storage_keys_pending
     and not (coalesce(new.storage_keys_pending, '[]'::jsonb) <@ coalesce(old.storage_keys_pending, '[]'::jsonb)) then
    raise exception 'the pending file list of an erasure only shrinks'
      using errcode = 'insufficient_privilege';
  end if;
  if new.files_cleared_at is distinct from old.files_cleared_at and old.files_cleared_at is not null then
    raise exception 'when an erasure''s files were cleared is written once'
      using errcode = 'insufficient_privilege';
  end if;
  if new.requested_by_phone is distinct from old.requested_by_phone and new.requested_by_phone is not null then
    raise exception 'the requester''s number is only ever cleared'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;
revoke execute on function app.guard_erasure_request_write() from public;

-- rollback:
--   -- 105's body, which admits only the letter afterwards:
--   create or replace function app.guard_erasure_request_write() returns trigger
--   language plpgsql set search_path = pg_catalog, pg_temp as $$
--   begin
--     if nullif(current_setting('app.actor_roles', true), '') is null then
--       return case when tg_op = 'DELETE' then old else new end;
--     end if;
--     if tg_op = 'DELETE' then
--       raise exception 'an erasure request is never deleted' using errcode = 'insufficient_privilege';
--     end if;
--     if old.performed_at is null and new.performed_at is not null then return new; end if;
--     if (to_jsonb(new) - array['letter_document_id', 'letter_version', 'letter_sent_at', 'updated_at'])
--        is distinct from
--        (to_jsonb(old) - array['letter_document_id', 'letter_version', 'letter_sent_at', 'updated_at'])
--     then
--       raise exception 'an erasure request records what happened and is not rewritten' using errcode = 'insufficient_privilege';
--     end if;
--     return new;
--   end $$;
