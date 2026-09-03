import { describe, expect, it } from 'vitest';
import { classify, readReport } from '../../scripts/audit-deps.mjs';

/**
 * The dependency audit fails a run for an advisory and never for an outage of
 * the advisory feed itself (scripts/audit-deps.mjs). The verdict comes from
 * the audit's JSON report when there is one; the text decides only whether a
 * missing report was an outage or a fault of our own.
 */
const report = (
  counts: Partial<Record<'info' | 'low' | 'moderate' | 'high' | 'critical', number>>,
): string =>
  JSON.stringify({
    actions: [],
    advisories: {},
    muted: [],
    metadata: {
      vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, ...counts },
      dependencies: 12,
      devDependencies: 0,
      optionalDependencies: 0,
      totalDependencies: 12,
    },
  });

const RETRY_WARNING =
  '[WARN] POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk error (23). ' +
  'Will retry in 10 seconds. 2 retries left.\n';

describe('audit:deps reads the report', () => {
  it('a report with nothing high or critical is clean whatever the exit code', () => {
    expect(classify(0, report({}))).toBe('clean');
    expect(classify(1, report({ moderate: 3, low: 2 }) + '\n')).toBe('clean');
  });

  it('a report with a high or critical advisory fails, even when the feed also grumbled', () => {
    expect(classify(1, report({ high: 1 }))).toBe('advisory');
    expect(classify(1, `${RETRY_WARNING}${report({ critical: 1 })}`)).toBe('advisory');
  });

  it('a coloured or reshaped table is not what decides', () => {
    // The report is JSON on stdout; the table, coloured on CI, never reaches
    // the classifier's decision.
    const coloured = '[31mhigh[39m something\n';
    expect(classify(1, coloured + report({}))).toBe('clean');
  });

  it('readReport answers null without a report and ignores stray braces', () => {
    expect(readReport('No known vulnerabilities found\n')).toBeNull();
    expect(readReport('{ not json }')).toBeNull();
    expect(readReport('{"metadata":{}}')).toBeNull();
  });
});

describe('audit:deps tells an outage from a fault when there is no report', () => {
  it('a registry timeout is an outage', () => {
    const output =
      RETRY_WARNING +
      'TimeoutError: The operation was aborted due to timeout\n' +
      '    at Timeout._onTimeout (node:internal/abort_controller:210:9)\n';
    expect(classify(1, output)).toBe('unreachable');
  });

  it('a lookup, connection or server failure is an outage too', () => {
    expect(classify(1, 'Error: getaddrinfo ENOTFOUND registry.npmjs.org')).toBe('unreachable');
    expect(classify(1, 'Error: connect ECONNREFUSED 1.2.3.4:443')).toBe('unreachable');
    expect(
      classify(
        1,
        '[WARN] POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk error (503). Will retry.',
      ),
    ).toBe('unreachable');
  });

  it('a refusal from the registry is not an outage', () => {
    expect(
      classify(1, '[WARN] GET https://registry.npmjs.org/@scope%2fthing error (403). Will retry.'),
    ).toBe('failed');
    expect(classify(1, 'ERR_PNPM_NO_LOCKFILE  Cannot audit without a lockfile')).toBe('failed');
  });

  it('a clean exit without a report is still clean', () => {
    expect(classify(0, '')).toBe('clean');
  });
});
