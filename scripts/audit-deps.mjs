// Runs pnpm's dependency audit at the level CI cares about, and separates the
// two ways it can fail. A known high or critical advisory fails this script,
// as it always has. A registry that cannot be reached — a timeout, a refused
// connection, a lookup that fails, a server error — is reported and does NOT
// fail it: the advisory feed is npm's, not ours, and an outage there is not a
// finding about this code. On 2026-09-04 the feed timed out for over half an
// hour and blocked two green branches from merging; that is what this ends.
//
// The verdict is read from the audit's own JSON report, never from the shape
// of its table, which is coloured on CI and changes between pnpm versions.
// Without a report there is no audit, and the output decides between an
// outage and a fault of our own; only the first is excused. A 4xx from the
// registry is not an outage.
//
// AUDIT_DEPS_STRICT=true makes an outage fail too, for the scheduled run
// (.github/workflows/audit.yml) whose whole purpose is to notice one.
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** What pnpm prints while it cannot reach the advisory service at all. */
const UNREACHABLE = [
  /TimeoutError/,
  /The operation was aborted due to timeout/,
  /registry\.npmjs\.org\S* error \(5\d\d\)/,
  /ECONN(?:REFUSED|RESET)/,
  /ENOTFOUND/,
  /ETIMEDOUT/,
  /EAI_AGAIN/,
  /socket hang up/,
];

/**
 * The audit's JSON report, if the output holds one: pnpm prints the report
 * as one JSON document on stdout and its warnings on stderr, and a report
 * carries `metadata.vulnerabilities` with a count per severity.
 *
 * @param {string} output
 * @returns {{ high: number, critical: number } | null}
 */
export function readReport(output) {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(output.slice(start, end + 1));
    const counts = parsed?.metadata?.vulnerabilities;
    if (!counts || typeof counts !== 'object') return null;
    return { high: Number(counts.high) || 0, critical: Number(counts.critical) || 0 };
  } catch {
    return null;
  }
}

/**
 * What an audit run means, from its exit code and output. Exported for the
 * test; the command below is the only other caller.
 *
 * @param {number | null} exitCode
 * @param {string} output stdout and stderr together
 * @returns {'clean' | 'advisory' | 'unreachable' | 'failed'}
 */
export function classify(exitCode, output) {
  const report = readReport(output);
  if (report) return report.high + report.critical > 0 ? 'advisory' : 'clean';
  if (exitCode === 0) return 'clean';
  if (UNREACHABLE.some((re) => re.test(output))) return 'unreachable';
  return 'failed';
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
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  const verdict = classify(run.status, output);
  const strict = process.env.AUDIT_DEPS_STRICT === 'true';
  switch (verdict) {
    case 'clean': {
      console.log(
        readReport(output)
          ? 'audit:deps: no high or critical advisory applies to a production dependency.'
          : 'audit:deps: pnpm audit exited cleanly without a report.',
      );
      return;
    }
    case 'advisory':
      process.stdout.write(output);
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
      process.stdout.write(output);
      console.error('\naudit:deps: pnpm audit failed for a reason this script does not excuse.');
      process.exit(run.status || 1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
