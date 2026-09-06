-- 911_document_client_key.sql
-- The client-scoped key on `document`, so a row that names a document can also
-- be made to name that document's own client.
--
-- Asked for by the assessment stream (default 5 and the note on the composite
-- key in docs/CHANGE-REQUESTS/assessment-01.md): "if the trunk would rather
-- have the key, `document` needs `unique (tenant_id, id, client_id)` in a
-- `9xx` migration and the trigger can go". It would rather. A foreign key is
-- checked by the database on every write, cannot be switched off with
-- `session_replication_role`, and says what it means in the schema rather than
-- in a function somebody has to go and read.
--
-- **Why the first half of the trunk's range.** `document` is a core table
-- (000-099), so a migration that alters it is the trunk's, and 900-949 is
-- where the trunk's work on core tables goes (docs/SPEC/OWNERSHIP.md).
--
-- **It is additive and cannot fail.** `id` is already the primary key, so
-- `(tenant_id, id, client_id)` is a superset of a uniqueness that already
-- holds — the same reasoning `invoice_tenant_id_client_key` (402) and
-- `contact_tenant_id_client_key` (601) record for their own tables.
--
-- **`client_id` is nullable here, and that is the point.** A practice document
-- — a practitioner's certificate, the consent wording — is filed against no
-- client at all. Under the default MATCH SIMPLE, a foreign key naming this key
-- from a table whose own `client_id` is not null therefore cannot reach one of
-- those rows: a practice document is not evidence of anybody's measurement,
-- and this is the shape that says so.
--
-- **Written so it may already be there.** On a fresh database the runner
-- applies pending files in numeric order, so `502_assessment_document_key.sql`
-- — which needs this key to point a foreign key at — is reached first, and
-- creates it itself under the same guard. Whichever of the two arrives first
-- creates the constraint and the other finds it. On a database carrying the
-- trunk's range and not the assessment stream's, this file is the only one
-- that ever creates it, which is why it exists at all rather than living in
-- 502 alone.
--
-- Needs: 060 (document), 099 (document_tenant_id_id_key, the key this one
-- widens rather than replaces)

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'document_tenant_id_client_key'
       and conrelid = 'public.document'::regclass
  ) then
    alter table public.document
      add constraint document_tenant_id_client_key unique (tenant_id, id, client_id);
  end if;
end
$$;

comment on constraint document_tenant_id_client_key on public.document is
  'The client-scoped key a composite foreign key points at, so a row naming a document names '
  'that document''s own client and cannot name another household''s. Null client_id is a '
  'practice document, which no client-scoped row can reach under MATCH SIMPLE (migration 911).';

-- rollback:
--   -- Refuse while anything still points at it: db/migrations/502 does.
--   alter table public.document drop constraint if exists document_tenant_id_client_key;
