-- 958_bootstrap_knows_the_books.sql
-- The books' two per-practice defaults join app.bootstrap_practice's list
-- (docs/CHANGE-REQUESTS/accounting-01.md item 3).
--
-- **What changed underneath it.** Migrations 450 and 451 give every practice
-- an `accounting_setting` row and the sixteen accounts of the default chart,
-- each by an after-insert trigger on `tenant` and each with a data step for
-- the practices that already exist -- exactly as 100, 202, 400, 402, 405 and
-- 600 do. 956's function copies none of those statements; it checks, table by
-- table, that each default arrived, so a trigger that is missing or switched
-- off on a database is refused loudly at the one moment it matters. That list
-- is hand-written, and `tests/db/bootstrap-practice.test.ts` requires it to
-- equal the set of `insert ... from tenant` data steps across every migration.
-- So the list must gain the two names, and a merged migration is never edited
-- (.claude/rules/data-model.md): this file recreates the function with those
-- two rows added to the `values` block and nothing else changed.
--
-- **Why 958 and not 957.** Trunk round 34 already carries
-- `957_vat_taxable_supplies_excludes_waived.sql`; the number is taken whether
-- or not that round has merged when this piece opens. 95x sorts last, as
-- `docs/SPEC/OWNERSHIP.md` requires of the trunk's second half.
--
-- Needs: 450 (accounting_setting), 451 (account), 956 (the function this
-- replaces).

create or replace function app.bootstrap_practice(
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
  -- proves the refusal outright; the skip it can only prove by inspection,
  -- auth.users belonging to supabase_auth_admin and not to the test's role.
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
  --
  --    The actor is cleared rather than left alone. A connection that had
  --    already stamped one — a session that ran something else first — would
  --    otherwise have that person recorded as having created the practice, and
  --    nobody created it: there was no practice to be signed in to. All four
  --    settings are transaction-local, so the caller's own context comes back
  --    the moment this transaction ends.
  ---------------------------------------------------------------------------
  perform set_config('app.reason', '956_bootstrap_practice.sql: the first practice', true),
          set_config('app.request_id', gen_random_uuid()::text, true),
          set_config('app.actor_id', '', true),
          set_config('app.actor_roles', '', true);

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
        ('report_number_series',   '600_report.sql'),
        ('accounting_setting',     '450_accounting_setting.sql'),
        ('account',                '451_account.sql')
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
-- database owner and, where Supabase's own role exists, service_role. Restated
-- here because `create or replace` keeps the existing privileges and a reader
-- of this file should not have to go to 956 to learn what they are.
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
  'after-insert triggers on tenant -- including the books'' settings row (450) and the '
  'default chart of accounts (451). Refuses a second practice. Never reachable through '
  'the API (migrations 956 and 958, docs/PRODUCTION.md, "The first practice").';

-- rollback:
--   -- 956's own body, restored as a replacement: the function is never
--   -- dropped, because dropping it would leave a database that has run 956
--   -- without the door it opened.
--   create or replace function app.bootstrap_practice(
--     p_legal_name_en       text,
--     p_legal_name_ar       text,
--     p_owner_auth_user_id  uuid,
--     p_owner_display_name  text,
--     p_owner_email         text,
--     p_time_zone           text default 'Asia/Dubai'
--   ) returns table (practice_id uuid, owner_user_id uuid)
--   language plpgsql security definer
--   set search_path = pg_catalog, pg_temp
--   as $$
--   declare
--     v_practice uuid;
--     v_owner    uuid;
--     v_table    text;
--     v_source   text;
--     v_rows     bigint;
--     v_known    boolean;
--   begin
--     ---------------------------------------------------------------------------
--     -- 1. What it refuses. The arguments first and the state second, so a typo
--     --    is named as a typo whichever of the two is wrong.
--     ---------------------------------------------------------------------------
--     if nullif(btrim(coalesce(p_legal_name_en, '')), '') is null then
--       raise exception 'the practice needs a legal name'
--         using errcode = 'invalid_parameter_value',
--               hint    = 'This is the name printed on every invoice. The Arabic '
--                         'name may be left null and recorded later in Settings.';
--     end if;
--     if p_owner_auth_user_id is null then
--       raise exception 'the owner needs the id of a Supabase Auth user to sign in as'
--         using errcode = 'invalid_parameter_value',
--               hint    = 'Create the account under Authentication, Add user, then '
--                         'copy its user id (docs/PRODUCTION.md, "The first practice").';
--     end if;
--     -- And, where the database carries Supabase's own auth.users, an id that names
--     -- an account really there. A mistyped User UID, or one copied from another
--     -- project, is otherwise taken as given: the practice is made with an owner
--     -- nobody can sign in as, and every attempt to put it right by calling again
--     -- is then refused as a second practice. Where there is no such table — a
--     -- database that is not a Supabase project, whose auth schema is only 000's
--     -- shim — there is nothing to hold the id against and it stands as given. The
--     -- local image is Supabase's own Postgres and carries the table, so the test
--     -- proves the refusal outright; the skip it can only prove by inspection,
--     -- auth.users belonging to supabase_auth_admin and not to the test's role.
--     if to_regclass('auth.users') is not null then
--       execute 'select exists (select 1 from auth.users where id = $1)'
--          into v_known
--         using p_owner_auth_user_id;
--       if not v_known then
--         raise exception 'no Supabase Auth user has the id %', p_owner_auth_user_id
--           using errcode = 'invalid_parameter_value',
--                 hint    = 'Nothing was written. Copy the User UID again from '
--                           'Authentication, Users, beside the account made in step 1 — '
--                           'it is not the account''s email and not the project reference '
--                           '(docs/PRODUCTION.md, "The first practice").';
--       end if;
--     end if;
--     if nullif(btrim(coalesce(p_owner_display_name, '')), '') is null then
--       raise exception 'the owner needs a name'
--         using errcode = 'invalid_parameter_value',
--               hint    = 'This is the name the app greets her by and the trail records.';
--     end if;
--     if nullif(btrim(coalesce(p_owner_email, '')), '') is null then
--       raise exception 'the owner needs an email address'
--         using errcode = 'invalid_parameter_value',
--               hint    = 'The same address as the Auth user, so the account can be '
--                         'found again from either side.';
--     end if;
--     -- A time zone that Postgres does not know would be accepted by the column and
--     -- then quietly decide dates wrong: app.actor_is_adult_contact_of (702) reads
--     -- tenant.timezone to say whether a birthday has arrived.
--     if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_time_zone) then
--       raise exception 'the practice needs a time zone Postgres knows, and % is not one', p_time_zone
--         using errcode = 'invalid_parameter_value',
--               hint    = 'Asia/Dubai is the default and is almost certainly right.';
--     end if;
--     -- One practice. A second is not a thing this platform has been asked for, and
--     -- a decision nobody has taken is not one a bootstrap gets to take by accident.
--     --
--     -- The lock comes first because the check below is a read and what follows it
--     -- is a write: two callers in that gap would both find no practice and both
--     -- make one, and the sentence above would be false the one time it mattered.
--     -- One operator in one SQL editor is not that, but "only the first" is the
--     -- claim being made, so it is held rather than hoped for. The lock is
--     -- transaction-local: it is released when the transaction ends, whichever way
--     -- it ends, and it blocks nothing else in the schema — the key names this
--     -- function and only this function.
--     perform pg_advisory_xact_lock(hashtext('bootstrap_practice'));
--     if exists (select 1 from public.tenant) then
--       raise exception 'this platform already has a practice, and bootstrap_practice makes the first one only'
--         using errcode = 'unique_violation',
--               hint    = 'Nothing was written. Sign in as the owner instead; if the '
--                         'owner cannot sign in, relink the practice''s existing '
--                         'app_user row to the new Auth user id.';
--     end if;
--
--     ---------------------------------------------------------------------------
--     -- 2. The audit context, in the runner's own shape: a reason naming this
--     --    file, a fresh request id, and no actor.
--     --
--     --    The actor is cleared rather than left alone. A connection that had
--     --    already stamped one — a session that ran something else first — would
--     --    otherwise have that person recorded as having created the practice, and
--     --    nobody created it: there was no practice to be signed in to. All four
--     --    settings are transaction-local, so the caller's own context comes back
--     --    the moment this transaction ends.
--     ---------------------------------------------------------------------------
--     perform set_config('app.reason', '956_bootstrap_practice.sql: the first practice', true),
--             set_config('app.request_id', gen_random_uuid()::text, true),
--             set_config('app.actor_id', '', true),
--             set_config('app.actor_roles', '', true);
--
--     ---------------------------------------------------------------------------
--     -- 3. The practice. Every after-insert trigger on tenant fires here, which is
--     --    what gives the practice its six default rows; section 4 proves it.
--     ---------------------------------------------------------------------------
--     insert into public.tenant (legal_name, legal_name_ar, timezone)
--     values (btrim(p_legal_name_en), nullif(btrim(coalesce(p_legal_name_ar, '')), ''), p_time_zone)
--     returning id into v_practice;
--
--     -- The owner. created_by stays null on both rows and granted_by on the role:
--     -- nobody granted this, the bootstrap did, and saying the owner granted
--     -- herself ownership would be a small untruth in a column meant to be read.
--     insert into public.app_user (tenant_id, auth_id, display_name, email)
--     values (v_practice, p_owner_auth_user_id, btrim(p_owner_display_name), btrim(p_owner_email))
--     returning id into v_owner;
--
--     insert into public.user_role (tenant_id, user_id, role)
--     values (v_practice, v_owner, 'owner');
--
--     ---------------------------------------------------------------------------
--     -- 4. Every per-practice default, checked rather than copied.
--     ---------------------------------------------------------------------------
--     for v_table, v_source in
--       select d.table_name, d.source_file
--         from (values
--           ('goal_category',          '100_client_record.sql'),
--           ('scheduling_setting',     '202_scheduling_setting.sql'),
--           ('vat_setting',            '400_billing_catalogue.sql'),
--           ('invoice_number_series',  '402_billing_document.sql'),
--           ('payment_receipt_series', '405_billing_receipt.sql'),
--           ('report_number_series',   '600_report.sql')
--         ) as d(table_name, source_file)
--     loop
--       -- Not on this database: that stream's migrations have not been applied
--       -- here, so there is no default of theirs to be without.
--       continue when to_regclass('public.' || quote_ident(v_table)) is null;
--       execute format('select count(*) from public.%I where tenant_id = $1', v_table)
--          into v_rows
--         using v_practice;
--       if v_rows = 0 then
--         raise exception 'the new practice has no % rows, which % gives every practice', v_table, v_source
--           using errcode = 'no_data_found',
--                 hint    = 'Nothing was written. That migration''s after-insert trigger on '
--                           'tenant is missing or disabled; a practice created without it '
--                           'would be short of a default nothing else supplies.';
--       end if;
--     end loop;
--
--     return query select v_practice, v_owner;
--   end
--   $$;
