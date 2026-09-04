-- 909_practice_logo.sql
-- Needs: 000 (app.current_tenant_id), 060 (document), 090 (the API role's
--        grants on document), 095 (app.actor_has_role), 902, 903 (the
--        consent-wording rules this one is written beside)
--
-- The practice's own logo, as a document the owner can replace
-- (docs/CHANGE-REQUESTS/billing-04.md request 5; the operator's decision of
-- 2026-09-03 that the invoice carries the practice's logo, with the wordmark
-- standing in until a file is supplied, and that the logo is a practice
-- document rather than a file committed to the repository).
--
-- **How `document.kind` is constrained, and how this extends it.** It is not
-- an enum and there is no list. `060_client.sql` declares `kind text not null`
-- and says so in its own comment: "referral, consent, report, setup_photo,
-- certificate, ...: open set". So there is no `alter type ... add value` here
-- and no transaction to worry about. What the schema does instead, and what
-- this migration copies, is the shape 902 and 903 gave `consent_text`: a kind
-- earns its rules one constraint at a time, each saying a single true thing
-- about rows of that kind and nothing at all about any other.
--
-- Three rules, then, and one door.
--
--   (a) **A logo belongs to no client.** `document_practice_logo_has_no_client`
--       is `document_consent_text_has_no_client`'s twin. The practice's mark
--       is the practice's, and filing one against a household would put it
--       inside that household's erasure.
--   (b) **A logo is a PNG or a JPEG.** It is drawn into a PDF, and the only
--       two image formats the renderer will ever be asked for are a PNG's
--       pixels and a JPEG passed through as `/DCTDecode`
--       (docs/CHANGE-REQUESTS/billing-04.md request 5). A constraint here
--       means the renderer can be written against two cases rather than
--       against whatever a settings screen once accepted.
--   (c) **One logo per practice.** A partial unique index on `tenant_id`,
--       the same device 902 uses to make "the current wording" a fact rather
--       than a convention. Replacing a logo is therefore a removal and an
--       insert in one transaction, and "the logo" is a row you can select
--       without asking which one.
--
-- **The door: app.remove_practice_logo().** `090_grants_and_rls.sql` gives
-- `app_role` select, insert and update on `document` and deliberately no
-- delete: "a document leaves through app.erase_client as the table owner,
-- never through this role" (db/policies/client/writers.sql). That is right,
-- and it means removing or replacing a logo needs a door of its own rather
-- than a grant that would open every other document with it. This is that
-- door, and it is exactly as wide as the thing it does: one kind, one
-- practice, owner or admin only, and it hands back the storage key so the
-- route can remove the bytes after the transaction commits (docs/SEAMS.md —
-- a delete cannot be rolled back and a transaction can).
--
-- Migration 903's guard still runs underneath: a logo is filed
-- `is_immutable = false`, because it is a mark the practice replaces and not
-- evidence of what anybody was shown, so the guard's immutability arm never
-- fires. If a logo were ever filed immutable by mistake, this function would
-- be refused by that guard rather than quietly succeeding, which is the right
-- way round.
--
-- **Retention: none, and that is the answer rather than an omission.** A logo
-- is on `RETENTION_EXEMPT_KINDS` beside `consent_text`
-- (`domain/shared/storage.ts`), so `documentRetentionUntil` answers null for
-- it and the row is filed with `retention_until` null. The reason is the
-- opposite of the wording's and lands in the same place: there is one logo at
-- a time and it is replaced rather than expired — the route that replaces it
-- removes the old bytes in the same breath — so a five-year clock started at
-- upload would mark the practice's *current* mark for deletion while it is
-- still the mark, and every document the practice issues would lose it on the
-- same day. Null there means "not on an upload clock", never "keep forever",
-- and a deletion job must ask what still references a document before it
-- removes anything (docs/SEAMS.md, and migration 903's own retention note).
-- Nothing in the schema stands in the way of that: `document.retention_until`
-- is nullable with no default, no check constraint reads it, and migration
-- 903's write guard never looks at it on an insert.
--
-- **Not here, deliberately.** No write floor for filing a logo:
-- `db/policies/client/writers.sql` already admits only an owner or an admin
-- to a practice document (`client_id is null`), which is the same audience
-- and the same sentence, and a second copy in a trigger would be a rule with
-- two homes. 903 floors `consent_text` in a trigger because that kind carries
-- the five wording columns and a check constraint cannot ask who is acting;
-- a logo carries none of them.
--
-- And nothing here reads the logo onto an invoice. `app/api/billing/
-- document-source.ts` and the renderer are the billing stream's; this
-- migration and the settings screen above it put the file where billing can
-- find it and stop there.

------------------------------------------------------------------------------
-- 1. What a practice_logo row may say.
------------------------------------------------------------------------------
alter table document
  add constraint document_practice_logo_has_no_client check (
    kind <> 'practice_logo' or client_id is null
  ),
  add constraint document_practice_logo_is_an_image check (
    kind <> 'practice_logo' or mime_type in ('image/png', 'image/jpeg')
  );

-- One at a time. Partial, so it constrains nothing else and costs nothing on
-- the documents that make up the rest of the table.
create unique index document_practice_logo_idx
  on document (tenant_id)
  where kind = 'practice_logo';

comment on index document_practice_logo_idx is
  'One practice_logo document per practice, so "the logo" is a row rather than a convention. '
  'Replacing one is app.remove_practice_logo() and an insert, in one transaction (migration 909).';

------------------------------------------------------------------------------
-- 2. Removing one, which app_role cannot do for itself.
--
--    Returns the storage key of the row it removed, or null when the practice
--    has no logo. The caller removes the bytes after its transaction commits;
--    a key that comes back and is then never deleted leaves an object nothing
--    points at, which is the orphan the seam already accepts and prefers to a
--    row pointing at bytes that are gone.
------------------------------------------------------------------------------
create function app.remove_practice_logo() returns text
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_key text;
begin
  -- The owner's own maintenance, exactly as app.guard_document_write() and
  -- app.guard_tenant_identity() stand aside for it: a migration, the seed or
  -- a console session stamps no role at all. Never a request through the API,
  -- which always stamps one.
  if nullif(current_setting('app.actor_roles', true), '') is not null
     and not (app.actor_has_role('owner') or app.actor_has_role('admin')) then
    raise exception 'the practice''s logo is the owner''s to replace'
      using errcode = 'insufficient_privilege',
            hint    = 'Only an owner or an admin may change what the practice''s documents carry.';
  end if;

  delete from public.document
   where tenant_id = app.current_tenant_id()
     and kind = 'practice_logo'
   returning storage_key into v_key;

  return v_key;
end
$$;
revoke execute on function app.remove_practice_logo() from public;
grant  execute on function app.remove_practice_logo() to app_role;

comment on function app.remove_practice_logo() is
  'Removes this practice''s logo document and answers the storage key it named, or null when '
  'there was none. The one delete app_role may cause on document, and only for this kind '
  '(migration 909).';

-- rollback:
--   drop function if exists app.remove_practice_logo();
--   drop index if exists document_practice_logo_idx;
--   alter table document drop constraint if exists document_practice_logo_is_an_image;
--   alter table document drop constraint if exists document_practice_logo_has_no_client;
