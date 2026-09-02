// Fails when a file db/migrations already has on origin/main is missing
// locally, renamed, or has different text here (.claude/rules/data-model.md:
// "never edit a merged migration"). db/migrations/900_migration_checksums.sql's
// checksum column catches an edit too, but only against a database that has
// already applied the file, and its own backfill re-baselines rather than
// refuses for a file applied before that column existed (see that
// migration's own comment, and .claude/rules/data-model.md). This script has
// no such gap: it walks the migration files origin/main actually has — not
// the ones present locally, so a merged file that this branch deleted or
// renamed is caught too, not just one that was edited in place — and
// compares each directly against db/migrations here. Runs in `pnpm verify`
// and in CI (.github/workflows/verify.yml), the same way
// scripts/audit-secrets.mjs does.
//
// The comparison target is origin/main when that ref resolves (a
// best-effort `git fetch origin main` is tried first, so a shallow CI
// checkout that only fetched this branch still finds it); the merge-base of
// HEAD and a local `main` branch when origin/main itself does not resolve;
// or, when neither is available — no "origin" remote configured at all, for
// instance — a deliberate no-op: this prints a note and exits 0, since
// there is nothing to compare against, rather than failing a check it has
// no baseline to run.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const MIGRATIONS_DIR = 'db/migrations';

function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function tryGit(args) {
  try {
    return git(args);
  } catch {
    return null;
  }
}

function refExists(ref) {
  return tryGit(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) !== null;
}

function resolveBaseline() {
  const remotes = (tryGit(['remote']) ?? '').split('\n').filter(Boolean);
  if (!remotes.includes('origin')) {
    return { commit: null, note: 'no "origin" remote is configured' };
  }
  // Best-effort: offline development, or a runner with no network to
  // origin, just means whatever is already resolvable locally is used.
  tryGit(['fetch', '--quiet', 'origin', 'main']);
  if (refExists('origin/main')) {
    return { commit: 'origin/main', note: null };
  }
  if (refExists('main')) {
    const base = tryGit(['merge-base', 'HEAD', 'main']);
    if (base) {
      return { commit: base, note: null };
    }
  }
  return {
    commit: null,
    note: 'origin/main could not be resolved and no local "main" branch merge-base was found',
  };
}

function fileAt(commit, path) {
  try {
    return execFileSync('git', ['show', `${commit}:${path}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null; // the file does not exist at that commit
  }
}

/** Every db/migrations path the baseline commit actually has, not the working tree. */
function upstreamMigrationPaths(commit) {
  const listing = tryGit(['ls-tree', '-r', '--name-only', commit, '--', MIGRATIONS_DIR]) ?? '';
  return listing.split('\n').filter(Boolean);
}

const baseline = resolveBaseline();
if (baseline.commit === null) {
  console.log(`Migration audit: skipped (${baseline.note}).`);
  process.exit(0);
}

const upstreamPaths = upstreamMigrationPaths(baseline.commit);

const offending = [];
for (const path of upstreamPaths) {
  const upstream = fileAt(baseline.commit, path);
  if (upstream === null) {
    continue; // ls-tree just listed it; a race with the baseline is not our concern
  }
  let current;
  try {
    current = readFileSync(path, 'utf8');
  } catch {
    offending.push(`${path} (missing locally — deleted or renamed)`);
    continue;
  }
  if (current !== upstream) {
    offending.push(path);
  }
}

if (offending.length > 0) {
  console.error(
    `Migration audit: ${offending.length} merged migration file` +
      `${offending.length === 1 ? '' : 's'} edited, deleted or renamed after merge ` +
      `(.claude/rules/data-model.md: "never edit a merged migration"), against ${baseline.commit}:`,
  );
  for (const path of offending) console.error(`  ${path}`);
  process.exit(1);
}

console.log(
  `Migration audit: ${upstreamPaths.length} migration file${upstreamPaths.length === 1 ? '' : 's'} ` +
    `checked against ${baseline.commit}, none edited, deleted or renamed after merge.`,
);
