-- 604_report_figure.sql
-- A brain-map report's pictures, and the link that ties each one to the
-- report that prints it (docs/SPEC/reports-qeeg.md sections 9, 11 and 13).
--
-- **What a picture is here.** A brain map the mapping software exported,
-- normalised once in the browser to an opaque 8-bit RGB PNG, checked by the
-- server to be exactly that, and filed as a `document` of the client, kind
-- `report_figure`. The report's content names it by that document's id and
-- the digest of its bytes (section 9, point 6). This table is the link: which
-- report may print which document, and at what size.
--
-- **A link holds no placement.** Where a map sits in the report — its
-- condition, its label, its place in the order, or a side of a follow-up's
-- pair — is the draft's to say, in its content, and nowhere else. A second
-- copy here would go stale at the first reorder, be copied on by every
-- borrow, and wait for a later reader to trust the wrong one (review of the
-- form's pictures, fix round 3). A link is the report, the client, the
-- document, the digest and the size.
--
-- **Why a link table and not a column on the report.** A report holds up to
-- eight maps and the two "later" pictures of a follow-up's pairs, and a
-- follow-up, a second-language report and a correction BORROW the earlier
-- report's stored documents rather than copying them (point 7). One document
-- is then printed by more than one report, which a column cannot say.
--
-- **The composite keys bind everything to one household**, the shape 501
-- and 502 set for `assessment_document`: the link's client is the report's
-- own client (`(tenant_id, report_id, client_id)` to `report`), the
-- document's own client (`(tenant_id, document_id, client_id)` to the key 911
-- and 502 put on `document`), and, for a borrowed link, the earlier report's
-- own client. A link can never name another household's picture, and a
-- borrow can never reach across two households.
--
-- **Frozen with the report** (point 5). While the report is a draft a map
-- may be added or removed; when it leaves draft its links admit no change,
-- and its own pictures become immutable documents (the trigger in section 7
-- sets `is_immutable`, which 903 then enforces for ever). The guard below
-- asks on EVERY connection, the owner's included: nothing but an erasure
-- (app.erasure_active) steps round it. One removal is admitted after a
-- report leaves draft: a past record withdrawn because it was kept against
-- the wrong client has its maps removed (section 11, point 7), which 603's
-- guard leaves to this file's functions. Removed means gone: the link, and
-- the picture itself, frozen or not, when the record was its only holder.
-- That is the one removal of a frozen picture besides an erasure, and it goes
-- through the erasure's own marker (section 6), so 903 is not edited: the
-- withdraw is a second user of that marker, for one statement.
--
-- **Nothing inserts or deletes here directly.** app_role holds select alone.
-- A picture arrives through `app.file_report_figure` (the upload door), a
-- borrowed one through `app.borrow_report_figure`, and one leaves through
-- `app.remove_report_figure`. Each reads the client off the report itself and
-- asks who is calling, because security definer means row security is not
-- going to.
--
-- **The bytes are not this migration's.** The document row names a storage
-- key; the route writes the bytes after the commit through the storage seam,
-- and removes them after the commit when a removal deletes the document
-- (docs/SEAMS.md). Nothing in SQL talks to a store.
--
-- **The household reads no `report_figure` row.** No policy grants
-- `client_contact` a read of this table (section 13;
-- db/policies/reports/figures.sql). The picture's own `document` row is
-- another matter: it is read under client-record's policy on `document`
-- (db/policies/client/readers.sql), whose contact arm admitted a household to
-- every document of their client, this kind included, and the Documents
-- route lists and signs links to every row that policy admits. This branch
-- narrows that arm, under docs/CHANGE-REQUESTS/reports-02.md request 11a:
-- a client contact reads no document of kind `report_figure`, and every other
-- document of their own client as before. So the household reads neither the
-- link nor the picture.
--
-- Needs: 010 (tenant), 020 (app_user), 060 (client, document), 080
-- (app.audit_row, app.set_updated_at), 095 (app.actor_has_role,
-- app.current_actor_id), 098 (app.erasure_active, app.begin_erasure and
-- app.end_erasure), 099 (client's
-- (tenant_id, id) key), 100 (app.current_tenant_id), 201
-- (app.client_visible_to_practitioner), 502 (document's (tenant_id, id,
-- client_id) key, which 911 also makes), 600 (report and its (tenant_id, id,
-- client_id) key), 602 (the brain-map kind and imported_from), 603 (the
-- imported status and the withdraw stamp, named as text below). Migration
-- 903's guard on `document` is what holds a frozen picture once
-- `is_immutable` is set; it sorts above this file and is not needed for it to
-- apply, so it is not named here.

------------------------------------------------------------------------------
-- 0. The key on `document`, if neither 502 nor 911 has put it there yet, for
--    502's own reason: whichever file the runner reaches first makes it.
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
  end if;
end
$$;

------------------------------------------------------------------------------
-- 1. The table.
------------------------------------------------------------------------------
create table report_figure (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references tenant (id),
  -- Denormalised so the audit trigger attributes the row without a join
  -- (097), and bound three ways below so it can only ever be the report's,
  -- the document's and the earlier report's own client.
  client_id               uuid not null references client (id),
  report_id               uuid not null,
  -- The picture: a document of the client, kind `report_figure`. The report's
  -- content names it by this id (`figureId`).
  document_id             uuid not null,
  -- Set when the picture is the earlier report's, borrowed (section 9,
  -- point 7); null when it was uploaded to this report.
  borrowed_from_report_id uuid,
  -- The digest of the bytes, as `document.sha256` holds it; the insert guard
  -- holds the two equal, so the content's digest is checked against one row.
  sha256                  bytea not null,
  width_px                integer not null,
  height_px               integer not null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  created_by              uuid references app_user (id),
  constraint report_figure_tenant_id_id_key unique (tenant_id, id),
  -- A picture is linked to a report once.
  constraint report_figure_once_per_report unique (tenant_id, report_id, document_id),
  constraint report_figure_client_fk
    foreign key (tenant_id, client_id) references client (tenant_id, id),
  constraint report_figure_report_fk
    foreign key (tenant_id, report_id, client_id)
    references report (tenant_id, id, client_id),
  constraint report_figure_document_fk
    foreign key (tenant_id, document_id, client_id)
    references document (tenant_id, id, client_id),
  constraint report_figure_borrowed_fk
    foreign key (tenant_id, borrowed_from_report_id, client_id)
    references report (tenant_id, id, client_id),
  constraint report_figure_borrowed_from_another
    check (borrowed_from_report_id is null or borrowed_from_report_id <> report_id),
  constraint report_figure_digest check (octet_length(sha256) = 32),
  -- The caps of section 9, point 3, held by the row as well as the door: a
  -- longer side of at most 4,096 pixels, and at most 12 million in all.
  constraint report_figure_size check (
    width_px between 1 and 4096 and height_px between 1 and 4096
    and width_px::bigint * height_px <= 12000000
  )
);
comment on table public.report_figure is
  'audited: client - a brain-map report''s pictures: which report may print which document '
  '(docs/SPEC/reports-qeeg.md section 9, migration 604)';

create index report_figure_tenant_idx on report_figure (tenant_id);
create index report_figure_client_idx on report_figure (client_id);
create index report_figure_report_idx on report_figure (report_id);
create index report_figure_document_idx on report_figure (document_id);
create index report_figure_borrowed_idx on report_figure (borrowed_from_report_id)
  where borrowed_from_report_id is not null;
create index report_figure_created_by_idx on report_figure (created_by);

create trigger set_updated_at before update on report_figure
  for each row execute function app.set_updated_at();
create trigger audit_row after insert or update or delete on report_figure
  for each row execute function app.audit_row();
alter table public.report_figure enable always trigger audit_row;

------------------------------------------------------------------------------
-- 2. The guard.
--
--    security definer for 903's reason: it reads app.erasure_active, which
--    app_role may not, and the report and document rows whatever row
--    security would show the caller. It returns rows and raises, and does
--    nothing else. `enable always`, and no exemption for a connection with no
--    role: a link frozen against its author must be frozen against the
--    owner's own console too, or it is not frozen.
--
--    Statuses are compared as text, 603's way. Each rule this file raises
--    as a check violation names itself (`constraint = …`), so the doors
--    answer those three with a sentence and any other check violation stays
--    a fault the error handler logs (app/api/reports/qeeg/databaseRefusal.ts).
------------------------------------------------------------------------------
create function app.guard_report_figure_write() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_status    text;
  v_kind      text;
  v_withdrawn boolean;
  v_from      text;
  v_from_gone boolean;
  v_doc_sha   bytea;
  v_doc_kind  text;
begin
  if exists (select 1 from app.erasure_active where txid = txid_current()) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'UPDATE' then
    raise exception 'a map''s link is never changed; remove it and add the picture again'
      using errcode = 'restrict_violation',
            hint    = 'While the report is a draft a map may be removed and another added.';
  end if;

  if tg_op = 'DELETE' then
    select r.status::text, r.withdrawn_at is not null into v_status, v_withdrawn
      from public.report r
     where r.tenant_id = old.tenant_id and r.id = old.report_id;
    -- A draft's map may be removed; so may a withdrawn past record's
    -- (section 11, point 7). A link whose report cannot be found is refused
    -- with the rest: the foreign key makes it unreachable, and a guard that
    -- admits what it cannot see is a guard with a hole in it.
    if v_status = 'draft' or (v_status = 'imported' and v_withdrawn) then
      return old;
    end if;
    if v_status is null then
      raise exception 'the report this map belongs to cannot be found, so the map stays'
        using errcode = 'restrict_violation';
    end if;
    raise exception 'report % has left draft and its maps are frozen with it', old.report_id
      using errcode = 'restrict_violation',
            hint    = 'A signed report is corrected by a new version, which borrows what it keeps.';
  end if;

  -- insert
  select r.status::text, r.kind::text into v_status, v_kind
    from public.report r
   where r.tenant_id = new.tenant_id and r.id = new.report_id;
  if v_kind is distinct from 'qeeg' then
    raise exception 'only a brain-map report holds maps'
      using errcode = 'check_violation', constraint = 'report_figure_brain_map_only';
  end if;
  if v_status is distinct from 'draft' then
    raise exception 'report % has left draft and its maps are frozen with it', new.report_id
      using errcode = 'restrict_violation',
            hint    = 'A signed report is corrected by a new version, which borrows what it keeps.';
  end if;

  select d.sha256, d.kind into v_doc_sha, v_doc_kind
    from public.document d
   where d.tenant_id = new.tenant_id and d.id = new.document_id;
  if v_doc_sha is distinct from new.sha256 then
    raise exception 'the link''s digest is not the digest of the document it names'
      using errcode = 'check_violation', constraint = 'report_figure_digest_matches';
  end if;
  if v_doc_kind is distinct from 'report_figure' then
    raise exception 'a report prints a brain map filed as one, and that document is not'
      using errcode = 'check_violation', constraint = 'report_figure_is_a_map';
  end if;

  if new.borrowed_from_report_id is not null then
    -- Borrowed from a report that is signed, or kept and not withdrawn, and
    -- that itself prints this picture. Never from a draft, whose maps may
    -- still go; never a picture the earlier report does not hold.
    select r.status::text, r.withdrawn_at is not null into v_from, v_from_gone
      from public.report r
     where r.tenant_id = new.tenant_id and r.id = new.borrowed_from_report_id;
    if not (v_from in ('issued', 'superseded') or (v_from = 'imported' and not v_from_gone)) then
      raise exception 'a map is borrowed from a signed report or a kept past record'
        using errcode = 'restrict_violation';
    end if;
    if not exists (select 1 from public.report_figure f
                    where f.tenant_id = new.tenant_id
                      and f.report_id = new.borrowed_from_report_id
                      and f.document_id = new.document_id) then
      raise exception 'the earlier report does not print that picture'
        using errcode = 'foreign_key_violation';
    end if;
  end if;

  return new;
end
$$;
revoke execute on function app.guard_report_figure_write() from public;

create trigger guard_report_figure_write before insert or update or delete on public.report_figure
  for each row execute function app.guard_report_figure_write();
alter table public.report_figure enable always trigger guard_report_figure_write;

------------------------------------------------------------------------------
-- 3. Who may touch a report's maps, asked once for the three functions.
--
--    The report policies' own answer (db/policies/reports/reports.sql),
--    restated because a security definer function is not under them: the
--    owner, the lead practitioner, or a practitioner with the client on their
--    schedule; a draft read from the old tool's file only the owner and the
--    lead practitioner (reports-02 request 6); and nobody for a client who
--    has been erased.
------------------------------------------------------------------------------
create function app.may_touch_report_figures(p_client_id uuid, p_imported boolean) returns boolean
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select app.client_status_for(p_client_id)::text is distinct from 'erased'
     and (app.actor_has_role('owner') or app.actor_has_role('lead_practitioner')
          or (not p_imported and app.actor_has_role('practitioner')
              and app.client_visible_to_practitioner(p_client_id)))
$$;
revoke execute on function app.may_touch_report_figures(uuid, boolean) from public;

------------------------------------------------------------------------------
-- 4. A picture uploaded to a draft.
--
--    The document row and the link together, or neither; the report's own
--    `updated_at` moved with them, because a map added is a change to the
--    draft and the editor's next save must be made over it (brief L, "For
--    PR 7"). The client comes off the report and never from the caller.
--
--    **Idempotent on the digest.** A browser whose connection dropped after
--    the commit asks again with the same bytes and is handed the same
--    document, as `app.file_assessment_document` is.
--
--    **Eight to a report** (section 9, point 3), counting the pictures
--    uploaded to it. A borrowed picture is the earlier report's and was
--    counted there.
--
--    Filed mutable: while the report is a draft the picture may still be
--    removed, and removed means gone. The freeze below makes it immutable
--    the moment the report leaves draft.
------------------------------------------------------------------------------
create function app.file_report_figure(
  p_report_id       uuid,
  -- The caller's, because the storage key is built from it (domain/shared/storage.ts).
  p_document_id     uuid,
  p_storage_key     text,
  p_sha256          bytea,
  p_width_px        integer,
  p_height_px       integer,
  p_retention_until timestamptz
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_tenant_id uuid := app.current_tenant_id();
  v_actor_id  uuid := app.current_actor_id();
  v_report    record;
  v_existing  uuid;
  v_count     int;
begin
  if v_tenant_id is null then
    raise exception 'No practice in context; a map cannot be filed.'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Locked, so a signing, a save and a second upload wait their turn.
  select r.client_id, r.status::text as status, r.kind::text as kind,
         r.imported_from is not null as imported
    into v_report
    from public.report r
   where r.tenant_id = v_tenant_id and r.id = p_report_id
     for update;
  if not found then
    raise exception 'There is no such report in this practice.' using errcode = 'no_data_found';
  end if;
  if not app.may_touch_report_figures(v_report.client_id, v_report.imported) then
    raise exception 'that report is not one you may add a map to'
      using errcode = 'insufficient_privilege';
  end if;
  if v_report.kind <> 'qeeg' then
    raise exception 'only a brain-map report holds maps'
      using errcode = 'check_violation', constraint = 'report_figure_brain_map_only';
  end if;
  if v_report.status <> 'draft' then
    raise exception 'report % has left draft and its maps are frozen with it', p_report_id
      using errcode = 'restrict_violation';
  end if;

  select f.document_id into v_existing
    from public.report_figure f
   where f.tenant_id = v_tenant_id and f.report_id = p_report_id
     and f.borrowed_from_report_id is null and f.sha256 = p_sha256
   limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  select count(*) into v_count
    from public.report_figure f
   where f.tenant_id = v_tenant_id and f.report_id = p_report_id
     and f.borrowed_from_report_id is null;
  if v_count >= 8 then
    raise exception 'a report holds eight maps' using errcode = 'program_limit_exceeded';
  end if;

  insert into public.document (
    id, tenant_id, client_id, kind, storage_key, mime_type, sha256,
    uploaded_by, retention_until, is_immutable, created_by
  ) values (
    p_document_id, v_tenant_id, v_report.client_id, 'report_figure', p_storage_key,
    'image/png', p_sha256, v_actor_id, p_retention_until, false, v_actor_id
  );

  insert into public.report_figure (
    tenant_id, client_id, report_id, document_id, sha256, width_px, height_px, created_by
  ) values (
    v_tenant_id, v_report.client_id, p_report_id, p_document_id, p_sha256, p_width_px,
    p_height_px, v_actor_id
  );

  update public.report set updated_at = now()
   where tenant_id = v_tenant_id and id = p_report_id;

  return p_document_id;
end
$$;
revoke execute on function app.file_report_figure(
  uuid, uuid, text, bytea, integer, integer, timestamptz) from public;
grant execute on function app.file_report_figure(
  uuid, uuid, text, bytea, integer, integer, timestamptz) to app_role;

------------------------------------------------------------------------------
-- 5. A picture borrowed from an earlier report (section 9, point 7).
--
--    A follow-up's earlier pictures, a second-language report's maps and a
--    correction's are links to the first report's stored documents. The
--    earlier report must be the same client's (the composite key says so as
--    well), a brain map, and signed or kept; the picture must be one it
--    prints. The link copies the earlier link's size; where the picture
--    sits in the new report is that report's content's to say.
--
--    It does not move `updated_at`: every caller is itself writing the report
--    row in the same transaction (the draft save, and later the twin and the
--    correction), and a second write would be a second row on the trail for
--    one act. Idempotent: a picture already linked is handed back.
------------------------------------------------------------------------------
create function app.borrow_report_figure(
  p_report_id      uuid,
  p_from_report_id uuid,
  p_document_id    uuid
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_tenant_id uuid := app.current_tenant_id();
  v_actor_id  uuid := app.current_actor_id();
  v_report    record;
  v_from      record;
  v_link      public.report_figure;
begin
  if v_tenant_id is null then
    raise exception 'No practice in context; a map cannot be borrowed.'
      using errcode = 'invalid_parameter_value';
  end if;

  select r.client_id, r.status::text as status, r.kind::text as kind,
         r.imported_from is not null as imported
    into v_report
    from public.report r
   where r.tenant_id = v_tenant_id and r.id = p_report_id
     for update;
  if not found then
    raise exception 'There is no such report in this practice.' using errcode = 'no_data_found';
  end if;
  if not app.may_touch_report_figures(v_report.client_id, v_report.imported) then
    raise exception 'that report is not one you may add a map to'
      using errcode = 'insufficient_privilege';
  end if;
  if v_report.kind <> 'qeeg' then
    raise exception 'only a brain-map report holds maps'
      using errcode = 'check_violation', constraint = 'report_figure_brain_map_only';
  end if;
  if v_report.status <> 'draft' then
    raise exception 'report % has left draft and its maps are frozen with it', p_report_id
      using errcode = 'restrict_violation';
  end if;

  select r.client_id, r.status::text as status, r.kind::text as kind,
         r.withdrawn_at is not null as withdrawn
    into v_from
    from public.report r
   where r.tenant_id = v_tenant_id and r.id = p_from_report_id;
  if not found or v_from.client_id <> v_report.client_id then
    -- Another household's report is no report here, and says nothing more.
    raise exception 'a map is borrowed from an earlier report of the same client'
      using errcode = 'foreign_key_violation';
  end if;
  if v_from.kind <> 'qeeg'
     or not (v_from.status in ('issued', 'superseded')
             or (v_from.status = 'imported' and not v_from.withdrawn)) then
    raise exception 'a map is borrowed from a signed report or a kept past record'
      using errcode = 'restrict_violation';
  end if;

  if exists (select 1 from public.report_figure f
              where f.tenant_id = v_tenant_id and f.report_id = p_report_id
                and f.document_id = p_document_id) then
    return p_document_id;
  end if;

  select * into v_link
    from public.report_figure f
   where f.tenant_id = v_tenant_id and f.report_id = p_from_report_id
     and f.document_id = p_document_id;
  if not found then
    raise exception 'the earlier report does not print that picture'
      using errcode = 'foreign_key_violation';
  end if;

  insert into public.report_figure (
    tenant_id, client_id, report_id, document_id, borrowed_from_report_id, sha256,
    width_px, height_px, created_by
  ) values (
    v_tenant_id, v_report.client_id, p_report_id, p_document_id, p_from_report_id,
    v_link.sha256, v_link.width_px, v_link.height_px, v_actor_id
  );

  return p_document_id;
end
$$;
revoke execute on function app.borrow_report_figure(uuid, uuid, uuid) from public;
grant execute on function app.borrow_report_figure(uuid, uuid, uuid) to app_role;

------------------------------------------------------------------------------
-- 6. A picture removed.
--
--    From a draft; or from a past record once it has been withdrawn, by the
--    owner or the lead practitioner (section 11, point 7). The link goes.
--    A picture that was uploaded to this report, and that nothing else now
--    links, goes with it — row now, bytes after the commit: the function
--    answers the storage key the route removes, or null when the document
--    stays (borrowed from another report, or still linked by one).
--
--    **A withdrawn past record's own pictures go although they are frozen.**
--    Keeping it froze them (section 7), and 903 refuses to delete an
--    immutable document outside an erasure. But a record withdrawn was kept
--    against the WRONG client: its pictures are another person's brain maps,
--    filed under this client, where the Documents tab would list them and
--    sign links to them for as long as the record lasts. Point 7 says maps
--    removed, and that must mean the pictures, not only the links. So, for
--    that branch alone, the delete runs inside `app.begin_erasure()` /
--    `app.end_erasure()` (098), for one statement, limited to a document of
--    kind `report_figure` that no link holds. The marker is what 903 and the
--    document's own guards already step aside for, and it makes the delete's
--    audit row read `[withheld: erasure]`, which is right for a picture of
--    another person. The marker is set only when no erasure is already under
--    way in this transaction, and cleared only if this function set it.
--    Every other branch keeps `not d.is_immutable`: a draft's pictures are
--    mutable, and nothing frozen on a signed or kept report is ever deleted.
--    While the report is a draft, `updated_at` moves as it does for an upload.
------------------------------------------------------------------------------
create function app.remove_report_figure(p_report_id uuid, p_document_id uuid) returns text
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_tenant_id uuid := app.current_tenant_id();
  v_report    record;
  v_link      public.report_figure;
  v_key       text;
  v_marked    boolean;
begin
  if v_tenant_id is null then
    raise exception 'No practice in context; a map cannot be removed.'
      using errcode = 'invalid_parameter_value';
  end if;

  select r.client_id, r.status::text as status, r.kind::text as kind,
         r.imported_from is not null as imported, r.withdrawn_at is not null as withdrawn
    into v_report
    from public.report r
   where r.tenant_id = v_tenant_id and r.id = p_report_id
     for update;
  if not found then
    raise exception 'There is no such report in this practice.' using errcode = 'no_data_found';
  end if;
  if not app.may_touch_report_figures(v_report.client_id, v_report.imported) then
    raise exception 'that report is not one you may remove a map from'
      using errcode = 'insufficient_privilege';
  end if;
  if not (v_report.status = 'draft' or (v_report.status = 'imported' and v_report.withdrawn)) then
    raise exception 'report % has left draft and its maps are frozen with it', p_report_id
      using errcode = 'restrict_violation';
  end if;

  delete from public.report_figure f
   where f.tenant_id = v_tenant_id and f.report_id = p_report_id
     and f.document_id = p_document_id
  returning * into v_link;
  if not found then
    raise exception 'That report holds no such map.' using errcode = 'no_data_found';
  end if;

  if v_link.borrowed_from_report_id is null
     and not exists (select 1 from public.report_figure f
                      where f.tenant_id = v_tenant_id and f.document_id = p_document_id) then
    if v_report.status = 'imported' and v_report.withdrawn then
      -- Point 7: a withdrawn record's own picture goes, frozen as it is.
      v_marked := not exists (select 1 from app.erasure_active where txid = txid_current());
      if v_marked then
        perform app.begin_erasure();
      end if;
      delete from public.document d
       where d.tenant_id = v_tenant_id and d.id = p_document_id
         and d.kind::text = 'report_figure'
      returning d.storage_key into v_key;
      if v_marked then
        perform app.end_erasure();
      end if;
    else
      delete from public.document d
       where d.tenant_id = v_tenant_id and d.id = p_document_id and not d.is_immutable
      returning d.storage_key into v_key;
    end if;
  end if;

  if v_report.status = 'draft' then
    update public.report set updated_at = now()
     where tenant_id = v_tenant_id and id = p_report_id;
  end if;

  return v_key;
end
$$;
revoke execute on function app.remove_report_figure(uuid, uuid) from public;
grant execute on function app.remove_report_figure(uuid, uuid) to app_role;

------------------------------------------------------------------------------
-- 7. The freeze. When a report leaves draft — signed, or kept as a past
--    record — the pictures uploaded to it become immutable documents, which
--    migration 903 then holds for ever: never changed, never deleted, except
--    by an erasure. A borrowed picture was frozen by the report it came from.
--
--    security definer: app_role may not update `document` rows it did not
--    file, and the report's signer need not be the person who uploaded.
------------------------------------------------------------------------------
create function app.freeze_report_figures() returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  if old.status::text = 'draft' and new.status::text <> 'draft' then
    update public.document d
       set is_immutable = true
      from public.report_figure f
     where f.tenant_id = new.tenant_id and f.report_id = new.id
       and f.borrowed_from_report_id is null
       and d.tenant_id = f.tenant_id and d.id = f.document_id
       and not d.is_immutable;
  end if;
  return null;
end
$$;
revoke execute on function app.freeze_report_figures() from public;

create trigger freeze_report_figures after update of status on public.report
  for each row execute function app.freeze_report_figures();
alter table public.report enable always trigger freeze_report_figures;

------------------------------------------------------------------------------
-- 8. Privileges. Read only; the three functions above are the doors. An
--    erasure takes the links away as the owner, which needs no grant.
------------------------------------------------------------------------------
do $$
declare
  has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
                       and exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  alter table public.report_figure enable row level security;
  revoke all on public.report_figure from public;
  if has_api_roles then
    revoke all on public.report_figure from anon, authenticated;
  end if;
  grant select on public.report_figure to app_role;
end
$$;

-- rollback:
--   -- Every link must go first, and every document of kind report_figure with
--   -- it, by the owner's own maintenance inside an erasure marker: the guard
--   -- refuses a frozen link to anybody else.
--   revoke select on public.report_figure from app_role;
--   drop trigger if exists freeze_report_figures on public.report;
--   drop function if exists app.freeze_report_figures();
--   drop function if exists app.remove_report_figure(uuid, uuid);
--   drop function if exists app.borrow_report_figure(uuid, uuid, uuid);
--   drop function if exists app.file_report_figure(
--     uuid, uuid, text, bytea, integer, integer, timestamptz);
--   drop function if exists app.may_touch_report_figures(uuid, boolean);
--   drop trigger if exists guard_report_figure_write on public.report_figure;
--   drop function if exists app.guard_report_figure_write();
--   drop trigger if exists audit_row on public.report_figure;
--   drop table if exists public.report_figure;
--   -- The key on document stays: 502 and 911 own it.
