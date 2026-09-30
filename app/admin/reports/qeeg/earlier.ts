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
 * **In the order they were recorded** (brief R, item 8; M's parked note 9).
 * A past record is brought in long after it was recorded, so the day its row
 * was made says nothing of its place among the client's reports. The day of
 * recording, which the list row carries from the content, orders them, and
 * the day each row was made breaks a tie. The client's first comes first, and
 * is where the choice starts: the specification's default.
 *
 * A kept past record that was withdrawn, or that holds no day of recording,
 * is left out: the route refuses both (`withdrawn`, `undated`). A draft being
 * brought in is no candidate either.
 */
export function comparableReports(rows: readonly ReportRow[]): ReportRow[] {
  return rows
    .filter(
      (row) =>
        row.kind === 'qeeg' &&
        (row.status === 'issued' ||
          (row.status === 'imported' && !row.withdrawn && row.recordedOn !== null)),
    )
    .sort(
      (a, b) =>
        (a.recordedOn ?? '').localeCompare(b.recordedOn ?? '') ||
        a.createdAt.localeCompare(b.createdAt),
    );
}

/** How a report is named in a list: its reference, or the day a past record was recorded. */
export function earlierLabel(row: ReportRow): string {
  if (row.status === 'imported') {
    return row.recordedOn === null
      ? 'Past record from the old tool'
      : `Past record from the old tool, recorded on ${displayFromIso(row.recordedOn)}`;
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
