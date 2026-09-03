// Types for scripts/audit-deps.mjs, so the test can import the classifier.
export type AuditVerdict = 'clean' | 'advisory' | 'unreachable' | 'failed';
export function classify(exitCode: number | null, output: string): AuditVerdict;
