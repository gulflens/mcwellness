-- 103_consent_witness.sql
-- Needs: 020 (app_user), 060 (consent)
--
-- The second member of staff a verbal re-confirmation requires
-- (docs/SPEC/client-record.md section 7: "Method `verbal_witnessed`:
-- practitioner records, second staff member confirms; allowed only for
-- `home_visit` re-confirmation, never for initial `participation`").
--
-- The method existed in the enum from 060 and the route admitted it, but the
-- witness was recorded nowhere at all: a consent could say "confirmed
-- verbally, witnessed" and the record could not say by whom. A witness nobody
-- can name is not a witness, and this is the one method that files no
-- document — the row is the only evidence there is.
--
-- Nullable, no default, so nothing is backfilled and no existing row changes
-- meaning: every consent recorded before this column, and every consent given
-- by signature or on paper, has no witness and never did. The check
-- constraint says which rows may carry one — a witness belongs to a verbal
-- re-confirmation and to nothing else — and it is satisfied by every existing
-- row, all of which are null here.
--
-- **What this column does not enforce, and where that lives instead.** That a
-- witness is *present* for a verbal re-confirmation, that they are not the
-- person recording it, and that a re-confirmation only ever follows a
-- home_visit consent already on file are all refused by
-- app/api/clients/consents.ts, which is the only writer of this table and the
-- only place the acting person is known. A check constraint cannot see the
-- actor, and a trigger that read app.actor_id would refuse the seed and the
-- owner's own maintenance for no gain (the reasoning app.guard_location_notes
-- records).
--
-- `consent` is already audited (080_audit_triggers.sql), already carries its
-- grants and row security (090_grants_and_rls.sql), and its write floor is
-- db/policies/client/writers.sql. A column added to an audited table is
-- audited with it: no table changes classification here, no grant moves, and
-- no policy changes.
--
-- app.erase_client (100_client_record.sql section 6) deliberately does not
-- clear this column. It names a member of staff, not the household: an
-- erasure takes away what the practice holds about the client, and who
-- witnessed a confirmation is the practice's own record of its own people.

alter table consent
  add column witnessed_by_user_id uuid references app_user (id);

create index consent_witnessed_by_idx on consent (witnessed_by_user_id);

alter table consent
  add constraint consent_witness_is_a_verbal_reconfirmation
  check (witnessed_by_user_id is null or method = 'verbal_witnessed');

comment on column consent.witnessed_by_user_id is
  'The second member of staff who confirmed a verbal re-confirmation '
  '(client-record.md section 7). Null for every other method, and for a '
  'verbal consent recorded before this column existed. Never the person who '
  'recorded the consent: app/api/clients/consents.ts refuses that.';

-- rollback:
--   alter table consent drop constraint if exists consent_witness_is_a_verbal_reconfirmation;
--   drop index if exists consent_witnessed_by_idx;
--   alter table consent drop column if exists witnessed_by_user_id;
