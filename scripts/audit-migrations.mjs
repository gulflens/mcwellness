// Fails when a file under db/migrations that already exists on origin/main
// has different text here (.claude/rules/data-model.md: "never edit a
// merged migration"). db/migrations/900_migration_checksums.sql's checksum
// column catches this too, but only against a database that has already
// applied the file, and its own backfill re-baselines rather than refuses
// for a file applied before that column existed (see that migration's own
// comment, and .claude/rules/data-model.md). This script has no such gap:
// it compares db/migrations directly against origin/main, for every
// migration file, regardless of what any one database has or has not
// applied. Runs in `pnpm verify` and in CI (.github/workflows/verify.yml),
// the same way scripts/audit-secrets.mjs does.
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
import { readFileSync, readdirSync } from 'node:fs';

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

const baseline = resolveBaseline();
if (baseline.commit === null) {
  console.log(`Migration audit: skipped (${baseline.note}).`);
  process.exit(0);
}

const names = readdirSync(MIGRATIONS_DIR).filter(
  (name) => !name.startsWith('.') && name.endsWith('.sql'),
);

const offending = [];
for (const name of names) {
  const path = `${MIGRATIONS_DIR}/${name}`;
  const upstream = fileAt(baseline.commit, path);
  if (upstream === null) {
    continue; // not on the baseline yet: not merged, free to edit
  }
  const current = readFileSync(path, 'utf8');
  if (current !== upstream) {
    offending.push(name);
  }
}

if (offending.length > 0) {
  console.error(
    `Migration audit: ${offending.length} merged migration file` +
      `${offending.length === 1 ? '' : 's'} edited after merge ` +
      `(.claude/rules/data-model.md: "never edit a merged migration"), against ${baseline.commit}:`,
  );
  for (const name of offending) console.error(`  ${name}`);
  process.exit(1);
}

console.log(
  `Migration audit: ${names.length} migration file${names.length === 1 ? '' : 's'} checked ` +
    `against ${baseline.commit}, none edited after merge.`,
);
