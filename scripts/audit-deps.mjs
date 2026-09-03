// Runs pnpm's dependency audit at the level CI cares about, and separates the
// two ways it can fail. A known high or critical advisory fails this script,
// as it always has. A registry that cannot be reached — a timeout, a refused
// connection, a lookup that fails, a server error — is reported and does NOT
// fail it: the advisory feed is npm's, not ours, and an outage there is not a
// finding about this code. On 2026-09-04 the feed timed out for over half an
// hour and blocked two green branches from merging; that is what this ends.
//
// Under `--json` pnpm prints exactly one document on stdout and nothing on
// stderr: the audit report, which carries `metadata.vulnerabilities` with a
// count per severity, or `{ "error": { code, message } }` when the audit could
// not be made. The verdict is read from that document and never from the
// shape of a table. Without a document, the exit code and any text decide.
// Only an outage is excused; a 4xx from the registry, a missing lockfile, or
// anything else of our own making is not.
//
// AUDIT_DEPS_STRICT=true makes an outage fail too, and a clean exit with no
// report, for the scheduled run (.github/workflows/audit.yml) whose whole
// purpose is to notice a week in which nothing was audited.
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/**
 * What pnpm's error says when the advisory service could not be reached at
 * all. undici folds a refused connection or a failed lookup into "fetch
 * failed"; a bad answer from the endpoint carries its status.
 */
const OUTAGE = [
  /fetch failed/i,
  /responded with 5\d\d/,
  /TimeoutError/,
  /aborted due to timeout/,
  /ECONN(?:REFUSED|RESET)/,
  /ENOTFOUND/,
  /ETIMEDOUT/,
  /EAI_AGAIN/,
  /socket hang up/,
];

/**
 * The document pnpm printed on stdout, parsed. The report has
 * `metadata.vulnerabilities`; a failure has `error`. Anything else, or no JSON
 * at all, answers null. stdout only: a brace in stderr noise must not delete
 * the report.
 *
 * @param {string} stdout
 * @returns {{ kind: 'report', high: number, critical: number } | { kind: 'error', code: string, message: string } | null}
 */
export function readDocument(stdout) {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed;
  try {
    parsed = JSON.parse(stdout.slice(start, end + 1));
  } catch {
    return null;
  }
  const counts = parsed?.metadata?.vulnerabilities;
  if (
    counts &&
    typeof counts === 'object' &&
    typeof counts.high === 'number' &&
    typeof counts.critical === 'number'
  ) {
    return { kind: 'report', high: counts.high, critical: counts.critical };
  }
  const error = parsed?.error;
  if (error && typeof error === 'object') {
    return { kind: 'error', code: String(error.code ?? ''), message: String(error.message ?? '') };
  }
  return null;
}

/**
 * What an audit run means. Exported for the test; the command below is the
 * only other caller.
 *
 * @param {number | null} exitCode
 * @param {string} stdout
 * @param {string} stderr
 * @returns {'clean' | 'advisory' | 'unreachable' | 'failed'}
 */
export function classify(exitCode, stdout, stderr = '') {
  const document = readDocument(stdout);
  if (document?.kind === 'report') {
    return document.high + document.critical > 0 ? 'advisory' : 'clean';
  }
  if (exitCode === 0) return 'clean';
  const text = document?.kind === 'error' ? `${document.code} ${document.message}` : stderr;
  return OUTAGE.some((re) => re.test(text)) ? 'unreachable' : 'failed';
}

function main() {
  const run = spawnSync('pnpm', ['audit', '--prod', '--audit-level=high', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  if (run.error) {
    console.error(`audit:deps: could not start pnpm audit: ${run.error.message}`);
    process.exit(1);
  }
  const stdout = run.stdout ?? '';
  const stderr = run.stderr ?? '';
  const verdict = classify(run.status, stdout, stderr);
  const strict = process.env.AUDIT_DEPS_STRICT === 'true';
  switch (verdict) {
    case 'clean':
      if (readDocument(stdout)?.kind === 'report') {
        console.log('audit:deps: no high or critical advisory applies to a production dependency.');
        return;
      }
      console.log('audit:deps: pnpm audit exited cleanly without a report.');
      if (strict) {
        console.error(
          'audit:deps: AUDIT_DEPS_STRICT is set, and a run that audited nothing fails.',
        );
        process.exit(1);
      }
      return;
    case 'advisory':
      process.stdout.write(stdout);
      console.error(
        '\naudit:deps: a high or critical advisory applies to a production dependency.',
      );
      process.exit(run.status || 1);
      break;
    case 'unreachable': {
      const line =
        'audit:deps: the npm advisory service could not be reached, so nothing was ' +
        'audited. This is a registry outage, not a finding; run pnpm audit again later.';
      console.error(process.env.GITHUB_ACTIONS ? `::warning::${line}` : line);
      if (strict) {
        console.error('audit:deps: AUDIT_DEPS_STRICT is set, so the outage fails this run.');
        process.exit(1);
      }
      return;
    }
    default:
      process.stdout.write(stdout);
      process.stderr.write(stderr);
      console.error('\naudit:deps: pnpm audit failed for a reason this script does not excuse.');
      process.exit(run.status || 1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
