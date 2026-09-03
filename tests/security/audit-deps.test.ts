import { describe, expect, it } from 'vitest';
import { classify, readDocument } from '../../scripts/audit-deps.mjs';

/**
 * The dependency audit fails a run for an advisory and never for an outage of
 * the advisory feed itself (scripts/audit-deps.mjs). Under `--json` pnpm
 * prints one document on stdout — the report, or `{ "error": ... }` when the
 * audit could not be made — and nothing on stderr. The fixtures below are the
 * shapes pnpm 11 prints, taken from runs against a real and a faked registry.
 */
const report = (
  counts: Partial<Record<'info' | 'low' | 'moderate' | 'high' | 'critical', number>>,
): string =>
  JSON.stringify(
    {
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
    },
    null,
    2,
  );

const failure = (code: string, message: string): string =>
  JSON.stringify({ error: { code, message } }, null, 2);

const ENDPOINT = 'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk';

describe('audit:deps reads the report', () => {
  it('a report with nothing high or critical is clean whatever the exit code', () => {
    expect(classify(0, report({}))).toBe('clean');
    expect(classify(1, report({ moderate: 3, low: 2 }))).toBe('clean');
  });

  it('a report with a high or critical advisory fails', () => {
    expect(classify(1, report({ high: 1 }))).toBe('advisory');
    expect(classify(1, report({ critical: 1 }))).toBe('advisory');
  });

  it('noise on stderr, braces included, cannot hide the report', () => {
    const noise =
      '(node:4242) [DEP0040] DeprecationWarning: The `punycode` module is deprecated. ' +
      'Please use a userland alternative instead { see: "https://example.invalid" }\n';
    expect(classify(1, report({ high: 1 }), noise)).toBe('advisory');
    expect(classify(1, report({}), noise)).toBe('clean');
  });

  it('readDocument tells a report from a failure and answers null for anything else', () => {
    expect(readDocument(report({ high: 2 }))).toEqual({ kind: 'report', high: 2, critical: 0 });
    expect(readDocument(failure('pnpm', 'fetch failed'))).toEqual({
      kind: 'error',
      code: 'pnpm',
      message: 'fetch failed',
    });
    expect(readDocument('No known vulnerabilities found\n')).toBeNull();
    expect(readDocument('{ not json }')).toBeNull();
    expect(readDocument('{"metadata":{}}')).toBeNull();
  });
});

describe('audit:deps tells an outage from a fault when there is no report', () => {
  it('a connection or lookup failure, which undici folds into "fetch failed", is an outage', () => {
    expect(classify(1, failure('pnpm', 'fetch failed'))).toBe('unreachable');
  });

  it('a server error from the endpoint is an outage', () => {
    expect(
      classify(
        1,
        failure(
          'ERR_PNPM_AUDIT_BAD_RESPONSE',
          `The audit endpoint (at ${ENDPOINT}) responded with 503: Service Unavailable`,
        ),
      ),
    ).toBe('unreachable');
  });

  it('a timeout that escapes as text, with no document at all, is an outage', () => {
    const stderr =
      'TimeoutError: The operation was aborted due to timeout\n' +
      '    at Timeout._onTimeout (node:internal/abort_controller:210:9)\n';
    expect(classify(1, '', stderr)).toBe('unreachable');
  });

  it('a refusal from the endpoint is not an outage', () => {
    expect(
      classify(
        1,
        failure(
          'ERR_PNPM_AUDIT_BAD_RESPONSE',
          `The audit endpoint (at ${ENDPOINT}) responded with 403: Forbidden`,
        ),
      ),
    ).toBe('failed');
  });

  it('a fault of our own is not an outage', () => {
    expect(
      classify(1, failure('ERR_PNPM_NO_LOCKFILE', 'No pnpm-lock.yaml found: Cannot audit')),
    ).toBe('failed');
    expect(classify(1, '', 'ERR_PNPM_NO_LOCKFILE  Cannot audit without a lockfile\n')).toBe(
      'failed',
    );
  });

  it('a clean exit without a document is still clean', () => {
    expect(classify(0, '')).toBe('clean');
  });
});
