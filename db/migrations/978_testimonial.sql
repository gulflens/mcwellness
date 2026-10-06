-- 978_testimonial.sql
-- Needs: 000 (app_role, app.set_updated_at, pgcrypto in `extensions` for the
--        address key and its HMAC), 010 (tenant), 020 (app_user),
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
-- be published, the decision about it, or the budget's keyed hash of the
-- sender's address, which goes the moment the review is decided and in any
-- case after a day (see "The address" below). The door also refuses a
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
-- **The address.** The budget needs to know that two submissions came from
-- one place, and nothing more. An unkeyed SHA-256 of an address under a
-- published prefix is the address itself to anybody holding the table — there
-- are only four billion IPv4 addresses to try — so the hash is an HMAC under a
-- random key made in this file (`app.testimonial_pepper`, filled by
-- `gen_random_bytes`), which the API role cannot read and no file in the
-- repository holds. The route hands the raw address to the definer, which
-- hashes it and never stores it; and every hash older than a day — the longest
-- budget below — is cleared on each submission and by the daily sweep, so
-- what the table holds of anybody's address is at most a day old and useless
-- without the key.
--
-- **The budget.** Per address: three in ten minutes and three in a day — a
-- person writes one review and may correct it once. For the whole practice:
-- thirty new in an hour, and nothing while five hundred are waiting. A refusal
-- of either practice-wide limit is somebody else's flood, not the sender's
-- mistake, so it is still answered as a success (the door's rule: a different
-- answer tells a script what to change) — but it is recorded
-- (`app.testimonial_turned_away`), and the Reviews screen says that new
-- reviews are being turned away and the queue needs deciding.
--
-- **What the website must do with the words.** Everything here is stored and
-- served as the sender typed it, less control and invisible format characters
-- (domain/testimonial/parse.ts). The website renders every field as text,
-- never as HTML (docs/SPEC/testimonials.md).
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
  -- HMAC-SHA-256 of the sender's address under app.testimonial_pepper, for
  -- the definer's budget only. Null once decided, and after a day.
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
  -- Waiting: nobody has decided and it has no place on the page. The budget's
  -- hash may already be gone: it is kept a day at most.
  constraint testimonial_pending_is_undecided check (
    status <> 'pending' or (
      decided_by is null and decided_at is null and published_order is null
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
  'HMAC-SHA-256 of the sender''s address under a random key in app.testimonial_pepper, which the API role cannot read; computed inside app.submit_testimonial for its budget only. The address itself is never stored. Null once decided, and cleared for every row older than 24 hours on each submission and by the daily sweep.';
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

-- The key the address hash is made under. One row, random, made here and
-- never written anywhere else; the API role holds no grant on it, so even a
-- caller who can read every hash cannot test an address against them. Only
-- the definer below reads it. Not a business row (no tenant: the door serves
-- the one practice), like the other bookkeeping tables in `app`.
create table app.testimonial_pepper (
  only_row boolean primary key default true check (only_row),
  pepper   bytea not null check (octet_length(pepper) >= 32)
);
insert into app.testimonial_pepper (pepper) values (extensions.gen_random_bytes(32));
revoke all on app.testimonial_pepper from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_role') then
    execute 'revoke all on app.testimonial_pepper from app_role';
  end if;
end
$$;
comment on table app.testimonial_pepper is
  'The random key app.submit_testimonial hashes a sender''s address under (migration 978). '
  'Read by that definer alone; never granted, never exported.';

-- When the practice-wide limits last turned a review away, for the Reviews
-- screen's warning. One row per practice, a time and a count, nothing about
-- the review or its sender. In `app`, with no grant: written by the door's
-- definer and read through `app.testimonials_turned_away_recently`.
create table app.testimonial_turned_away (
  tenant_id            uuid primary key references public.tenant (id),
  last_turned_away_at  timestamptz not null,
  turned_away_count    integer not null default 1 check (turned_away_count > 0)
);
revoke all on app.testimonial_turned_away from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_role') then
    execute 'revoke all on app.testimonial_turned_away from app_role';
  end if;
end
$$;
comment on table app.testimonial_turned_away is
  'When a website review was last refused by a practice-wide limit (thirty an hour, five hundred '
  'waiting), so the Reviews screen can say the queue is full (migration 978).';

-- The door. Resolves the practice — exactly one tenant, or nothing is kept —
-- holds the budgets (the header's "The budget"), hashes the address under the
-- key, then inserts. Null for every refusal, and the route answers that null
-- exactly as it answers success, as the enquiry door does: a form that says
-- "you have been rate limited" tells a script what to change. A refusal by a
-- practice-wide limit is recorded first, for the office.
--
-- The name is refused here, too, when nothing is left of it once control and
-- invisible format characters are taken out: the door strips them
-- (domain/testimonial/parse.ts), and a caller that did not would otherwise
-- file a review under a name that shows as nothing. The pattern is Unicode's
-- Cc and the Cf characters a name could carry.
create function app.submit_testimonial(p jsonb) returns uuid
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_tenant  uuid;
  v_hash    text;
  v_recent  integer;
  v_day     integer;
  v_hour    integer;
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

  -- A hash is kept a day at most: no budget below looks further back.
  update public.testimonial set ip_hash = null
   where ip_hash is not null and submitted_at < now() - interval '24 hours';

  if coalesce(btrim(regexp_replace(
       p->>'display_name',
       '[[:cntrl:]\u0080-\u009F\u00AD\u0600-\u0605\u061C\u06DD\u070F\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB]',
       '', 'g')), '') = '' then
    return null;
  end if;

  -- The address, keyed. An address the route could not know is a bucket of
  -- its own for this one submission, not one shared "unknown" budget that
  -- every such caller would spend between them.
  v_hash := encode(extensions.hmac(
    convert_to(coalesce(nullif(p->>'address', ''), 'nobody:' || gen_random_uuid()::text), 'UTF8'),
    (select pepper from app.testimonial_pepper),
    'sha256'), 'hex');

  -- One submission at a time per address, so a burst cannot all pass the
  -- count before any of them is written.
  perform pg_advisory_xact_lock(hashtext('testimonial:' || v_hash));
  select count(*) filter (where submitted_at > now() - interval '10 minutes'), count(*)
    into v_recent, v_day
    from public.testimonial
   where ip_hash = v_hash
     and submitted_at > now() - interval '24 hours';
  if v_recent >= 3 or v_day >= 3 then
    return null;
  end if;

  -- And one at a time for the practice, so the practice-wide counts hold too.
  perform pg_advisory_xact_lock(hashtext('testimonial-practice:' || v_tenant::text));
  select count(*) filter (where submitted_at > now() - interval '1 hour'),
         count(*) filter (where status = 'pending')
    into v_hour, v_waiting
    from public.testimonial
   where tenant_id = v_tenant;
  if v_hour >= 30 or v_waiting >= 500 then
    insert into app.testimonial_turned_away (tenant_id, last_turned_away_at)
    values (v_tenant, now())
    on conflict (tenant_id) do update
      set last_turned_away_at = excluded.last_turned_away_at,
          turned_away_count = app.testimonial_turned_away.turned_away_count + 1;
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
    v_hash
  )
  returning id into v_id;
  return v_id;
end
$$;
revoke execute on function app.submit_testimonial(jsonb) from public;
grant execute on function app.submit_testimonial(jsonb) to app_role;

-- Whether a practice-wide limit has turned a review away in the last day, for
-- the Reviews screen. The office's alone, as the reviews are; the time and
-- the count stay in `app`.
create function app.testimonials_turned_away_recently() returns boolean
language plpgsql security definer stable
set search_path = pg_catalog, pg_temp
as $$
begin
  if not (app.actor_has_role('owner') or app.actor_has_role('admin')) then
    raise exception 'only the office reads the reviews'
      using errcode = 'insufficient_privilege';
  end if;
  return exists (
    select 1 from app.testimonial_turned_away t
     where t.tenant_id = app.current_tenant_id()
       and t.last_turned_away_at > now() - interval '24 hours');
end
$$;
revoke execute on function app.testimonials_turned_away_recently() from public;
grant execute on function app.testimonials_turned_away_recently() to app_role;

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
-- promise. Approved reviews are never touched. It also clears every address
-- hash older than a day, as each submission does, so a quiet week does not
-- leave the last hashes standing.
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
  update public.testimonial set ip_hash = null
   where tenant_id = app.current_tenant_id()
     and ip_hash is not null and submitted_at < now() - interval '24 hours';
  return v_count;
end
$$;
revoke execute on function app.purge_stale_testimonials(timestamptz, timestamptz) from public;
grant execute on function app.purge_stale_testimonials(timestamptz, timestamptz) to app_role;

-- rollback:
--   drop function if exists app.purge_stale_testimonials(timestamptz, timestamptz);
--   drop function if exists app.published_testimonials(text);
--   drop function if exists app.testimonials_turned_away_recently();
--   drop function if exists app.submit_testimonial(jsonb);
--   drop table if exists app.testimonial_turned_away;
--   drop table if exists app.testimonial_pepper;
--   drop table if exists testimonial;
--   drop function if exists app.testimonial_guard();
--   -- and remove db/policies/testimonial/*.sql, which the runner re-applies
--   -- and which name the table.
