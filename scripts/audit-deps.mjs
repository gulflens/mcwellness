// Runs pnpm's dependency audit at the level CI cares about, and separates the
// two ways it can fail. A known high or critical advisory fails this script,
// as it always has. A registry that cannot be reached — a timeout, a refused
// connection, a lookup that fails — is reported and does NOT fail it: the
// advisory feed is npm's, not ours, and an outage there is not a finding about
// this code. On 2026-09-04 the feed timed out for over half an hour and
// blocked two green branches from merging; that is what this script ends.
//
// The audit is still run on every change. Only its failure mode has changed,
// and the output says which of the two happened every time.
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** Lines pnpm prints while it cannot reach the advisory endpoint. */
const UNREACHABLE = [
  /TimeoutError/,
  /The operation was aborted due to timeout/,
  /registry\.npmjs\.org\S* error \(\d+\)/,
  /ECONN(?:REFUSED|RESET)/,
  /ENOTFOUND/,
  /ETIMEDOUT/,
  /EAI_AGAIN/,
  /socket hang up/,
];
/** Lines pnpm prints when it did reach the endpoint and found something. */
const ADVISORY = [
  /vulnerabilit(?:y|ies) found/i,
  /^\s*(?:high|critical)\s/im,
  /│\s*(?:high|critical)\s*│/i,
];

/**
 * What an audit run means, from its exit code and output. Exported for the
 * test; the command below is the only other caller.
 *
 * @param {number | null} exitCode
 * @param {string} output stdout and stderr together
 * @returns {'clean' | 'advisory' | 'unreachable' | 'failed'}
 */
export function classify(exitCode, output) {
  if (exitCode === 0) return 'clean';
  if (ADVISORY.some((re) => re.test(output))) return 'advisory';
  if (UNREACHABLE.some((re) => re.test(output))) return 'unreachable';
  return 'failed';
}

function main() {
  const run = spawnSync('pnpm', ['audit', '--prod', '--audit-level=high'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  process.stdout.write(output);
  const verdict = classify(run.status, output);
  switch (verdict) {
    case 'clean':
      return;
    case 'advisory':
      console.error(
        '\naudit:deps: a high or critical advisory applies to a production dependency.',
      );
      process.exit(run.status ?? 1);
      break;
    case 'unreachable':
      console.error(
        '\naudit:deps: the npm advisory service could not be reached, so nothing was ' +
          'audited. This is a registry outage, not a finding; run pnpm audit again later.',
      );
      return;
    default:
      console.error('\naudit:deps: pnpm audit failed for a reason this script does not recognise.');
      process.exit(run.status ?? 1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
