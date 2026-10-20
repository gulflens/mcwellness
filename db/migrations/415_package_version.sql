-- 415_package_version.sql
-- A package edited after it was sold becomes a new version of itself.
--
-- The operator's decision of 20 October 2026: everything but a package's name
-- can be edited. A package somebody has bought keeps the contents it was sold
-- with (403's `guard_package_components`), so changing those contents writes a
-- new package — the same name, the same place in the list — that names the one
-- it replaces, and the old one is withdrawn (domain/billing/packageEdit.ts).
-- Its buyers keep exactly what they bought: their purchase names the old row.
--
-- The three columns are the shape .claude/rules/data-model.md gives every
-- versioned entity: `version`, `supersedes_id`, `amendment_reason`. The
-- current version is the one with no successor; `readPackages` lists only
-- those, and a superseded package cannot be reinstated.
--
-- **Existing rows** are each version 1 of themselves, with nothing superseded.
-- No backfill beyond the default, so no audit row is written for them.
--
-- Needs: 401 (package).

alter table public.package
  add column version integer not null default 1,
  add column supersedes_id uuid,
  add column amendment_reason text;

alter table public.package
  add constraint package_version_from_one check (version >= 1),
  add constraint package_supersedes_same_practice
    foreign key (tenant_id, supersedes_id) references public.package (tenant_id, id),
  -- A first version replaces nothing; every later one replaces something, and
  -- says why.
  add constraint package_version_chain check (
    (version = 1 and supersedes_id is null and amendment_reason is null)
    or (version > 1 and supersedes_id is not null
        and length(btrim(amendment_reason)) between 1 and 200)
  );

-- A package is replaced at most once: one successor, so one current version.
create unique index package_one_successor
  on public.package (tenant_id, supersedes_id)
  where supersedes_id is not null;

comment on column public.package.version is
  'Which version of the package this row is, 1 first (operator, 2026-10-20).';
comment on column public.package.supersedes_id is
  'The version this one replaced, when its contents changed after it was sold; null for a first version.';
comment on column public.package.amendment_reason is
  'Why this version replaced the last; null for a first version.';

-- rollback:
--   drop index if exists public.package_one_successor;
--   alter table public.package drop constraint if exists package_version_chain;
--   alter table public.package drop constraint if exists package_supersedes_same_practice;
--   alter table public.package drop constraint if exists package_version_from_one;
--   alter table public.package drop column if exists amendment_reason;
--   alter table public.package drop column if exists supersedes_id;
--   alter table public.package drop column if exists version;
