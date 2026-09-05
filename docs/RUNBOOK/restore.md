# Runbook — restoring the database from a backup

A backup nobody has restored is a belief. This is the record of the restores
that have actually been done, and the procedure they produced.

There are two copies of the practice's database (`docs/SPEC/hosting.md`
section 6). Supabase takes its own daily snapshot of the production project,
and that is the fast path for "yesterday was fine": it is restored from the
Supabase dashboard and nothing in this file is needed. The other copy is the
weekly dump `.github/workflows/backup.yml` writes into a private bucket in a
second Supabase project in a different region, and this file is about that
one.

---

## 1. The procedure

Six steps. The first five prepare the target; only the sixth is the restore.
Steps 2 to 4 exist because a dump of one database is not a dump of a whole
Postgres cluster, and the rehearsal below is where that was learnt.

1. **Take the newest dump** from the `backups` bucket, under `weekly/`. Its
   name carries its date.
2. **Make the target database.** A fresh Supabase project, or a plain
   Postgres of the same major version.
3. **Put the extensions where the schema expects them.** The platform's
   tables use PostGIS types written as `extensions.geography(...)`, so the
   `extensions` schema and its extensions must exist before the first table
   is created. A fresh Supabase project already has them; a plain Postgres
   needs `create schema extensions` and then `postgis`, `pgcrypto`,
   `btree_gist` and `uuid-ossp` created in it.
4. **Make the two roles the grants name, and the membership between them.**
   `app_role` and `mcwellness_api` are cluster-level roles created by
   migrations `000` and `096`. A dump of one database does not carry them,
   nor `grant app_role to mcwellness_api`, so the restore recreates all
   three by hand. Without the membership the API can connect and then fail
   on its first `set local role app_role`.
5. **Drop the empty `public` schema** the new database was created with. The
   dump creates its own.
6. **Restore**: `gzip -dc <dump> | psql -v ON_ERROR_STOP=1 <target>`.
   `ON_ERROR_STOP` is not optional. Without it a restore that fails halfway
   ends with a shell prompt and a plausible-looking database.

Then, before anyone signs in:

- **Re-apply any erasure raised since the dump was taken.** A dump made
  before an erasure still holds that household's rows, so a restore quietly
  brings them back; the erasure requests raised since the dump's date are
  run again against the restored database. Ninety days bounds how long any
  one dump can carry them.
- **Re-apply the policies**: `pnpm db:migrate` against the restored
  database re-applies every file under `db/policies`, which is how a policy
  change reaches a database in the ordinary course of things.
- **The sign-in accounts are not in this dump.** It carries the platform's
  own two schemas and not Supabase's `auth`, so the people and their roles
  come back but the accounts they sign in with do not. Those come from
  Supabase's own snapshot of the project, or the owner recreates them in the
  dashboard.

---

## 2. Rehearsal, 6 September 2026

The first one. Run on the laptop as part of building piece nine, against a
throwaway Postgres in a container on a spare port, and thrown away
afterwards.

**What was dumped, and what could not be.** The intention was to dump the
staging project, which holds synthetic data only. That was not possible from
this laptop and the reason is worth writing down: the only staging credential
on the machine is the API's own role, `mcwellness_api`, which is deliberately
restricted — it has no direct table grants and works only through
`app_role` inside a request's transaction. `pg_dump` needs to take an access
share lock on every table, so it stops on the first one:
`permission denied for table tenant`. **A dump needs its own credential**,
which is exactly what `backup.yml` names as `BACKUP_DATABASE_URL` and what
the operator creates with the production project.

**What that credential is, exactly.** A role created `login bypassrls` and
then given `grant pg_read_all_data` — still read-only, since it may select
from everything and write to nothing. `bypassrls` is the part that is easy to
leave out and fatal to leave out: every table in `public` has row security
enabled (migrations 090, 100, 200 and on), so a plain read-only role makes
`pg_dump` stop on the first such table with
`query would be affected by row-level security policy`, and the workaround
that suggests itself, `--enable-row-security`, files the whole schema with
none of the practice's rows in it. `backup.yml` therefore checks for a data
row under the `COPY public.tenant` block as well as for a size, so a dump of
an empty-looking database fails instead of being filed.

So the rehearsal ran against a stand-in: a local database rebuilt from the
same 57 migrations and seeded with the same synthetic practice staging holds.
That proves the procedure, the flags, the restore mechanics and every check
below. What it does not prove is the part that needs a hosted project — the
download from the bucket and a restore into a scratch Supabase project — and
that rehearsal is the one that must happen before the first production
deploy. It costs money, so it is the operator's to authorise, and it
replaces this one.

**The figures.**

| | |
|---|---|
| Date | 2026-09-06 |
| Source | a local stand-in for staging: 57 migrations, the synthetic practice, 200 audit rows |
| Dump | 92,012 bytes gzipped; 796,053 bytes as SQL |
| Time to dump | under a second |
| Time to restore | under a second |
| Target | Postgres 17.6.1.155 in a throwaway container on a spare port, deleted afterwards |

**What was checked, and what it said.**

| Check | Result |
|---|---|
| Migration table row count | 57 in both, and the set of filenames hashes identically |
| Schema fingerprint, the nine parts of `docs/STAGING.md` — columns, constraints, indexes, functions, triggers, policies, row security, grants, partitions | all nine identical between the source and the restored database |
| Row counts, every table in both schemas, as one hash | identical |
| The audit trail | 200 rows, chain anchor at 200, and `app.verify_audit_chain()` answers null, which is what an unbroken chain answers |
| The exit test of `docs/STAGING.md` section 7, walked as the API role under the same transaction-local context a request stamps | the owner sees the practice's 20 clients, opens one, and that client's timeline has 4 rows; a practitioner sees an empty table, which is right because the seeded practice has no appointments; a second practice's context sees nothing at all, so row security survived the restore |

**What went wrong, which is the useful part.** Four failures, in order, each
of which would have been discovered during a real incident instead:

1. `pg_dump` could not read staging at all with the credential on this
   laptop (above). The dump needs a credential of its own.
2. A dump taken with `--clean --if-exists` refused to restore:
   `must be owner of event trigger pgrst_drop_watch`. The DROP statements it
   adds cover objects that belong to Supabase and not to us. `--clean` was
   removed; a dump is restored into a fresh database, not over a live one.
3. A whole-database dump refused twice more —
   `permission denied for table spatial_ref_sys`, then
   `permission denied for table secrets` — because it carried the data of
   tables that belong to PostGIS and to Supabase's vault. Naming the
   platform's own two schemas, `--schema=public --schema=app`, ends that
   whole class of failure rather than excluding the tables one at a time.
4. The restored database then failed on `schema "extensions" does not exist`
   and, later, on `permission denied to set role "app_role"`. Both are the
   same fact in two costumes: a dump of one database carries neither the
   cluster's roles nor its extensions. Steps 3 and 4 of the procedure above
   exist because of this.

`backup.yml` carries the corrected flags, so the dumps it writes are the ones
this procedure restores.

**Still to be proved, by the rehearsal the operator authorises.** That a dump
downloaded from the `backups` bucket restores into a scratch Supabase project;
how long that takes at production's size rather than a seed's; and that the
screens come up against the restored project. None of it can be done before
the production project exists (`docs/SPEC/hosting.md` section 10 holds that
until the founder's lawyer answers).

---

## 3. The `production` GitHub Environment

`.github/workflows/release.yml` runs its `deploy` job in a GitHub Environment
called `production`, which is what makes a tag *propose* a release and a
person release it (spec decision 7).

**It has not been created.** The attempt was made from this build and the
session's own permission layer refused it, because creating it changes the
repository's settings, which is not a change an agent makes unattended. The
environment did not exist when this was written: the repository has none.

The operator creates it in one of two ways.

In the browser: repository, Settings, Environments, New environment, name it
`production`, tick "Required reviewers" and add the repository owner. Leave
the deployment branch policy at "All branches" — the workflow is triggered by
a tag, not by a branch, and a branch rule would block it. Add no secrets yet;
they wait on decision 1 and on the production Supabase project.

Or from a terminal, with the GitHub CLI signed in as the owner:

```bash
gh api --method PUT repos/gulflens/mcwellness/environments/production \
  --field 'wait_timer=0' \
  --field 'reviewers[][type]=User' \
  --field "reviewers[][id]=$(gh api user --jq .id)"
```

`--field` on the two numbers is not a matter of taste: GitHub's environment
endpoint validates `wait_timer` and `reviewers[][id]` as integers, and
`--raw-field` would send them as strings and be answered 422.

Then confirm it exists:

```bash
gh api repos/gulflens/mcwellness/environments --jq '.environments[].name'
```

The names the workflows expect are in `.github/workflows/release.yml` and
`backup.yml`; the values are the operator's and never Claude's.
