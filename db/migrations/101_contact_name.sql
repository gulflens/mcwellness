-- 101_contact_name.sql
-- Needs: 060 (contact)
--
-- A contact has a name (docs/CHANGE-REQUESTS/client-record-02.md CR-07).
--
-- `contact` carried a relationship, four permission flags, a phone, an email
-- and an optional identity number, and no name at all. So every screen that
-- listed a contact said "Mother" and never who: the record's Contacts tab,
-- the Overview's key contacts, the enrolment summary. Awkward on a list of
-- three, and a real problem in two places.
--
--   * Consent. A minor_participation consent is valid only because a legal
--     guardian gave it — domain/client's canActivate checks exactly that —
--     and until now the record could not say which person that was. "Given
--     by: Mother" is not an identification, and a household may hold two
--     contacts with the same relationship.
--   * Arriving at the door. The practitioner's brief names the household by
--     the client; who to ask for is the contact, and there was nobody to ask
--     for.
--
-- `app_user` has `display_name`, but a contact who never signs in has no
-- `app_user` row: `contact.user_id` is nullable precisely because most never
-- will.
--
-- Four columns rather than one `full_name`, matching `client`, which splits
-- both and carries both scripts; the console renders the Arabic pair with
-- lang="ar" dir="rtl" as it already does for a client's.
--
-- All four are nullable and none has a default, so nothing is backfilled and
-- nothing invents a name: a contact known only by its relationship predates
-- this column and stays that way. A lead is still one name and one phone
-- (docs/SPEC/client-record.md section 3), so a contact's own name is never
-- required to save one.
--
-- CR-07 proposed this in the trunk's own 9NN range on the reasoning that an
-- identity for a core person belongs in the core schema. The operator placed
-- it here instead (2026-09-03): `contact` is the client aggregate, this
-- worktree owns it, and its range is 100-199.
--
-- `contact` is already audited (080_audit_triggers.sql), already carries its
-- grants and row security (090_grants_and_rls.sql), and its write floor is
-- db/policies/client/writers.sql. Columns added to an audited table are
-- audited with it: no table changes classification here, no grant moves, and
-- no policy changes. A name is an ordinary personal field — captured in
-- old_values / new_values like `client.given_name` already is, withheld
-- wholesale by app.audit_redact under an erasure, and nulled by
-- app.erase_client's own column list, which 100_client_record.sql builds from
-- the table's columns rather than a fixed list.

alter table contact
  add column given_name     text,
  add column family_name    text,
  add column given_name_ar  text,
  add column family_name_ar text;

comment on column contact.given_name is
  'The person to ask for at the door, and the person a consent was given by. '
  'Nullable: a contact known only by relationship predates this column.';
comment on column contact.family_name is
  'See contact.given_name. Nullable for the same reason.';
comment on column contact.given_name_ar is
  'The Arabic given name, rendered lang="ar" dir="rtl". Nullable.';
comment on column contact.family_name_ar is
  'The Arabic family name, rendered lang="ar" dir="rtl". Nullable.';

-- rollback:
--   alter table contact drop column if exists family_name_ar;
--   alter table contact drop column if exists given_name_ar;
--   alter table contact drop column if exists family_name;
--   alter table contact drop column if exists given_name;
