-- 411_billing_single_session.sql
-- A session sold before its visit.
--
-- Until trunk round 43 (2026-09-10) a visit outside a package was charged
-- only when it closed: `app.charge_single_visit` writes an invoice of kind
-- 'session', naming the session, and a credit of source 'single' born already
-- consumed. Nothing could invoice a trial session up front, because a
-- 'session' invoice's own rule (invoice_source_matches_kind) requires the
-- session it is naming to exist first, and a session does not exist before
-- the visit that produces it.
--
-- The operator's decision of 10 September adds the sale: an invoice of a
-- fourth kind, 'single_session', naming no session, no package purchase and
-- no appointment, paired with one credit of source 'single' pointing at the
-- invoice rather than the other way round — which
-- `entitlement_source_is_named` (403) has allowed since the entitlement table
-- was written; only the invoice side needed a kind that could name nothing.
--
-- The books already know what to do with it. `domain/accounting/posting.ts`
-- posts every invoice kind but 'statement' and 'call_out_fee' to contract
-- liability, and moves it to income when the credit it stands for is
-- consumed — exactly a package's life, for a package of one. Nothing there
-- changes; the type this file adds a case to is the only edit that file
-- needs.
--
-- Needs: 402 (invoice, invoice_kind, invoice_source_matches_kind,
-- app.next_invoice_number), 403 (entitlement, entitlement_source_is_named's
-- 'single' branch, which already permits this), 408 (the source rule as it
-- last restated it, and the same enum-value technique below).

------------------------------------------------------------------------------
-- 1. The new kind.
--
--    `ALTER TYPE ... ADD VALUE` may run inside a transaction on Postgres 12
--    and later, but the new label may not be *used* as a value in the same
--    one. 408 met this by comparing `kind::text` against a text literal
--    rather than casting the literal to `invoice_kind` in the constraint
--    below; reading a label out of the catalogue is not a use of the new
--    value, so the same technique carries this migration too, in one file,
--    with no split needed.
------------------------------------------------------------------------------
alter type invoice_kind add value 'single_session';

-- The source rule, restated with the new kind in it. Dropped and rewritten
-- whole rather than added beside, as 408 did and for the same reason: one
-- place says what each kind of invoice must name, and one place to read it.
-- The other four branches are unchanged, character for character.
alter table invoice drop constraint invoice_source_matches_kind;
alter table invoice add constraint invoice_source_matches_kind check (
  case kind::text
    when 'session' then
      session_id is not null and package_purchase_id is null and appointment_id is null
    when 'package' then
      package_purchase_id is not null and session_id is null and appointment_id is null
    when 'statement' then
      session_id is null and package_purchase_id is null and appointment_id is null
    when 'call_out_fee' then
      appointment_id is not null and session_id is null and package_purchase_id is null
    when 'single_session' then
      session_id is null and package_purchase_id is null and appointment_id is null
    else false
  end
);

comment on constraint invoice_source_matches_kind on invoice is
  'What each kind of invoice must name (402, restated in 408 and 411). A single_session '
  'invoice names nothing: the credit it created points at it, not the other way round.';

------------------------------------------------------------------------------
-- 2. The idempotency key a repeated sale replays rather than doubles.
--
--    `payment` (402) and `package_purchase` (403) already carry one, each a
--    uuid a drawer generates when the person presses the button. `invoice`
--    never got its own, because until now nothing sold an invoice on its
--    own — a session invoice is written by a trigger closing a visit, a
--    package invoice by the same request that writes the purchase row that
--    carries its key. Selling a session ahead of its visit writes an invoice
--    and nothing else, so this is the row a repeat has to be read back from,
--    and it has had no key to read back by. Text rather than the other two
--    tables' uuid, and a partial index rather than their plain unique
--    constraint on the same idea, because a null key reads the same way
--    either shape is built; nothing here needs to match their column type,
--    only their guarantee.
------------------------------------------------------------------------------
alter table invoice add column idempotency_key text;
comment on column public.invoice.idempotency_key is
  'The same request twice is the same invoice once (migration 411). A drawer generates this '
  'when the person presses the button, so a retry, a double tap or a lost response replays '
  'the original rather than writing a second invoice into a table with no delete.';
create unique index invoice_one_per_idempotency_key
  on invoice (tenant_id, idempotency_key) where idempotency_key is not null;

-- rollback:
--   drop index if exists invoice_one_per_idempotency_key;
--   alter table invoice drop column if exists idempotency_key;
--   alter table invoice drop constraint if exists invoice_source_matches_kind;
--   alter table invoice add constraint invoice_source_matches_kind check (
--     case kind::text
--       when 'session' then
--         session_id is not null and package_purchase_id is null and appointment_id is null
--       when 'package' then
--         package_purchase_id is not null and session_id is null and appointment_id is null
--       when 'statement' then
--         session_id is null and package_purchase_id is null and appointment_id is null
--       when 'call_out_fee' then
--         appointment_id is not null and session_id is null and package_purchase_id is null
--       else false
--     end
--   );
--   -- The enum value cannot be dropped; Postgres has no ALTER TYPE ... DROP
--   -- VALUE (408's own note). Harmless once nothing writes it.
