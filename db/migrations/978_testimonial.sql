-- 978_testimonial.sql
-- Needs: 000 (app_role, app.set_updated_at), 010 (tenant), 020 (app_user),
--        090 (app_role's usage on public), 095 (app.actor_has_role),
--        099 (app_user's tenant-scoped key), 917 (app.scheduled_tenants, which
--        the retention sweep runs under)
--
-- The reviews people send from the website's Testimonials page
-- (docs/SPEC/testimonials.md). The page had a "Share Your Experience" form
-- until 10 September 2026, when the third-party project behind it stopped
-- resolving and the form was taken down; the practice asked for it back. The
-- page promises "Every testimonial is reviewed before it appears here", and
-- this table is where that review happens.
--
-- **Built on the enquiry door's pattern (916).** A stranger pressed Send, so
-- nothing here has an actor at insert: the API role holds no insert grant, and
-- the one way in is `app.submit_testimonial`, a definer that resolves the
-- practice, holds a budget per address, and inserts. A row arrives `pending`
-- and nothing about it is public until the owner or an admin approves it.
--
-- **No way to reach the person, on purpose.** No email, no telephone, no name
-- beyond the one they chose to be shown under ("Hazel H."). A review needs
-- none of them: the practice does not reply to a review, it publishes it or it
-- does not, and a question about one ("where is mine?") is answered by the
-- person describing what they wrote. Every column below is either what will
-- be published, the decision about it, or the budget's pseudonymous hash,
-- which goes the moment the review is decided. The door also refuses a
-- telephone number or an email address typed into any published field
-- (domain/testimonial/parse.ts), so the table holds none by accident either.
--
-- **Kept while it is useful, then deleted** (domain/testimonial/retention.ts):
-- a declined review 30 days after the decision, an undecided one 180 days
-- after it arrived, by the scheduler (app/api/scheduler.ts) through
-- `app.purge_stale_testimonials`. An approved review stays while it is on the
-- page; Withdraw makes it a declined one, which is how a person's request to
-- take theirs down is met. This is not a client record, and CLAUDE.md rule 8's
-- five-year floor, which is about the household record, does not reach it.
--
-- **Outside the audit trail, like `enquiry`.** The generic trigger copies a
-- row's contents into the append-only `audit_log`, which nothing erases; a
-- withdrawn review would then live on there for five years after the person
-- asked for it to be taken down, and withdrawing would not be removing. So the
-- routes log who read, approved, declined, withdrew and arranged, by id and
-- never by content (app/api/testimonials/routes.ts), and the row stays the
-- only place the words are. For the same reason there is no `created_by`:
-- nobody on the practice's side created it.
--
-- Trunk core range (900–999): a new public door, beside the enquiry door.
create table testimonial (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenant (id),
  submitted_at        timestamptz not null default now(),
  -- What will be published, exactly as the person gave it.
  display_name        text not null,
  context             text,
  rating              smallint not null,
  body                text not null,
  language            text not null,
  consent_to_publish  boolean not null,
  -- The office's decision.
  status              text not null default 'pending',
  decided_by          uuid,
  decided_at          timestamptz,
  published_order     integer,
  -- sha256 of the sender's address under a fixed prefix, for the definer's
  -- budget only. Null from the moment the review is decided.
  ip_hash             text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- The limits the door applies (domain/testimonial/parse.ts), held again
  -- here so they are true whoever the caller is. `char_length` counts
  -- characters on a UTF-8 database, as the door does, so Arabic is measured
  -- as fairly as English.
  constraint testimonial_display_name_shape check (
    char_length(display_name) between 1 and 40 and display_name = btrim(display_name)
  ),
  constraint testimonial_context_shape check (
    context is null or (char_length(context) between 1 and 60 and context = btrim(context))
  ),
  constraint testimonial_rating_range check (rating between 1 and 5),
  constraint testimonial_body_length check (char_length(body) between 20 and 1200),
  constraint testimonial_language_known check (language in ('en', 'ar')),
  -- The whole basis for holding the row: the person ticked "you may publish
  -- this". A row without it cannot exist, so it can never be published.
  constraint testimonial_consent_given check (consent_to_publish),
  constraint testimonial_status_known check (status in ('pending', 'approved', 'declined')),
  constraint testimonial_ip_hash_shape check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  -- Waiting: nobody has decided, it has no place on the page, and the budget's
  -- hash is still there.
  constraint testimonial_pending_is_undecided check (
    status <> 'pending' or (
      decided_by is null and decided_at is null and published_order is null and ip_hash is not null
    )
  ),
  -- Decided: by somebody, at a time, and the address hash is gone.
  constraint testimonial_decided_names_who check (
    status = 'pending' or (decided_by is not null and decided_at is not null and ip_hash is null)
  ),
  -- A place on the page belongs to a review on the page.
  constraint testimonial_order_only_when_approved check (
    published_order is null or (status = 'approved' and published_order > 0)
  ),
  -- The (tenant_id, id) key every tenant-scoped table carries (099), and the
  -- decider bound to a person of the same practice.
  constraint testimonial_tenant_id_id_key unique (tenant_id, id),
  constraint testimonial_decided_by_fkey foreign key (tenant_id, decided_by)
    references app_user (tenant_id, id)
);

comment on table testimonial is
  'unaudited by decision: a public write with no actor, like enquiry (Option B, 2026-09-09); '
  'reads and decisions are logged by the route by id, never by content, so that Withdraw and '
  'the retention sweep remove the words entirely (docs/SPEC/testimonials.md)';

comment on column testimonial.display_name is
  'The name the person asked to be shown under, as they typed it ("Hazel H."). Published. 1 to 40 characters.';
comment on column testimonial.context is
  'An optional line under the name, as they typed it ("HR Director, Dubai"). Published. At most 60 characters.';
comment on column testimonial.rating is
  'Stars, 1 to 5. Published.';
comment on column testimonial.body is
  'What they wrote, 20 to 1200 characters, never edited by the practice. Published once approved.';
comment on column testimonial.language is
  'The page it was sent from, en or ar; it is shown on that page only.';
comment on column testimonial.consent_to_publish is
  'The form''s tick, "you may publish this on the website". Always true: a row without it is refused.';
comment on column testimonial.ip_hash is
  'SHA-256 of the sender''s address under a fixed prefix, for app.submit_testimonial''s budget only; the address itself is never stored. Null once decided.';
comment on column testimonial.published_order is
  'Where the office placed it on the page, 1 first. Null until somebody arranges the list; an unarranged review shows above the arranged ones, newest decision first.';

create index testimonial_tenant_status_submitted_idx
  on testimonial (tenant_id, status, submitted_at desc);
-- The public read's own index.
create index testimonial_published_idx
  on testimonial (tenant_id, language, published_order, decided_at desc) where status = 'approved';
-- The budget's, partial for the same reason enquiry's is: only a pending row
-- has a hash, and the predicate is implied by the definer's `ip_hash = ...`.
create index testimonial_ip_hash_submitted_idx
  on testimonial (ip_hash, submitted_at desc) where ip_hash is not null;
create index testimonial_decided_by_idx on testimonial (decided_by) where decided_by is not null;

create trigger set_updated_at before update on testimonial
  for each row execute function app.set_updated_at();

-- What may happen to a row after it arrives. A check constraint sees one row
-- and a policy's `with check` sees only the new one, so the rules that compare
-- a row with what it was live here, for every role, the table's owner
-- included (`enable always`, as enquiry's guard is, so a replica-mode session
-- does not skip it).
--
--   * What the person wrote, the name they chose, the stars, the page and the
--     tick are never edited, by anybody. The office publishes a review or it
--     does not; it never puts words in somebody's mouth.
--   * When it arrived, and for which practice, do not change.
--   * Waiting becomes approved or declined. Approved stays approved (and may
--     be moved on the page) or is withdrawn to declined, by whoever withdrew
--     it, from that moment. Declined is final: a withdrawn review is never put
--     back, because the person may be the one who asked for it to go.
--   * The address hash is only ever cleared, never written back.
create function app.testimonial_guard() returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if new.tenant_id is distinct from old.tenant_id
     or new.submitted_at is distinct from old.submitted_at
     or new.created_at is distinct from old.created_at
     or new.display_name is distinct from old.display_name
     or new.context is distinct from old.context
     or new.rating is distinct from old.rating
     or new.body is distinct from old.body
     or new.language is distinct from old.language
     or new.consent_to_publish is distinct from old.consent_to_publish then
    raise exception 'a review is published as it was written, or not at all; it is never edited'
      using errcode = 'check_violation';
  end if;

  if new.ip_hash is not null and new.ip_hash is distinct from old.ip_hash then
    raise exception 'the address hash is only ever cleared'
      using errcode = 'check_violation';
  end if;

  if old.status = 'declined' then
    raise exception 'a declined review stays declined'
      using errcode = 'check_violation';
  end if;

  if old.status = 'approved' and new.status = 'pending' then
    raise exception 'an approved review is withdrawn, never returned to waiting'
      using errcode = 'check_violation';
  end if;

  if old.status = 'approved' and new.status = 'approved'
     and (new.decided_by is distinct from old.decided_by
          or new.decided_at is distinct from old.decided_at) then
    raise exception 'who approved a review, and when, does not change while it is published'
      using errcode = 'check_violation';
  end if;

  return new;
end
$$;

revoke execute on function app.testimonial_guard() from public;

create trigger testimonial_guard
  before update on testimonial
  for each row execute function app.testimonial_guard();
alter table testimonial enable always trigger testimonial_guard;

do $$
declare
  has_api_roles boolean := exists (select 1 from pg_roles where rolname = 'anon')
                       and exists (select 1 from pg_roles where rolname = 'authenticated');
begin
  execute 'alter table public.testimonial enable row level security';
  execute 'revoke all on public.testimonial from public';
  if has_api_roles then
    -- Supabase: default privileges grant every new table in public to these roles.
    execute 'revoke all on public.testimonial from anon, authenticated';
  end if;
  -- Select and update only. No insert: the door is the definer below. No
  -- delete: what is removed on a timer is the sweep's, through its own definer.
  execute 'grant select, update on public.testimonial to app_role';
end
$$;

-- The door. Resolves the practice — exactly one tenant, or nothing is kept —
-- refuses the fourth review from one address in ten minutes and anything at
-- all once five hundred are waiting, then inserts. Null for every refusal,
-- and the route answers that null exactly as it answers success, as the
-- enquiry door does: a form that says "you have been rate limited" tells a
-- script what to change.
--
-- Three in ten minutes, not the enquiry door's five: a person writes one
-- review, perhaps corrects it once. Five hundred waiting is far past anything
-- the practice will see honestly, and stops a patient script from filling the
-- table the office has to read.
create function app.submit_testimonial(p jsonb) returns uuid
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_tenant  uuid;
  v_recent  integer;
  v_waiting integer;
  v_id      uuid;
begin
  if p is null or pg_column_size(p) > 16384 then
    return null;
  end if;
  if (select count(*) from public.tenant) <> 1 then
    return null;
  end if;
  select id into v_tenant from public.tenant limit 1;

  -- One submission at a time per address, so a burst cannot all pass the
  -- count before any of them is written.
  perform pg_advisory_xact_lock(hashtext('testimonial:' || coalesce(p->>'ip_hash', '')));
  select count(*) into v_recent
    from public.testimonial
   where ip_hash = p->>'ip_hash'
     and submitted_at > now() - interval '10 minutes';
  if v_recent >= 3 then
    return null;
  end if;
  select count(*) into v_waiting
    from public.testimonial
   where tenant_id = v_tenant and status = 'pending';
  if v_waiting >= 500 then
    return null;
  end if;

  insert into public.testimonial (
    tenant_id, display_name, context, rating, body, language, consent_to_publish, ip_hash
  ) values (
    v_tenant,
    p->>'display_name',
    nullif(p->>'context', ''),
    (p->>'rating')::smallint,
    p->>'body',
    p->>'language',
    coalesce((p->>'consent_to_publish')::boolean, false),
    p->>'ip_hash'
  )
  returning id into v_id;
  return v_id;
end
$$;
revoke execute on function app.submit_testimonial(jsonb) from public;
grant execute on function app.submit_testimonial(jsonb) to app_role;

-- The website's read: what is published, in one language, as the office
-- arranged it, thirty at most. Four fields and nothing else — no id a caller
-- could name a row by, no date — because the page shows a name, a line, the
-- stars and the words, and anything more would be published for nobody to
-- read. Ahead of the fence like the door, so it resolves the practice the
-- same way and answers nothing when there is not exactly one.
--
-- The order: an arranged review by its place; a review approved since the
-- list was last arranged (no place yet) above all of them, newest decision
-- first, so what the office has just approved is seen at once and can be
-- moved down.
create function app.published_testimonials(p_language text)
returns table (display_name text, context text, rating smallint, body text)
language sql security definer stable
set search_path = pg_catalog, pg_temp
as $$
  select t.display_name, t.context, t.rating, t.body
    from public.testimonial t
   where t.status = 'approved'
     and t.language = p_language
     and (select count(*) from public.tenant) = 1
     and t.tenant_id = (select id from public.tenant limit 1)
   order by t.published_order asc nulls first, t.decided_at desc, t.id
   limit 30
$$;
revoke execute on function app.published_testimonials(text) from public;
grant execute on function app.published_testimonials(text) to app_role;

-- The retention sweep (domain/testimonial/retention.ts), run by the scheduler
-- under each practice's context with the office's role, as the position limit
-- is (211). The cutoffs are the domain's to compute and the floors are this
-- function's to hold: a cutoff later than 30 days (declined) or 180 days
-- (waiting) before now is refused, so a mistake upstream can keep a review
-- longer and can never remove one sooner. The hour of slack is for a server
-- clock and a database clock that disagree by seconds, not a loosening of the
-- promise. Approved reviews are never touched.
create function app.purge_stale_testimonials(
  p_declined_before timestamptz,
  p_pending_before  timestamptz
) returns integer
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_count integer;
begin
  if not (app.actor_has_role('owner') or app.actor_has_role('admin')) then
    raise exception 'only the office removes reviews'
      using errcode = 'insufficient_privilege';
  end if;
  if p_declined_before is null or p_pending_before is null
     or p_declined_before > now() - interval '30 days' + interval '1 hour'
     or p_pending_before > now() - interval '180 days' + interval '1 hour' then
    raise exception 'a declined review is kept 30 days and a waiting one 180'
      using errcode = 'check_violation';
  end if;
  delete from public.testimonial
   where tenant_id = app.current_tenant_id()
     and (
       (status = 'declined' and decided_at < p_declined_before)
       or (status = 'pending' and submitted_at < p_pending_before)
     );
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
revoke execute on function app.purge_stale_testimonials(timestamptz, timestamptz) from public;
grant execute on function app.purge_stale_testimonials(timestamptz, timestamptz) to app_role;

-- rollback:
--   drop function if exists app.purge_stale_testimonials(timestamptz, timestamptz);
--   drop function if exists app.published_testimonials(text);
--   drop function if exists app.submit_testimonial(jsonb);
--   drop table if exists testimonial;
--   drop function if exists app.testimonial_guard();
--   -- and remove db/policies/testimonial/*.sql, which the runner re-applies
--   -- and which name the table.
