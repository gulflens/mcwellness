import type { ReportStatus } from './types';

/**
 * Rule 4a (docs/SPEC/reports-v1.md section 8): correcting an issued report.
 *
 * **A correction is a new version, never an edit** (section 3). The superseded
 * version stays and is still readable, because a household may already hold
 * it: a record that quietly becomes the corrected one cannot answer the only
 * question that matters afterwards — what did they actually receive?
 *
 * Three refusals, and each is a different mistake:
 *
 * - a **draft** has nothing to supersede; it is edited, which is ordinary work;
 * - an **already superseded** version is not the standing one, and letting a
 *   chain fork would give two answers to "which version is current" (section
 *   10, decision 5);
 * - a supersede **with no reason** leaves the trail saying a document changed
 *   and never why, which is the whole value of keeping both.
 *
 * Pure.
 */

export type SupersedeRefusalCode = 'not_issued' | 'already_superseded' | 'no_reason';

export type SupersedeAnswer =
  { ok: true; reason: string } | { ok: false; code: SupersedeRefusalCode };

/** As much of the standing version as this question needs. */
export type SupersedableReport = { status: ReportStatus; version: number };

/** The shortest reason worth writing down. Shorter than this is not a reason. */
export const MIN_SUPERSEDE_REASON = 5;
export const MAX_SUPERSEDE_REASON = 500;

export function canSupersede(report: SupersedableReport, reason: string): SupersedeAnswer {
  if (report.status === 'draft') {
    return { ok: false, code: 'not_issued' };
  }
  if (report.status === 'superseded') {
    return { ok: false, code: 'already_superseded' };
  }
  const trimmed = reason.trim();
  if (trimmed.length < MIN_SUPERSEDE_REASON) {
    return { ok: false, code: 'no_reason' };
  }
  return { ok: true, reason: trimmed.slice(0, MAX_SUPERSEDE_REASON) };
}

/** The version a supersede of this one would carry. */
export function nextVersion(report: SupersedableReport): number {
  return report.version + 1;
}
