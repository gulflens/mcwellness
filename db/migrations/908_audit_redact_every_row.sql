-- 908_audit_redact_every_row.sql
-- Needs: 070 (app.audit_chain_link, app.audit_row_hash, app.audit_chain),
--        080 (app.audit_redact), 904 and 906 (the version of it that runs
--        today; this migration calls the function and never restates it)
--
-- Redaction reaches every audit row, not only the ones a trigger wrote.
--
-- **The hole, found reviewing round 23.** `app.audit_redact` is called from
-- exactly one place: `app.audit_row` (080, replaced by 095), the row trigger
-- on the eleven audited tables. Every other way a row reaches `audit_log`
-- goes straight in with whatever the caller passed —
--
--   * `logRead`, `logReads` and `logAction` (app/api/_middleware/audit.ts),
--   * `logRefused` (app/api/clients/refused.ts),
--   * `logRefusal` and `logSensitive` (app/api/sessions/audit.ts),
--   * `logErasurePerformed` (app/api/clients/erasure.ts),
--
-- — and of those, `logAction` is the one that carries values: its `details`
-- become `new_values`. The comment on that helper said so plainly, and said
-- that the discipline was therefore the caller's and that there was no second
-- chance at it, the trail being append-only. That is a rule resting on
-- everybody who ever writes a route remembering it. This migration makes the
-- database keep it instead.
--
-- **Where it goes, and why there.** Into `app.audit_chain_link()` (070), the
-- before-insert trigger on `audit_log` itself. It is the one place every
-- insert passes through, whoever performs it — that is the guarantee 070 was
-- built around, in its own words, "so every insert path is chained by
-- construction; nobody can insert an unchained row" — and it is already
-- security definer, so it may call `app.audit_redact`, which app_role holds
-- no grant on and must not.
--
-- **Before the hash, deliberately.** The values are redacted and then hashed,
-- so `row_hash` is taken over what is actually stored. A verifier recomputes
-- from the stored columns (`app.verify_audit_chain`, 080), so it sees the
-- same bytes the writer did and the chain verifies exactly as before.
-- Redacting after the hash would have produced a row whose stored values do
-- not reproduce its own hash: every row written from this day on would read
-- as forged.
--
-- **Nothing already written changes.** This replaces a function, not a row.
-- Every existing row keeps its values and its hash, and the two still agree,
-- so `app.verify_audit_chain()` answers null over a database that carries
-- rows from both sides of this migration. That is proved rather than
-- asserted, in tests/db/audit.test.ts.
--
-- **Trigger-written rows are unchanged, because redaction is idempotent.**
-- `app.audit_row` redacts before it inserts and this redacts again on the way
-- in. The second pass finds nothing left to do: a dropped key is already
-- gone, `[redacted: 1000 chars]` is nineteen characters and so is left alone,
-- a nested object was already walked, and inside an erasure every value is
-- already `[withheld: erasure]`, which redacts to itself. The double call
-- costs one function call per audited write and buys the guarantee that no
-- insert path can escape the rule.
--
-- **The one behaviour this adds beyond redaction.** `old_values` and
-- `new_values` must be a JSON object or nothing at all. They always have
-- been: `app.audit_row` writes `to_jsonb(record)`, and `logAction` writes an
-- object of ids and channels. An array or a bare scalar was accepted before
-- and now is not, with a sentence saying why — `app.audit_redact` walks an
-- object's keys and cannot walk a scalar, and a trail whose values are
-- sometimes not a row's columns is a trail nothing can redact. Arrays are
-- still not descended into at any depth (904), which remains a change
-- request rather than a hole to fill quietly.
--
-- **What this does not do.** It does not make `logAction`'s rule unnecessary.
-- The details are the contact's id and the channel, never the telephone
-- number and never the address (docs/SPEC/audit.md section 8), and a phone
-- number is under two hundred characters and is not a key on the dropped
-- list, so nothing here would catch one. What catches one now is the helper
-- itself, which refuses an E.164 number or an email address before the insert
-- (app/api/_middleware/audit.ts). This is the floor beneath that, not a
-- replacement for it.

create or replace function app.audit_chain_link() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_last_id   bigint;
  v_last_hash bytea;
begin
  -- The values a row carries, whichever path wrote it. Ahead of the chain
  -- lock below on purpose: redaction is arithmetic over one jsonb value and
  -- has no business being done while every other audited write in the
  -- database queues behind it.
  if new.old_values is not null and jsonb_typeof(new.old_values) <> 'object' then
    raise exception 'audit_log.old_values is a JSON object or nothing at all'
      using errcode = 'invalid_parameter_value',
            hint    = 'The trail records a row''s columns or an action''s details. '
                      'An array or a scalar cannot be redacted (migration 908).';
  end if;
  if new.new_values is not null and jsonb_typeof(new.new_values) <> 'object' then
    raise exception 'audit_log.new_values is a JSON object or nothing at all'
      using errcode = 'invalid_parameter_value',
            hint    = 'The trail records a row''s columns or an action''s details. '
                      'An array or a scalar cannot be redacted (migration 908).';
  end if;
  new.old_values := app.audit_redact(new.old_values);
  new.new_values := app.audit_redact(new.new_values);

  -- Serialisation point. Every audit insert in the database queues on this one
  -- row until the previous writer commits or rolls back. At a few hundred rows
  -- a day the wait is microseconds, and the guarantee it buys (id order equals
  -- chain order, no scan of partitions for prev_hash) is worth far more than
  -- the concurrency it costs. Revisit only if volume grows by orders of magnitude.
  select last_id, last_hash
    into strict v_last_id, v_last_hash
    from app.audit_chain
   where singleton
     for update;

  new.id        := v_last_id + 1;        -- overrides anything the caller supplied
  new.prev_hash := v_last_hash;
  -- Over the redacted values, which are the values this row will hold: the
  -- verifier recomputes from what is stored, so the two must be the same thing.
  new.row_hash  := app.audit_row_hash(
    new.prev_hash, new.id, new.occurred_at, new.actor_id, new.action,
    new.entity_type, new.entity_id, new.old_values, new.new_values);

  update app.audit_chain
     set last_id = new.id, last_hash = new.row_hash
   where singleton;

  return new;
end
$$;
revoke execute on function app.audit_chain_link() from public;

comment on function app.audit_chain_link() is
  'Redacts old_values and new_values (app.audit_redact), then assigns the id, the previous '
  'hash and the row hash. Every insert into audit_log passes through it, whoever performs it, '
  'so no write path escapes the redaction rule (migrations 070 and 908).';

-- rollback:
--   -- 070_audit_log.sql's body, verbatim, without the redaction.
--   create or replace function app.audit_chain_link() returns trigger
--   language plpgsql security definer
--   set search_path = pg_catalog, pg_temp
--   as $fn$
--   declare
--     v_last_id   bigint;
--     v_last_hash bytea;
--   begin
--     select last_id, last_hash
--       into strict v_last_id, v_last_hash
--       from app.audit_chain
--      where singleton
--        for update;
--
--     new.id        := v_last_id + 1;
--     new.prev_hash := v_last_hash;
--     new.row_hash  := app.audit_row_hash(
--       new.prev_hash, new.id, new.occurred_at, new.actor_id, new.action,
--       new.entity_type, new.entity_id, new.old_values, new.new_values);
--
--     update app.audit_chain
--        set last_id = new.id, last_hash = new.row_hash
--      where singleton;
--
--     return new;
--   end
--   $fn$;
--   revoke execute on function app.audit_chain_link() from public;
--   comment on function app.audit_chain_link() is null;
--   -- Rows written while this migration stood keep their redacted values and
--   -- the hashes taken over them. Nothing to undo there, and nothing to put
--   -- back: what was dropped on the way in was never written down.
