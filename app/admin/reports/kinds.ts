import type { ReportKind, ReportStatus } from '../../../domain/reports';
import type { StatusTone } from '../../shell/components/StatusChip';

/**
 * The console's words for a report's kind and status, and the two questions
 * the Reports tab and the report's own page ask of them: which editor a draft
 * opens in, and whether a report may be sent.
 *
 * **Exhaustive, and in one place.** The tab and the page each carried a
 * two-way `kind === 'progress' ? … : …` and a string-keyed table, which read a
 * third kind as the second and a fourth status as nothing at all. The
 * brain-map report (`qeeg`) and the past record (`imported`) arrived with
 * migrations 602 and 603 (docs/SPEC/reports-qeeg.md), so every answer here is
 * a `switch` over the closed list, and a kind or a status added later is a
 * compile error in this file rather than a row the console misnames.
 *
 * English only, as every console screen is (tests/lint/console-is-english.test.ts).
 */

/** The short word the Reports tab's Kind column prints. */
export function kindWord(kind: ReportKind): string {
  switch (kind) {
    case 'session':
      return 'Session';
    case 'progress':
      return 'Progress';
    case 'qeeg':
      return 'Brain map';
    default: {
      const unknown: never = kind;
      return unknown;
    }
  }
}

/** The kind as the report's own page names it. */
export function kindLabel(kind: ReportKind): string {
  return `${kindWord(kind)} report`;
}

export function statusWord(status: ReportStatus): string {
  switch (status) {
    case 'draft':
      return 'Draft';
    case 'issued':
      return 'Issued';
    case 'superseded':
      return 'Replaced';
    case 'imported':
      return 'Past record';
    default: {
      const unknown: never = status;
      return unknown;
    }
  }
}

export function statusTone(status: ReportStatus): StatusTone {
  switch (status) {
    case 'issued':
      return 'ok';
    case 'draft':
    case 'superseded':
    case 'imported':
      return 'neutral';
    default: {
      const unknown: never = status;
      return unknown;
    }
  }
}

/**
 * The editor a draft of this kind opens in, or none. The session and progress
 * editor writes those two kinds and gathers their figures; a brain-map report
 * has an editor of its own (docs/SPEC/reports-qeeg.md section 15), and until
 * it is on the screen a brain-map row opens where any signed report does, in
 * the report's own page, rather than in a form that would read it wrongly.
 */
export function editorKindFor(kind: ReportKind): 'session' | 'progress' | null {
  switch (kind) {
    case 'session':
    case 'progress':
      return kind;
    case 'qeeg':
      return null;
    default: {
      const unknown: never = kind;
      return unknown;
    }
  }
}

/**
 * Whether the page offers sending. A signed report, standing or replaced (a
 * household may be sent the correction of one); never a draft, and never a
 * past record, which was not signed here and has no PDF (section 11, point 4).
 * `domain/reports/canDeliver` is the rule that binds; this is the courtesy of
 * not offering a button it would refuse.
 */
export function mayBeSent(status: ReportStatus): boolean {
  switch (status) {
    case 'issued':
    case 'superseded':
      return true;
    case 'draft':
    case 'imported':
      return false;
    default: {
      const unknown: never = status;
      return unknown;
    }
  }
}
