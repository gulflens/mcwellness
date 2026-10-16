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
    case 'external':
      // A PDF made in another tool and uploaded here (migration 608). Named
      // for how it came, because what it is, its own pages say.
      return 'Uploaded';
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
 * Which of the session and progress editor's two kinds a draft of this kind
 * opens as, or none. That editor writes those two kinds and gathers their
 * figures. A brain-map report is never one of them: its draft opens in its
 * own form (`qeeg/QeegEditor.tsx`, docs/SPEC/reports-qeeg.md section 15),
 * which the Reports tab chooses before it asks this, so a brain-map row never
 * reaches a form that would read it wrongly.
 */
export function editorKindFor(kind: ReportKind): 'session' | 'progress' | null {
  switch (kind) {
    case 'session':
    case 'progress':
      return kind;
    case 'qeeg':
    case 'external':
      return null;
    default: {
      const unknown: never = kind;
      return unknown;
    }
  }
}

/**
 * Whether a signed report of this kind is corrected here ("Correct this
 * report"). Every kind written here is; an uploaded PDF is not, because
 * nothing here can write that PDF again — a correction of one is a new
 * upload, and the server refuses the other way (`external_report`).
 */
export function isCorrectedHere(kind: ReportKind): boolean {
  switch (kind) {
    case 'session':
    case 'progress':
    case 'qeeg':
      return true;
    case 'external':
      return false;
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
