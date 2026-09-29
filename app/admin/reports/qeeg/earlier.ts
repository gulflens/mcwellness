import { displayFromIso } from '@domain/shared';
import type { ComparedWith } from '../../../../domain/reports/qeeg/types';
import type { ReportRow } from '../../../api/reports/schema';

/**
 * Which of a client's reports the form offers a follow-up to be compared
 * with, and how it names them (docs/SPEC/reports-qeeg.md section 3).
 *
 * **A courtesy, not the rule.** The route asks `prefillFollowUp` of the
 * report chosen and refuses, with a reason the form puts in words, anything
 * it may not be compared with: another client's, a draft, one replaced by a
 * newer version, a past record withdrawn. The form only leaves out of the list
 * what it can already see is no candidate, so she is not offered a choice the
 * server would refuse: anything but a brain-map report, signed or kept.
 *
 * The client's first comes first, and is where the choice starts: the
 * specification's default.
 */
export function comparableReports(rows: readonly ReportRow[]): ReportRow[] {
  return rows
    .filter((row) => row.kind === 'qeeg' && (row.status === 'issued' || row.status === 'imported'))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** How a report is named in a list: its reference, or when a past record was kept. */
export function earlierLabel(row: ReportRow): string {
  if (row.status === 'imported') {
    return `Past record, kept on ${displayFromIso(row.createdAt.slice(0, 10))}`;
  }
  const on = row.issuedOn ? `, signed on ${displayFromIso(row.issuedOn)}` : '';
  return `${row.reference ?? 'Signed report'}${on}`;
}

/**
 * What the form holds for the comparison until the first save answers.
 *
 * The request carries only `reportId`; the route reads the rest from that
 * report and sends it back (`withServerParts`). Until then the form has the
 * reference the list gave it and no recording day, and says so.
 */
export function comparedFromRow(row: ReportRow): ComparedWith {
  // "Previous" until the server says: it is true of any earlier report, where
  // "initial" would misname a later one in the overview's sentence.
  const common = { reportId: row.id, recordedOn: '', relation: 'previous' as const };
  return row.status === 'imported'
    ? { ...common, origin: 'imported', reference: null }
    : { ...common, origin: 'issued', reference: row.reference ?? '' };
}
