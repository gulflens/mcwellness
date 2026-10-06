-- 214_location_notice_1_2.sql
-- The staff notice on sharing location moves to version 1.2
-- (docs/CONSENT/staff/location.en.md; approved by the operator on 6 October
-- 2026; round 76, docs/SPEC/dispatch.md section 15.12). Version 1.2 speaks to
-- the family members who help on the day as well as to practitioners: whose
-- working day theirs is, that helpers see no position, theirs included, and
-- what happens when the practice stops their helping.
--
-- `app.staff_location_notice_version()` is the database's copy of
-- `STAFF_LOCATION_NOTICE_VERSION` (domain/scheduling/locationSharing.ts), and
-- tests/dispatch/db/location.test.ts holds the two equal. 212 made it and is
-- merged, so it is replaced here rather than edited there, as 212's own
-- header says a new notice is done.
--
-- What this does to people who agreed to 1.1: `app.location_sharing_active`
-- (212) counts a consent only for the version this function names, so from
-- this migration a standing consent to 1.1 neither writes a position nor
-- shows the last one on the board. Sharing pauses, the person's screen says
-- the notice has changed and offers the new one, and accepting it withdraws
-- the 1.1 consent and records a 1.2 one (app/api/location/routes.ts). Nobody's
-- agreement is carried forward to words they have not read.
--
-- Same signature, attributes restated (create or replace keeps the grant).
--
-- Needs: 212 (the function replaced here)

create or replace function app.staff_location_notice_version() returns text
language sql immutable
set search_path = pg_catalog, pg_temp
as $$ select '1.2'::text $$;

-- rollback:
--   create or replace function app.staff_location_notice_version() returns text
--   language sql immutable
--   set search_path = pg_catalog, pg_temp
--   as $$ select '1.1'::text $$;
--   (and STAFF_LOCATION_NOTICE_VERSION back to '1.1' with the notice file and
--   app/therapist/location/notice.ts restored to version 1.1 in the same
--   change; consents given to 1.2 then pause in their turn.)
