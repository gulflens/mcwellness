-- 502_assessment_document_key.sql
-- The other half of the binding between a filed export and a household, said
-- as a foreign key rather than as a trigger (docs/SPEC/assessment.md section
-- 11; the note on the composite key in
-- docs/CHANGE-REQUESTS/assessment-01.md).
--
-- **What 501 could not do.** Its composite key ties a link row to the
-- *assessment's* own client. The other half — tying it to the *document's* —
-- had no key on `document` to point at, and adding one is an alter of a core
-- table, which is the trunk's. So 501 used a guard trigger,
-- `app.assessment_document_is_the_clients`, and wrote down what the trunk
-- would need. The trunk has done it: `document_tenant_id_client_key`
-- (migration 911).
--
-- **Why this replaces the trigger rather than sitting beside it.** They ask
-- the same question, and two answers to one question is one more thing to keep
-- in step. The foreign key is the better of the two: the database checks it on
-- every write, `session_replication_role = replica` cannot switch it off the
-- way it can a trigger that is not `enable always`, and it is visible in the
-- schema rather than in a function body. The deny case is unchanged and so is
-- its SQLSTATE — a foreign key raises 23503, exactly as the trigger did, so
-- `tests/assessment/db/rls.test.ts` reads the same answer it always did.
--
-- **501 is not edited**, as no merged migration ever is
-- (.claude/rules/data-model.md). The trigger and its function are dropped
-- here, forward-only.
--
-- **Why the key is created here as well as in 911.** The runner applies
-- pending files in numeric order, so on a fresh database this file is reached
-- before any 9xx: the key would not yet exist and the foreign key below would
-- fail outright. `checkNeeds` refuses a `-- Needs:` naming a higher number for
-- exactly that reason, and it is right to. So the constraint is created here
-- when it is not already there, under the same guard 911 uses, and whichever
-- file the runner reaches first creates it. This is the same wall migration
-- 601 hit with `contact_tenant_id_client_key`, answered the other way about:
-- there the key stayed in the stream's file, here it has a home in the
-- trunk's and this file only makes sure it exists in time. A database that
-- carries the trunk's range and not this one still gets the key, from 911.
--
-- Needs: 060 (document), 099 (document_tenant_id_id_key), 500 (assessment),
-- 501 (assessment_document, and the trigger this replaces)

------------------------------------------------------------------------------
-- 1. The key on `document`, if 911 has not already put it there.
------------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'document_tenant_id_client_key'
       and conrelid = 'public.document'::regclass
  ) then
    alter table public.document
      add constraint document_tenant_id_client_key unique (tenant_id, id, client_id);
    comment on constraint document_tenant_id_client_key on public.document is
      'The client-scoped key a composite foreign key points at, so a row naming a document '
      'names that document''s own client and cannot name another household''s. Null client_id '
      'is a practice document, which no client-scoped row can reach under MATCH SIMPLE '
      '(migration 911).';
  end if;
end
$$;

------------------------------------------------------------------------------
-- 2. The binding itself, replacing the guard trigger of 501.
--
--    The narrower foreign key 501 declared — (tenant_id, document_id) —
--    goes with it: this one names the same two columns and a third, so it
--    says everything the old one did and one thing more.
------------------------------------------------------------------------------
alter table public.assessment_document
  drop constraint assessment_document_document_fk;

alter table public.assessment_document
  add constraint assessment_document_document_fk
  foreign key (tenant_id, document_id, client_id)
  references public.document (tenant_id, id, client_id);

drop trigger if exists the_document_is_the_clients on public.assessment_document;
drop function if exists app.assessment_document_is_the_clients();

-- rollback:
--   alter table public.assessment_document drop constraint assessment_document_document_fk;
--   alter table public.assessment_document
--     add constraint assessment_document_document_fk
--     foreign key (tenant_id, document_id) references public.document (tenant_id, id);
--   create function app.assessment_document_is_the_clients() returns trigger
--   language plpgsql
--   set search_path = pg_catalog, pg_temp
--   as $fn$
--   declare
--     v_document_client uuid;
--   begin
--     select d.client_id into v_document_client
--       from public.document d
--      where d.id = new.document_id and d.tenant_id = new.tenant_id;
--     if v_document_client is distinct from new.client_id then
--       raise exception 'that document is not filed against this assessment''s client'
--         using errcode = 'foreign_key_violation';
--     end if;
--     return new;
--   end
--   $fn$;
--   revoke execute on function app.assessment_document_is_the_clients() from public;
--   create trigger the_document_is_the_clients before insert or update
--     on public.assessment_document
--     for each row execute function app.assessment_document_is_the_clients();
--   alter table public.assessment_document enable always trigger the_document_is_the_clients;
--   -- The key on document stays: migration 911 owns it.
