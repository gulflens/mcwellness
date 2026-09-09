-- 960_retire_the_setup_photograph.sql
-- Needs: 306 (the setup photograph's functions, its filing marker and the
--        closed-session trigger this file replaces)
--
-- The practice takes no photographs.
--
-- **Its legal advisor, 2026-09-09**, on the ground that McWellness does not
-- intend to photograph clients or their sessions: the photo consent comes out
-- of the documents. The wording that authorised a setup photograph is
-- superseded (docs/CONSENT/superseded/photo-video.en.md), the capture routes
-- are deleted and the camera is gone from the practitioner's screen, so the
-- doors below have nothing left to open. A guard with nothing to guard is a
-- guard somebody later mistakes for permission, which is why they go in the
-- same round as the words rather than a tidier one of their own.
--
-- **`session.setup_photo_document_id` stays.** A visit photographed before
-- today still names its picture, the three erasure functions (105, 106, 107)
-- unlink it by name when a household is erased, and a column a released
-- function names is not one to drop underneath it. It is read-only from here:
-- nothing can set it, because nothing can file a photograph.
--
-- This is a trunk file in the 950–999 half rather than 900–949 because it
-- builds on a stream's own tables — `session` and session-capture's schema —
-- and must therefore sort last (docs/SPEC/OWNERSHIP.md).

-- A closed visit now admits no change at all. The photograph's link was the
-- single exception, and it existed because the bytes could arrive from a
-- device long after check-out; with nothing to file, the exception is only a
-- way in. Everything else in this function is unchanged.
create or replace function app.session_refuse_update_after_close() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if old.closed_at is null
     or exists (select 1 from app.erasure_active where txid = txid_current()) then
    return new;
  end if;
  -- to_jsonb rather than `new is not distinct from old`: the row carries a
  -- geography column, and this comparison must not depend on which types
  -- happen to have an equality operator today.
  if to_jsonb(new) is not distinct from to_jsonb(old) then
    return null;
  end if;
  raise exception 'session % is closed and cannot be changed; correct it with a new version',
    old.id
    using errcode = 'restrict_violation';
end
$$;

drop function if exists app.file_setup_photo(uuid, uuid);
drop function if exists app.file_setup_photo_document(uuid, uuid, text, text, bytea, timestamptz);
drop function if exists app.previous_setup_photo(uuid);
drop function if exists app.setup_photo_consent_active(uuid);

-- The filing marker went with the only transaction that ever set it.
drop table if exists app.setup_photo_filing;

-- rollback:
--   -- Re-apply db/migrations/306_kit_and_setup_photo.sql from the line
--   -- creating app.setup_photo_consent_active to the end of the file: it
--   -- creates the four functions, the marker table with its grants and row
--   -- level security, and the version of the trigger that admits a
--   -- photograph's link on a closed visit.
--   --
--   -- Nothing needs undoing in `document` or in `session`: this file drops no
--   -- column and deletes no row, so a database rolled back holds every
--   -- photograph it held before.
