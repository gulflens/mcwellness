import { describe, expect, it } from 'vitest';
import { classify } from '../../scripts/audit-deps.mjs';

/**
 * The dependency audit fails a run for an advisory and never for an outage of
 * the advisory feed itself (scripts/audit-deps.mjs).
 */
describe('audit:deps tells an advisory from an outage', () => {
  it('a clean run is clean whatever it printed', () => {
    expect(classify(0, 'No known vulnerabilities found\n')).toBe('clean');
  });

  it('a registry timeout is an outage, not a finding', () => {
    const output =
      '[WARN] POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk error (23). ' +
      'Will retry in 10 seconds. 2 retries left.\n' +
      'TimeoutError: The operation was aborted due to timeout\n' +
      '    at Timeout._onTimeout (node:internal/abort_controller:210:9)\n';
    expect(classify(1, output)).toBe('unreachable');
  });

  it('a lookup or connection failure is an outage too', () => {
    expect(classify(1, 'Error: getaddrinfo ENOTFOUND registry.npmjs.org')).toBe('unreachable');
    expect(classify(1, 'Error: connect ECONNREFUSED 1.2.3.4:443')).toBe('unreachable');
  });

  it('an advisory fails the run even when the feed also grumbled', () => {
    const output =
      '[WARN] POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk error (23). Will retry.\n' +
      '┌───────────────┬──────────────────────────────┐\n' +
      '│ high          │ Prototype Pollution in thing │\n' +
      '└───────────────┴──────────────────────────────┘\n' +
      '1 vulnerabilities found\nSeverity: 1 high\n';
    expect(classify(1, output)).toBe('advisory');
  });

  it('anything else that fails stays a failure', () => {
    expect(classify(1, 'ERR_PNPM_NO_LOCKFILE  Cannot audit without a lockfile')).toBe('failed');
  });
});
