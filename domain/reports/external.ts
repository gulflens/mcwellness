import { bytesMatchMimeType } from '../shared/fileSignature';
import type { IsoDate, ReportKind } from './types';

/**
 * An uploaded report (kind `external`, migrations 607 and 608): a PDF the
 * practice produced in another tool — its desktop brain-map report builder,
 * for one — filed against a client so it can be put in front of the
 * household the way a report written here is.
 *
 * **The PDF is the signed artefact.** It was finished, and signed if it is
 * signed, in the tool that made it; this app neither renders it nor signs it.
 * So an uploaded report has no draft and no signature here: it is filed
 * already issued, numbered as every issued report is, and carries the
 * person who uploaded it (`created_by`) instead of a signer.
 *
 * This file is the rule a filing must meet before a row is written: a PDF
 * by its bytes (never by the name or the type the browser gave it), not
 * empty, not over the cap, with a title a person can read on a list and the
 * date the report bears, which has already happened. The row's own checks
 * say the same about the title and the size underneath.
 *
 * Pure: values in, an answer out. Today is an argument, never read in here.
 */

/** Twenty megabytes: a long report with its pictures in it, and a number a phone can carry. */
export const EXTERNAL_REPORT_MAX_BYTES = 20 * 1024 * 1024;

/** The longest title, as migration 608's check holds it too. */
export const EXTERNAL_TITLE_MAX = 120;

export type ExternalUploadRefusal =
  | 'not_a_pdf'
  | 'empty_file'
  | 'too_many_bytes'
  | 'no_title'
  | 'title_too_long'
  | 'no_date'
  | 'date_in_future';

export type ExternalUploadAnswer =
  { ok: true; title: string; reportDate: IsoDate } | { ok: false; code: ExternalUploadRefusal };

// Control characters (Cc) and the invisible format characters (Cf: zero-width
// spaces, direction marks, the byte-order mark), by Unicode category.
const INVISIBLE = /[\p{Cc}\p{Cf}]/gu;

/**
 * Control and invisible characters out, runs of white space made one space,
 * the ends trimmed. A title is read on a list and in a household's portal;
 * a zero-width run that reads as nothing is no title.
 */
function tidy(title: string): string {
  return title.replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
}

/** A real calendar date as YYYY-MM-DD: 2026-02-30 is not one. */
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function checkExternalUpload(input: {
  title: string;
  reportDate: string;
  bytes: Uint8Array;
  /** Today in the practice's own time zone. */
  today: IsoDate;
}): ExternalUploadAnswer {
  if (input.bytes.byteLength === 0) return { ok: false, code: 'empty_file' };
  if (input.bytes.byteLength > EXTERNAL_REPORT_MAX_BYTES) {
    return { ok: false, code: 'too_many_bytes' };
  }
  if (!bytesMatchMimeType(input.bytes, 'application/pdf')) return { ok: false, code: 'not_a_pdf' };

  const title = tidy(input.title);
  if (title.length === 0) return { ok: false, code: 'no_title' };
  if (title.length > EXTERNAL_TITLE_MAX) return { ok: false, code: 'title_too_long' };

  if (!isCalendarDate(input.reportDate)) return { ok: false, code: 'no_date' };
  // ISO dates compare correctly as strings.
  if (input.reportDate > input.today) return { ok: false, code: 'date_in_future' };

  return { ok: true, title, reportDate: input.reportDate };
}

/**
 * The title an uploaded report carries in its content, or null: for every
 * other kind, and for an uploaded report whose content an erasure emptied.
 */
export function externalTitleOf(kind: ReportKind, content: unknown): string | null {
  if (kind !== 'external') return null;
  if (content === null || typeof content !== 'object' || Array.isArray(content)) return null;
  // `externalReportTitle`, never `title`: a name nothing else uses, so the
  // trail can drop it by name (migration 979) and an erasure leaves no copy.
  const title = (content as { externalReportTitle?: unknown }).externalReportTitle;
  return typeof title === 'string' && title.length > 0 ? title : null;
}
