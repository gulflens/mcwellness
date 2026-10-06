import type { ImportNote, ImportNoteCode } from '../../../../domain/reports/qeeg/types';

/**
 * The words of bringing in a past record from the practice's old report tool
 * and of its read-only page (docs/SPEC/reports-qeeg.md section 11; brief R,
 * item 7): a sentence for every code the three doors answer
 * (`app/api/reports/qeeg/pastRecord.ts`), for every reason the reader refuses
 * a file, and for every note of what could not be carried.
 *
 * **A note says where, never what.** The reader and the keep record the FIELD
 * a note is about and never what was typed there (point 5), so the sentence
 * names the place in words: a part of the report, or a picture's place in the
 * file, counted from one as a person counts.
 *
 * English only, as every console screen is (tests/lint/console-is-english.test.ts).
 */

/** Every code the import, keep and withdraw doors answer. */
export const PAST_RECORD_CODES = Object.freeze([
  'invalid_request',
  'reason_required',
  'not_permitted',
  'not_found',
  'invalid_content',
  'route_owned',
  'digest_mismatch',
  'not_a_past_record',
  'maps_come_after',
  'client_erased',
  'consent_missing',
  'already_imported',
  'storage_unavailable',
  'unlinked_figure',
  'figure_mismatch',
  'map_missing',
  'map_differs',
  'unplaced_figures',
  'invalid_placement',
  'stale_draft',
  'nothing_to_keep',
  'already_kept',
  'already_withdrawn',
  'in_comparison',
  'reason_too_long',
] as const);

const RELOAD = 'Reload the page and try again.';

export const IMPORT_REFUSALS: Readonly<Record<string, string>> = Object.freeze({
  invalid_request: `The screen sent something the server does not accept. ${RELOAD}`,
  reason_required: `The request did not say why it was made, so nothing was done. ${RELOAD}`,
  not_permitted:
    'Only the owner and the lead practitioner may bring in, keep or withdraw a past record.',
  not_found: 'This client or this record could not be found. It may have been removed.',
  invalid_content:
    'The file was read, but what it holds is not what a past record accepts, so it was not brought in.',
  route_owned:
    'The screen sent the person the file names, which is never kept. Nothing was brought in. Reload the page and try again.',
  digest_mismatch:
    'The file’s fingerprint did not match what was read from it, so it was not brought in. Choose the file again.',
  not_a_past_record: 'This is not a past record read from the old tool.',
  maps_come_after: `The pictures of a past record are added after it is brought in. ${RELOAD}`,
  client_erased: 'This client’s record has been erased, so nothing can be kept about them.',
  consent_missing:
    'This household has not yet agreed to everything a brain-map report needs: taking part, the practice holding brain data, and a guardian’s agreement for a child. Record their agreement on the client’s Consent tab first.',
  already_imported: 'This file has already been brought in for this client.',
  storage_unavailable:
    'The store that keeps the maps cannot be reached just now, so nothing was changed. Try again shortly.',
  unlinked_figure: `A picture the record names is not on it, so it was not kept. ${RELOAD}`,
  figure_mismatch: `A picture the record names is not the one on file, so it was not kept. ${RELOAD}`,
  map_missing:
    'A picture of the record is missing from the store, so it was not kept. Bring the file in again.',
  map_differs:
    'A picture of the record is not what was filed, so it was not kept. Bring the file in again.',
  unplaced_figures:
    'A picture was filed with the record and not placed in it, so it was not kept. Choose the file again to finish.',
  invalid_placement: `A picture was placed where the file had none, so it was not kept. ${RELOAD}`,
  stale_draft:
    'The record changed after this screen read it, perhaps in another tab, so it was not kept. Choose the file again to finish.',
  nothing_to_keep: 'This record holds nothing to keep.',
  already_kept: 'This record has already been kept.',
  already_withdrawn: 'This record has already been withdrawn.',
  in_comparison:
    'A follow-up report is compared with this record, so it cannot be withdrawn. Compare that report with another first.',
  reason_too_long: 'Say why in 200 characters or fewer; the reason is kept with the record.',
});

const FALLBACK = 'That could not be done. Check the connection and try again.';

type Refusal = {
  code?: unknown;
  error?: unknown;
  status?: unknown;
  withdrawn?: unknown;
  reportIds?: unknown;
};

function asRefusal(body: unknown): Refusal {
  return typeof body === 'object' && body !== null ? (body as Refusal) : {};
}

/** What the screen says when one of the three doors refused. */
export function pastRecordRefusalSentence(status: number, body: unknown): string {
  const refusal = asRefusal(body);
  const code =
    typeof refusal.code === 'string'
      ? refusal.code
      : typeof refusal.error === 'string'
        ? refusal.error
        : '';
  if (code === 'already_imported' && refusal.status === 'imported') {
    return refusal.withdrawn === true
      ? 'This file was brought in for this client before and withdrawn, so it is not brought in for them again.'
      : 'This file is already kept as a past record for this client.';
  }
  if (
    code === 'in_comparison' &&
    Array.isArray(refusal.reportIds) &&
    refusal.reportIds.length > 1
  ) {
    return `${refusal.reportIds.length} follow-up reports are compared with this record, so it cannot be withdrawn. Compare them with another report first.`;
  }
  if (Object.hasOwn(IMPORT_REFUSALS, code)) return IMPORT_REFUSALS[code] ?? FALLBACK;
  if (status === 403) return IMPORT_REFUSALS['not_permitted'] ?? FALLBACK;
  if (status === 404) return IMPORT_REFUSALS['not_found'] ?? FALLBACK;
  return FALLBACK;
}

/** Why a chosen file could not be read, in the browser, before anything was sent. */
export function readRefusalSentence(reason: string): string {
  switch (reason) {
    case 'not_json':
      return 'This file is not a report saved by the old tool: it could not be read as one.';
    case 'not_an_object':
    case 'not_a_report_file':
      return 'This file is not a report saved by the old tool.';
    case 'unknown_version':
      return 'This report was saved by a version of the old tool this app does not read.';
    case 'too_large':
      return 'This file is larger than any report the old tool saved, so it was not read.';
    default:
      return 'This file could not be read.';
  }
}

const NOTE_WORDS: Readonly<Record<ImportNoteCode, string>> = Object.freeze({
  score_defaulted: 'A score nobody set, which the old tool printed as 5',
  value_not_recognised: 'A value this app has no name for, left out',
  extra_positions_ignored: 'More entries than this app keeps, the rest left out',
  summary_colour_dropped: 'Colour in the summary, not kept',
  summary_slant_dropped: 'Slanted text in the summary, kept upright',
  summary_content_dropped: 'A picture or a list inside the summary, not kept',
  summary_formatting_unreadable:
    'Formatting in the summary that could not be read, kept as plain text',
  signature_image_dropped: 'The picture of a signature, not kept',
  map_label_kept_as_caption:
    'A map label that is not eyes open or eyes closed, kept as its caption',
  map_without_image_dropped: 'A map place with no picture in it, left out',
  text_shortened:
    'Text longer than this app keeps, or holding characters it does not keep, shortened',
  map_not_brought_in: 'A picture was not brought in',
});

/** A note's place in words: a picture's place in the file, or the part of the report. */
export function placeWords(at: string | null): string {
  if (at === null || at === '') return 'the file';
  const picture = /^images\.map-(\d+)/.exec(at);
  if (picture?.[1] !== undefined) {
    return `the picture in place ${Number(picture[1]) + 1} of the file`;
  }
  if (at === 'images') return 'the pictures of the file';
  return at
    .split('.')
    .map((part) => part.replace(/[_-]/g, ' '))
    .join(', ');
}

/** One note of what could not be carried, as a sentence. */
export function noteSentence(note: ImportNote): string {
  return `${NOTE_WORDS[note.code]}: ${placeWords(note.at)}.`;
}
