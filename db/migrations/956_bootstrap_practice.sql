-- 956_bootstrap_practice.sql
-- How a fresh production database gets its first practice and its owner.
--
-- **What was missing.** `docs/PRODUCTION.md` records a project that holds the
-- whole schema and nothing else: zero rows in `tenant`, `app_user` and
-- `client`. The only thing in this repository that has ever written a practice
-- is `db/seed/apply.ts`, and that writes a synthetic one and refuses to run
-- anywhere but a laptop or staging. So there was no supported way to open the
-- product, and the founder could not sign in to her own practice. This
-- function is that way, and it is deliberately the only one.
--
-- **The per-practice defaults are already handled, and this is the round's
-- central finding.** Every table in this schema that a practice must not be
-- without carries its default twice over. A data step at the end of the
-- migration that introduces it — `insert ... select ... from tenant` — covers
-- every practice that existed when that migration ran; and an after-insert
-- trigger on `tenant` covers every practice created from then on. There are
-- six such tables, and every one of them has both halves:
--
--   goal_category           100_client_record.sql     seed_goal_categories
--   scheduling_setting      202_scheduling_setting.sql  default_scheduling_setting
--     (which is also where the routing factors live: drive_road_factor and
--      drive_peak_multiplier, added to that same row by 204_drive_estimate.sql)
--   vat_setting             400_billing_catalogue.sql   default_vat_setting
--   invoice_number_series   402_billing_document.sql    default_invoice_number_series
--   payment_receipt_series  405_billing_receipt.sql     default_receipt_series
--   report_number_series    600_report.sql              default_report_number_series
--
-- So this function copies none of those statements. It inserts the tenant and
-- lets the very triggers those migrations installed do their own work, which
-- is a stronger guarantee than any copy: a copy is a second implementation
-- that drifts the first time either side changes, and there is nothing here to
-- drift. What it does instead is *check*, table by table, that each default on
-- the list below arrived — so a trigger that is missing or switched off on
-- this database is refused loudly at the one moment it matters, rather than
-- leaving a practice quietly short of a row nobody thinks about until an
-- invoice cannot be numbered.
--
-- That list is hand-written, and nothing in this function makes a new table
-- join it. Keeping it level with the schema is the work of
-- `tests/db/bootstrap-practice.test.ts`, and it takes two tests, because there
-- are two ways to fall behind. It compares a bootstrapped practice with a
-- seeded one over every tenant-scoped table in the schema, which catches a
-- seventh *trigger-fed* default the list has not been told about; and it scans
-- every migration for `insert ... from tenant` data steps and requires that
-- set to be exactly the list below, which catches the other case — a
-- per-practice default written as a data step and given no trigger. No
-- comparison between two practices can see that one: both practices in it were
-- made after the migrations ran, so the data step fired for neither, and it is
-- every practice made afterwards that goes short of the row.
--
-- **The check reads `to_regclass` and skips what is absent.** Apply order
-- across the ranges is not fixed (docs/SPEC/OWNERSHIP.md): a database may
-- carry the trunk's migrations and one stream's and not another's. A table
-- that is not on this database is not a missing default, so it is skipped —
-- the same guard, for the same reason, that `app.erase_client` uses when it
-- reaches into a stream's tables (104, and docs/PRODUCTION.md's note on it).
-- Only 010 and 020 are hard requirements, and only those are in the Needs
-- line below. Supabase's own `auth.users` is read through the same guard and
-- for a different reason: on a Supabase project it is there and the owner's id
-- is held against it, and on a database that is not one there is no such table
-- and nothing to hold it against.
--
-- **What it deliberately does not write.** The practice's corporate-tax
-- registration, its trade licence, its VAT registration and its registered
-- address are all left null. Every one of them is a fact only the owner holds,
-- every one is editable in Settings (`app/api/practice/routes.ts`, migration
-- 905), and inventing a placeholder that later reads as a fact is the one
-- thing a bootstrap must not do. The address in particular is a `location`
-- row that Settings creates on the first save; until it exists, an invoice's
-- supplier address is blank, which is true rather than wrong.
--
-- **Who may run it.** Execute is revoked from `public` and from `app_role`, so
-- it is unreachable through the API by construction and not merely by the
-- absence of a route: the only callers left are the database owner (which is
-- who the Supabase SQL editor connects as) and, where it exists, Supabase's
-- own `service_role`. It is `security definer` in the pattern every function
-- in this schema uses, with the search path pinned, so it writes as the table
-- owner however it was reached.
--
-- **The audit context is the runner's.** `app.reason` names this file and
-- `app.request_id` is a fresh uuid, both transaction-local, with no actor —
-- so every row it makes is logged as a system action against one reason, the
-- way a data migration's rows are (docs/SPEC/audit.md section 5, and
-- `db/runner/apply.ts`'s own setAuditContext). Nobody signed in to create the
-- practice, and the trail says so.
--
-- Needs: 010 (tenant), 020 (app_user, user_role). The six migrations named
-- above are read through to_regclass at call time and are deliberately not
-- dependencies: this function must be creatable on any database.

create function app.bootstrap_practice(
  p_legal_name_en       text,
  p_legal_name_ar       text,
  p_owner_auth_user_id  uuid,
  p_owner_display_name  text,
  p_owner_email         text,
  p_time_zone           text default 'Asia/Dubai'
) returns table (practice_id uuid, owner_user_id uuid)
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_practice uuid;
  v_owner    uuid;
  v_table    text;
  v_source   text;
  v_rows     bigint;
  v_known    boolean;
begin
  ---------------------------------------------------------------------------
  -- 1. What it refuses. The arguments first and the state second, so a typo
  --    is named as a typo whichever of the two is wrong.
  ---------------------------------------------------------------------------
  if nullif(btrim(coalesce(p_legal_name_en, '')), '') is null then
    raise exception 'the practice needs a legal name'
      using errcode = 'invalid_parameter_value',
            hint    = 'This is the name printed on every invoice. The Arabic '
                      'name may be left null and recorded later in Settings.';
  end if;
  if p_owner_auth_user_id is null then
    raise exception 'the owner needs the id of a Supabase Auth user to sign in as'
      using errcode = 'invalid_parameter_value',
            hint    = 'Create the account under Authentication, Add user, then '
                      'copy its user id (docs/PRODUCTION.md, "The first practice").';
  end if;
  -- And, where the database carries Supabase's own auth.users, an id that names
  -- an account really there. A mistyped User UID, or one copied from another
  -- project, is otherwise taken as given: the practice is made with an owner
  -- nobody can sign in as, and every attempt to put it right by calling again
  -- is then refused as a second practice. Where there is no such table — a
  -- database that is not a Supabase project, whose auth schema is only 000's
  -- shim — there is nothing to hold the id against and it stands as given. The
  -- local image is Supabase's own Postgres and carries the table, so the test
  -- proves the refusal outright and proves the skip by taking the table away
  -- inside a transaction it rolls back.
  if to_regclass('auth.users') is not null then
    execute 'select exists (select 1 from auth.users where id = $1)'
       into v_known
      using p_owner_auth_user_id;
    if not v_known then
      raise exception 'no Supabase Auth user has the id %', p_owner_auth_user_id
        using errcode = 'invalid_parameter_value',
              hint    = 'Nothing was written. Copy the User UID again from '
                        'Authentication, Users, beside the account made in step 1 — '
                        'it is not the account''s email and not the project reference '
                        '(docs/PRODUCTION.md, "The first practice").';
    end if;
  end if;
  if nullif(btrim(coalesce(p_owner_display_name, '')), '') is null then
    raise exception 'the owner needs a name'
      using errcode = 'invalid_parameter_value',
            hint    = 'This is the name the app greets her by and the trail records.';
  end if;
  if nullif(btrim(coalesce(p_owner_email, '')), '') is null then
    raise exception 'the owner needs an email address'
      using errcode = 'invalid_parameter_value',
            hint    = 'The same address as the Auth user, so the account can be '
                      'found again from either side.';
  end if;
  -- A time zone that Postgres does not know would be accepted by the column and
  -- then quietly decide dates wrong: app.actor_is_adult_contact_of (702) reads
  -- tenant.timezone to say whether a birthday has arrived.
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_time_zone) then
    raise exception 'the practice needs a time zone Postgres knows, and % is not one', p_time_zone
      using errcode = 'invalid_parameter_value',
            hint    = 'Asia/Dubai is the default and is almost certainly right.';
  end if;
  -- One practice. A second is not a thing this platform has been asked for, and
  -- a decision nobody has taken is not one a bootstrap gets to take by accident.
  --
  -- The lock comes first because the check below is a read and what follows it
  -- is a write: two callers in that gap would both find no practice and both
  -- make one, and the sentence above would be false the one time it mattered.
  -- One operator in one SQL editor is not that, but "only the first" is the
  -- claim being made, so it is held rather than hoped for. The lock is
  -- transaction-local: it is released when the transaction ends, whichever way
  -- it ends, and it blocks nothing else in the schema — the key names this
  -- function and only this function.
  perform pg_advisory_xact_lock(hashtext('bootstrap_practice'));
  if exists (select 1 from public.tenant) then
    raise exception 'this platform already has a practice, and bootstrap_practice makes the first one only'
      using errcode = 'unique_violation',
            hint    = 'Nothing was written. Sign in as the owner instead; if the '
                      'owner cannot sign in, relink the practice''s existing '
                      'app_user row to the new Auth user id.';
  end if;

  ---------------------------------------------------------------------------
  -- 2. The audit context, in the runner's own shape: a reason naming this
  --    file, a fresh request id, and no actor.
  ---------------------------------------------------------------------------
  perform set_config('app.reason', '956_bootstrap_practice.sql: the first practice', true),
          set_config('app.request_id', gen_random_uuid()::text, true);

  ---------------------------------------------------------------------------
  -- 3. The practice. Every after-insert trigger on tenant fires here, which is
  --    what gives the practice its six default rows; section 4 proves it.
  ---------------------------------------------------------------------------
  insert into public.tenant (legal_name, legal_name_ar, timezone)
  values (btrim(p_legal_name_en), nullif(btrim(coalesce(p_legal_name_ar, '')), ''), p_time_zone)
  returning id into v_practice;

  -- The owner. created_by stays null on both rows and granted_by on the role:
  -- nobody granted this, the bootstrap did, and saying the owner granted
  -- herself ownership would be a small untruth in a column meant to be read.
  insert into public.app_user (tenant_id, auth_id, display_name, email)
  values (v_practice, p_owner_auth_user_id, btrim(p_owner_display_name), btrim(p_owner_email))
  returning id into v_owner;

  insert into public.user_role (tenant_id, user_id, role)
  values (v_practice, v_owner, 'owner');

  ---------------------------------------------------------------------------
  -- 4. Every per-practice default, checked rather than copied.
  ---------------------------------------------------------------------------
  for v_table, v_source in
    select d.table_name, d.source_file
      from (values
        ('goal_category',          '100_client_record.sql'),
        ('scheduling_setting',     '202_scheduling_setting.sql'),
        ('vat_setting',            '400_billing_catalogue.sql'),
        ('invoice_number_series',  '402_billing_document.sql'),
        ('payment_receipt_series', '405_billing_receipt.sql'),
        ('report_number_series',   '600_report.sql')
      ) as d(table_name, source_file)
  loop
    -- Not on this database: that stream's migrations have not been applied
    -- here, so there is no default of theirs to be without.
    continue when to_regclass('public.' || quote_ident(v_table)) is null;
    execute format('select count(*) from public.%I where tenant_id = $1', v_table)
       into v_rows
      using v_practice;
    if v_rows = 0 then
      raise exception 'the new practice has no % rows, which % gives every practice', v_table, v_source
        using errcode = 'no_data_found',
              hint    = 'Nothing was written. That migration''s after-insert trigger on '
                        'tenant is missing or disabled; a practice created without it '
                        'would be short of a default nothing else supplies.';
    end if;
  end loop;

  return query select v_practice, v_owner;
end
$$;

-- Never through the API, and never by accident: the only callers left are the
-- database owner and, where Supabase's own role exists, service_role. The
-- revoke from app_role is redundant against the revoke from public and is
-- written anyway, because "the API cannot reach this" is the claim being made.
revoke execute on function
  app.bootstrap_practice(text, text, uuid, text, text, text) from public;
revoke execute on function
  app.bootstrap_practice(text, text, uuid, text, text, text) from app_role;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function '
            'app.bootstrap_practice(text, text, uuid, text, text, text) to service_role';
  end if;
end
$$;

comment on function app.bootstrap_practice(text, text, uuid, text, text, text) is
  'Creates the platform''s first practice and its owner on a database that has only ever '
  'seen the migrations, then checks that every per-practice default arrived from the '
  'after-insert triggers on tenant. Refuses a second practice. Never reachable through '
  'the API (migration 956, docs/PRODUCTION.md, "The first practice").';

-- rollback:
--   drop function if exists app.bootstrap_practice(text, text, uuid, text, text, text);
--   -- The practice and the owner it made are ordinary rows and are not removed
--   -- here: dropping the door does not unmake the people who came through it.
