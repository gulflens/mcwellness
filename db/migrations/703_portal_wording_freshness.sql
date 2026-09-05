-- 703_portal_wording_freshness.sql
-- Whether the wording a household agreed to has been superseded
-- (docs/SPEC/client-portal.md sections 3.1 and 3.5).
--
-- The Agreements screen says, beside a consent, that a newer approved version
-- of the same wording now stands and that the practice will ask them to read
-- it. Answering that takes two document rows: the retired one the consent
-- points at, which the household may read — a person is entitled to a copy of
-- what they agreed to, and db/policies/client/readers.sql admits them to
-- exactly the wording their own consent names — and the newer one, which they
-- may not, because it belongs to no client and no consent of theirs points at
-- it.
--
-- So the question is asked here rather than in the route's own SQL, where the
-- second row is simply invisible and the answer would always be false. Security
-- definer, for the same reason app.actor_is_contact_of is: a policy must not be
-- what decides a fact about a row it hides.
--
-- **What it can and cannot tell anybody.** One boolean about one document the
-- caller already holds a consent against, in their own practice. It names no
-- client, no person and no version, it answers false for a document of another
-- practice, and it reads nothing outside `document`. A household learns that
-- the words have moved on, which is what the screen exists to say.
--
-- **Why it is written in plpgsql and guards its own columns.** The five
-- consent-text columns it reads (`purpose`, `locale`, `status`, `retired_at`)
-- arrive in the trunk's 902, which sorts after every stream's range and is
-- therefore applied after this file — and, as docs/SPEC/OWNERSHIP.md says, a
-- higher number is no proof a later file is on a given database at all. A
-- `language sql` body would be parsed as this file runs and would fail there.
-- So the body is plpgsql, which compiles a statement at its first execution
-- rather than at creation, and the guard below answers false outright on a
-- database that has not been given those columns: the portal then says nothing
-- about freshness, which is the truthful answer where the practice has no
-- versioned wordings to be fresher than.
--
-- Needs: 000 (schema app, app.current_tenant_id), 060 (document).

create function app.portal_wording_is_superseded(p_document_id uuid) returns boolean
language plpgsql stable security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_superseded boolean;
begin
  if p_document_id is null then
    return false;
  end if;
  -- The consent-text columns, or nothing to compare (see the note above).
  if not exists (
    select 1 from pg_catalog.pg_attribute a
     where a.attrelid = 'public.document'::pg_catalog.regclass
       and a.attname = 'retired_at'
       and not a.attisdropped
  ) then
    return false;
  end if;

  execute $sql$
    select exists (
      select 1
        from public.document w
       where w.id = $1
         and w.tenant_id = app.current_tenant_id()
         and w.kind = 'consent_text'
         -- Retired: the practice has replaced it. A wording still standing is
         -- current by definition and needs no second query.
         and w.retired_at is not null
         and exists (
           select 1
             from public.document newer
            where newer.tenant_id = w.tenant_id
              and newer.kind = 'consent_text'
              and newer.purpose = w.purpose
              and newer.locale = w.locale
              -- Approved, and not itself retired. A wording retired with no
              -- approved replacement is not a newer version: it is a purpose
              -- the practice has stopped publishing, and telling a household
              -- to expect a new one would be untrue. Migration 902's partial
              -- unique index allows at most one such row per purpose and
              -- language, so "the newer version" is never ambiguous.
              and newer.status = 'approved'
              and newer.retired_at is null
              and newer.id <> w.id
         )
    )
  $sql$
  into v_superseded
  using p_document_id;

  return coalesce(v_superseded, false);
end
$$;
revoke execute on function app.portal_wording_is_superseded(uuid) from public;
grant execute on function app.portal_wording_is_superseded(uuid) to app_role;

-- rollback:
--   drop function if exists app.portal_wording_is_superseded(uuid);
