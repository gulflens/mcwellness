-- 903_document_write_guard.sql
-- Needs: 060 (document), 090 (the API role's grants), 095 (app.actor_has_role),
--        098 (app.erasure_active), 902 (the consent wording columns)
--
-- The write floor under `document`. Until this, the table had none. Row
-- security fenced which practice's rows an actor could reach (090,
-- db/policies/client/readers.sql) and nothing at all said what an actor who
-- could reach a row might do to it. So anyone the practice had admitted could
-- file a piece of consent wording of their own, turn a draft into an approved
-- one, rewrite a version string, or repoint the `storage_key` and `sha256` of
-- the very row a signed consent names as "the exact wording shown". And
-- `is_immutable` was a column that meant nothing: nothing anywhere enforced it.
--
-- Row security cannot answer this. It asks which rows, not which columns, and
-- the question here is who is acting. So it is a guard trigger, the same
-- pattern and for the same reason as app.guard_location_notes()
-- (100_client_record.sql section 5) and CLAUDE.md section 5's "a guard
-- trigger, not a screen".
--
-- Four refusals:
--
--   (a) Nobody but the owner or an admin writes `purpose`, `locale`,
--       `version`, `status` or `retired_at`. Those five say which wording a
--       row is and whether it is the current one, and a practitioner has no
--       business saying either. On an insert that means: carry none of them.
--   (b) Nobody but the owner or an admin files a `consent_text` row at all.
--       Consent wording is the practice's own words, published to everyone;
--       it is not a file somebody uploads in passing.
--   (c) A row with `is_immutable` is neither changed nor deleted. The bytes
--       behind a filed consent, a signed report or a piece of wording are the
--       evidence of what a person was shown and agreed to. One change is
--       admitted, and only one: an owner or an admin may set `retired_at`
--       from null, once, with every other column on the row standing still.
--       That is retirement — the practice saying this wording is no longer
--       the current one — and it is not a rewrite of the record: what the row
--       says a person was shown does not move, and 902's
--       document_consent_text_current_idx needs the old version retired
--       before the new one can be filed. The comparison is structural, so a
--       column added to `document` after this trigger was written is guarded
--       by it rather than slipping past.
--   (d) `is_immutable` never goes back to false, by anyone, ever, erasure
--       included. A door that can be unlocked is not a lock, and this one has
--       no key on purpose.
--
-- Two things it deliberately does not do.
--
--   * It does not stand in the way of an erasure. app.erase_client
--     (100_client_record.sql section 6) deletes a client's own documents, some
--     of which are immutable — a signed consent image is exactly that — and a
--     household that asks to be forgotten outranks a rule written to stop the
--     record being quietly rewritten. The exemption is not a role or a flag
--     but the same fact 098_erasure_guard.sql already keeps: a row in
--     app.erasure_active naming this transaction. Nothing app_role can read
--     back and replay, and (d) holds even there.
--   * It does not fire when no role has been assumed at all — app.actor_roles
--     unset, never stamped for this transaction (096_api_role.sql). That is
--     the owner's own maintenance: a migration, a backfill, the seed's own
--     fixtures, a console session. Never a request through the API, which
--     always stamps a role. The reasoning is app.guard_location_notes()'s,
--     verbatim, and so is the behaviour.
--
-- **Retention, stated here because this is where a document's immutability is
-- enforced and the rule belongs beside it** (docs/SPEC/00-data-model.md
-- section 3, docs/SEAMS.md). A practice document is kept five years from
-- upload, computed by the application when it uploads
-- (`documentRetentionUntil` in domain/shared/storage.ts) and written to
-- `retention_until`. A `consent_text` document is **exempt from that clock**:
-- it is the text people were shown, and a consent recorded in year four of a
-- wording's life would outlive the words it points at. Such a row is kept
-- until no `consent` references it and the last referencing client's own
-- retention has expired, so its `retention_until` is deliberately null —
-- meaning "not on an upload clock", never "nobody computed it"
-- (db/seed/apply.ts says the same where it writes one). A deletion job must
-- therefore check what still references a document before it calls
-- `storage.delete`; deleting on `retention_until` alone would take the
-- wording out from under a consent that is still live.

------------------------------------------------------------------------------
-- 1. app.guard_document_write()
--
--    security definer, unlike app.guard_location_notes(), for one reason: it
--    reads app.erasure_active, and app_role holds no grant on that table and
--    must not (098_erasure_guard.sql section 1). Running as the owner is what
--    lets the check happen at all. It returns rows and raises exceptions and
--    does nothing else, so the wider privilege buys nothing beyond that read.
------------------------------------------------------------------------------
create function app.guard_document_write() returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_privileged boolean;
  v_erasing    boolean;
begin
  -- The owner's own maintenance, as in app.guard_location_notes().
  if nullif(current_setting('app.actor_roles', true), '') is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  v_privileged := app.actor_has_role('owner') or app.actor_has_role('admin');
  v_erasing := exists (select 1 from app.erasure_active where txid = txid_current());

  if tg_op = 'INSERT' then
    if not v_privileged then
      if new.kind = 'consent_text' then
        raise exception 'only the owner or an admin may file consent wording'
          using errcode = 'insufficient_privilege',
                hint    = 'A consent_text document is the practice''s own words, shown to everyone who signs.';
      end if;
      if num_nonnulls(new.purpose, new.locale, new.version, new.status, new.retired_at) > 0 then
        raise exception 'only the owner or an admin may set a document''s wording columns'
          using errcode = 'insufficient_privilege',
                hint    = 'purpose, locale, version, status and retired_at say which consent wording a row is.';
      end if;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.is_immutable and not v_erasing then
      raise exception 'that document is immutable and may not be deleted'
        using errcode = 'insufficient_privilege',
              hint    = 'An erasure may remove it (app.erase_client); nothing else may.';
    end if;
    return old;
  end if;

  -- update
  if old.is_immutable and not v_erasing
     and not (v_privileged
              and old.retired_at is null
              and new.retired_at is not null
              and (to_jsonb(new) - array['retired_at', 'updated_at'])
                  is not distinct from (to_jsonb(old) - array['retired_at', 'updated_at']))
  then
    raise exception 'that document is immutable and may not be changed'
      using errcode = 'insufficient_privilege',
            hint    = 'A correction is a new document, never an edit of the one already filed; retiring a wording is the one exception.';
  end if;

  if old.is_immutable and not new.is_immutable then
    raise exception 'is_immutable never goes back to false'
      using errcode = 'insufficient_privilege',
            hint    = 'A lock that can be opened is not a lock. File a new document instead.';
  end if;

  if not v_privileged and (
       new.purpose    is distinct from old.purpose
    or new.locale     is distinct from old.locale
    or new.version    is distinct from old.version
    or new.status     is distinct from old.status
    or new.retired_at is distinct from old.retired_at
  ) then
    raise exception 'only the owner or an admin may change a document''s wording columns'
      using errcode = 'insufficient_privilege',
            hint    = 'Retiring a wording and approving its replacement are the owner''s, or an admin''s.';
  end if;

  return new;
end
$$;
revoke execute on function app.guard_document_write() from public;

create trigger guard_document_write before insert or update or delete on public.document
  for each row execute function app.guard_document_write();

comment on column document.is_immutable is
  'Once true, the row is neither changed nor deleted (migration 903) and never goes back to false. Only an erasure may remove it.';

-- rollback:
--   comment on column document.is_immutable is null;
--   drop trigger if exists guard_document_write on public.document;
--   drop function if exists app.guard_document_write();
