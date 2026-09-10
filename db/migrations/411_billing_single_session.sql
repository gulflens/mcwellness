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

------------------------------------------------------------------------------
-- 3. The extra discount's reason, for the one sale that has nowhere else to
--    keep it.
--
--    `SellSessionInput.extraDiscount.reason` (app/api/billing/ledger-schema.ts)
--    is required and length-checked the moment an actor asks for an extra
--    discount, and until now the route read it only to decide whether the
--    actor's role was allowed to give one — the figure it named went into the
--    arithmetic and the sentence explaining it went nowhere. A package sale
--    does not have this problem: its reason sits on
--    package_purchase.discount_reason (409 section 4), the row the sale
--    writes beside its invoice. A single-session sale writes an invoice and a
--    credit and no purchase row — the credit already points at the invoice
--    rather than the other way round (403's entitlement_source_is_named,
--    section 1's comment above) — so the invoice is the only row left that
--    could hold it. That is the identical argument section 2 above makes for
--    idempotency_key: nothing else is written when a session is sold, so
--    whatever a repeat has to be read back from, or a discount explained by,
--    has to live here.
--
--    Not discount_basis_points beside it: invoice_line already carries the
--    combined share and the combined sum (408 section 3), so a second column
--    naming the same split would only be the same fact stored twice.
--
--    The bound is the one package_purchase.discount_reason and
--    invoice.waiver_reason (408) already use, so a reason means the same
--    thing wherever the practice writes one.
------------------------------------------------------------------------------
alter table invoice add column discount_reason text
  check (length(btrim(discount_reason)) between 1 and 200);
comment on column public.invoice.discount_reason is
  'Why an extra discount was given at a single-session sale (migration 411). Null when the '
  'price list''s own discount was all of it — the only thing an extra discount alone carries, '
  'since a single_session invoice has no purchase row to hold it instead, unlike a package sale''s '
  'package_purchase.discount_reason (409 section 4).';

-- rollback:
--   alter table invoice drop column if exists discount_reason;
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
