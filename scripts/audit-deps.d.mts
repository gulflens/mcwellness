// Types for scripts/audit-deps.mjs, so the test can import the classifier.
export type AuditVerdict = 'clean' | 'advisory' | 'unreachable' | 'failed';
export type AuditDocument =
  | { kind: 'report'; high: number; critical: number }
  | { kind: 'error'; code: string; message: string };
export function readDocument(stdout: string): AuditDocument | null;
export function classify(exitCode: number | null, stdout: string, stderr?: string): AuditVerdict;
