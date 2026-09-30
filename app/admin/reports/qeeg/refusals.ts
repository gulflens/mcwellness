import { SECTION_TITLES, sectionOfField } from './sections';

/**
 * A sentence for every refusal `POST /api/reports/draft` answers a brain-map
 * save with (app/api/reports/qeegDraft.ts), as the other report editor keeps
 * one per code (`ReportEditor.tsx`).
 *
 * **Plain, and saying what to do.** The practitioner is at her desk with a
 * form in front of her. "Invalid" tells her nothing; the section, and the
 * domain's own reason for the field, tell her where to look. The stale save
 * says that a newer version exists elsewhere and that nothing was written
 * over it, because the one thing she must not believe is that her screen
 * replaced it.
 */

export const DRAFT_REFUSALS: Readonly<Record<string, string>> = Object.freeze({
  invalid_request:
    'The form sent something the server does not accept. Reload the page and try again.',
  reason_required: 'The save did not say why it was made, so nothing was saved. Try again.',
  invalid_content: 'Something in the report is not what the report accepts.',
  route_owned:
    'The form sent a part of the report the server fills in itself, so nothing was saved. Reload the page and try again.',
  wrong_kind: 'This is not a brain-map report, so it cannot be saved from this form.',
  already_issued: 'This report has already been signed, so it can no longer be changed.',
  imported_draft:
    'This is a past record read from the old tool. It is reviewed through its own screen, not saved here.',
  locale_fixed: 'The language of a saved report cannot be changed.',
  cannot_compare: 'The earlier report chosen cannot be compared with.',
  stale_draft:
    'A newer version of this draft was saved somewhere else, perhaps in another tab. Nothing here was saved over it.',
  unlinked_figure:
    'A map the report names is not on this draft, so nothing was saved. Take it out where it is named, then add it again.',
  figure_mismatch:
    'A map the report names does not match the picture on file, so nothing was saved. Take it out where it is named, then add it again.',
});

/** Why the earlier report a follow-up names was refused (`prefillFollowUp`, and the route's own). */
export const CANNOT_COMPARE: Readonly<Record<string, string>> = Object.freeze({
  no_such_report: 'The earlier report chosen could not be found.',
  not_a_brain_map: 'The earlier report chosen is not a brain-map report.',
  other_client: 'The earlier report chosen belongs to another client.',
  erased: 'This client’s record has been erased, so nothing can be compared with it.',
  same_report: 'A report cannot be compared with itself.',
  superseded:
    'The earlier report chosen has been replaced by a newer version. Choose the version that stands.',
  draft:
    'The earlier report chosen is still a draft. Only a signed report or a kept past record can be compared with.',
  withdrawn: 'The earlier report chosen was withdrawn, so it cannot be compared with.',
  no_reference: 'The earlier report chosen has no reference to name it by.',
  undated: 'The earlier report chosen has no recording date, so nothing can be measured from it.',
  no_such_day: 'The recording date is not a real day.',
  recorded_later: 'This recording is dated before the report it is compared with.',
  map_not_held:
    'The earlier report does not hold the map chosen for before, so nothing was saved. Choose one of its maps again.',
});

const FORBIDDEN = 'You are not allowed to write reports for this client.';
const NOT_FOUND =
  'This draft or this client could not be found. It may have been removed, or you may no longer have access to it.';
const FALLBACK = 'The draft could not be saved. Check the connection and try again.';

type Refusal = {
  error?: unknown;
  code?: unknown;
  reason?: unknown;
  field?: unknown;
  refusals?: unknown;
};

function asRefusal(body: unknown): Refusal {
  return typeof body === 'object' && body !== null ? (body as Refusal) : {};
}

/** The first reason the shape gave, for the field it named. */
function firstReason(refusal: Refusal): string | null {
  if (!Array.isArray(refusal.refusals)) return null;
  const first: unknown = refusal.refusals[0];
  if (typeof first !== 'object' || first === null) return null;
  const reason = (first as { reason?: unknown }).reason;
  return typeof reason === 'string' ? reason : null;
}

export function refusalSentence(status: number, body: unknown): string {
  const refusal = asRefusal(body);
  if (status === 403) return FORBIDDEN;
  if (status === 404) return NOT_FOUND;
  const code =
    typeof refusal.code === 'string'
      ? refusal.code
      : typeof refusal.error === 'string'
        ? refusal.error
        : '';
  if (code === 'cannot_compare' && typeof refusal.reason === 'string') {
    return CANNOT_COMPARE[refusal.reason] ?? DRAFT_REFUSALS['cannot_compare'] ?? FALLBACK;
  }
  if (
    (code === 'unlinked_figure' || code === 'figure_mismatch') &&
    typeof refusal.field === 'string'
  ) {
    return `${DRAFT_REFUSALS[code] ?? FALLBACK} It is named in ${whereWords(refusal.field)}.`;
  }
  if (code === 'invalid_content') {
    const field = typeof refusal.field === 'string' ? refusal.field : '';
    const section = sectionOfField(field);
    const reason = firstReason(refusal);
    if (section !== null && reason !== null) {
      return `Something in ${SECTION_TITLES[section]} is not what the report accepts: ${reason}`;
    }
  }
  return Object.hasOwn(DRAFT_REFUSALS, code) ? (DRAFT_REFUSALS[code] ?? FALLBACK) : FALLBACK;
}

// ---------------------------------------------------------------------------
// The brain maps' two doors, and what the form refuses before sending
// ---------------------------------------------------------------------------

const SMALLER = 'Export it again at a smaller size: a map is never shrunk here.';
const PREPARED = 'The form prepares every map before it is sent, so reload the page and try again.';

/**
 * A sentence for every refusal of a brain map: the ones the form makes before
 * a picture leaves the browser (the caps of `image/limits.ts`, the eighth map,
 * a file that is not a picture), and every code the upload and remove doors
 * answer (app/api/reports/qeeg/figures.ts and `FIGURE_SENTENCES`). The form's
 * own words, as for a save: the practitioner needs to know what to do next,
 * and "export it again" or "remove one first" is that.
 *
 * A cap is refused and never shrunk around (section 9, point 3), and every
 * sentence of a cap says so, because the obvious question is why the form
 * did not just make it fit.
 */
export const FIGURE_REFUSALS: Readonly<Record<string, string>> = Object.freeze({
  // The caps, before sending and at the door.
  too_wide: `This map is wider than 4,096 pixels. ${SMALLER}`,
  too_tall: `This map is taller than 4,096 pixels. ${SMALLER}`,
  too_many_pixels: `This map has more than 12 million pixels. ${SMALLER}`,
  too_many_bytes: `This map is larger than 5 MB once prepared. ${SMALLER}`,
  too_many_maps: 'A report holds eight maps. Remove one before adding another.',
  empty: 'This picture has nothing in it to place. Choose the exported map itself.',
  file_too_large: `This file is larger than 40 MB, far more than any map needs. ${SMALLER}`,
  cannot_prepare:
    'This browser could not prepare the map, perhaps for want of memory. Close other tabs and try again, or use an up-to-date browser on a computer.',
  undecodable:
    'This file could not be read as a picture. Choose a map exported as a PNG, JPEG or BMP.',
  // The picture as the door checks it.
  not_a_png: `What arrived was not a PNG picture. ${PREPARED}`,
  not_rgb: `What arrived was not in plain colour. ${PREPARED}`,
  not_8_bit: `What arrived was not 8 bits to a colour. ${PREPARED}`,
  interlaced: `What arrived was interlaced. ${PREPARED}`,
  transparency: `What arrived still carried transparency. ${PREPARED}`,
  palette: `What arrived carried a colour palette. ${PREPARED}`,
  text: `What arrived carried text inside the file. ${PREPARED}`,
  metadata: `What arrived carried device details inside the file. ${PREPARED}`,
  unknown_chunk: `What arrived carried more than the picture. ${PREPARED}`,
  trailing_bytes: `What arrived carried data after the picture. ${PREPARED}`,
  // The form wrote the file and the door checked its digest first, so a
  // picture the door cannot read whole is the form's fault, never her export's.
  split_data: `What arrived had its picture data broken up. ${PREPARED}`,
  damaged: `What arrived did not read as a whole picture. ${PREPARED}`,
  // The request.
  invalid_request: 'The form asked for something the server does not accept. Reload the page.',
  digest_missing: 'The map was sent without its fingerprint. Try adding it again.',
  digest_mismatch:
    'The map changed on its way to the server, so it was not kept. Try adding it again.',
  empty_body: 'The map arrived empty. Try adding it again.',
  reason_required: 'The form did not say why the map was changed, so nothing was done. Try again.',
  unsupported_media_type: 'The map was not sent as a picture. Reload the page and try again.',
  storage_unavailable:
    'The store that keeps the maps cannot be reached just now, so nothing was changed. Try again later.',
  // The report.
  wrong_kind: 'This is not a brain-map report, so it holds no maps.',
  not_a_draft: 'This report is no longer a draft. Its maps are kept as they were signed.',
  not_permitted: 'You are not allowed to change the maps of this report.',
  not_accepted: 'This report cannot take this picture.',
  no_such_map: 'That map is no longer on this report.',
  figure_in_use: 'This map is still used elsewhere in the report. Take it out there first.',
  // No answer, or one the form cannot read: the door may have finished.
  unknown_outcome:
    'The server’s answer did not arrive, so the form cannot tell whether the map was kept. It may have been filed with the report. Reload the draft, then choose the same file again: a picture already kept is never filed twice.',
  // What the list of the draft's pictures showed after such an answer.
  kept_after_all:
    'The server’s answer did not arrive, but the map was kept, and it is now on the report.',
  not_kept: 'The server’s answer did not arrive, and the map was not kept. Try adding it again.',
  removed_after_all: 'The server’s answer did not arrive, but the map was removed.',
  not_removed:
    'The server’s answer did not arrive, and the map was not removed. It is back in the list; try again.',
  unknown_removal:
    'The server’s answer did not arrive, so the form cannot tell whether the map was removed. It may have been. It is off the draft; reload the draft to see where it stands.',
});

const MAPS_FORBIDDEN = 'You are not allowed to change the maps of this client’s reports.';
const MAPS_NOT_FOUND =
  'This draft could not be found. It may have been removed, or you may no longer have access to it.';
const MAPS_FALLBACK = 'The map could not be sent. Check the connection and try again.';

const CONDITION_WORDS: Readonly<Record<string, string>> = Object.freeze({
  eyes_open: 'eyes open',
  eyes_closed: 'eyes closed',
});

/** Where the report names a picture, from the path a refusal gives, in words. */
export function whereWords(path: string): string {
  const parts = path.split('.');
  if (parts[0] === 'maps') return 'the saved list of brain maps';
  if (parts[0] === 'change' && parts[1] === 'pairs') {
    const condition = CONDITION_WORDS[parts[2] ?? ''] ?? 'one condition';
    const side = parts[3] === 'earlier' ? 'the earlier side' : 'the later side';
    return `${SECTION_TITLES.change}, before and after, ${condition}, ${side}`;
  }
  return 'another part of the report';
}

/** The pictures uploaded and not on the report, as a clause that says they could make room. */
function roomWords(unplaced: number): string {
  if (unplaced <= 0) return '';
  return unplaced === 1
    ? ' 1 uploaded picture is not on the report; removing it makes room.'
    : ` ${unplaced} uploaded pictures are not on the report; removing them makes room.`;
}

/**
 * What the form says when a map was refused, before it was sent (status 0) or
 * by a door. The eighth-map refusal also names how many pictures uploaded and
 * not placed could be removed to make room, when the form knows.
 */
export function figureRefusalSentence(
  status: number,
  body: unknown,
  { unplaced = 0 }: { unplaced?: number } = {},
): string {
  const refusal = asRefusal(body);
  const code =
    typeof refusal.code === 'string'
      ? refusal.code
      : typeof refusal.error === 'string'
        ? refusal.error
        : '';
  if (code === 'figure_in_use' && typeof refusal.field === 'string') {
    return `This map is still used in ${whereWords(refusal.field)}. Take it out there first, then remove it.`;
  }
  if (code === 'too_many_maps')
    return `${FIGURE_REFUSALS[code] ?? MAPS_FALLBACK}${roomWords(unplaced)}`;
  if (Object.hasOwn(FIGURE_REFUSALS, code)) return FIGURE_REFUSALS[code] ?? MAPS_FALLBACK;
  if (status === 403) return MAPS_FORBIDDEN;
  if (status === 404) return MAPS_NOT_FOUND;
  return MAPS_FALLBACK;
}

/**
 * What the form says when the list of a draft's pictures
 * (`GET /api/reports/:id/figures`) could not be read, by what the route
 * answered: a bad id, someone who may not change the pictures, a report that
 * cannot be seen, or one that is not a brain map. The form goes on without
 * the list: nothing is changed because it could not be read.
 */
export function listRefusalSentence(status: number, body: unknown): string {
  const refusal = asRefusal(body);
  const code = typeof refusal.code === 'string' ? refusal.code : '';
  if (code === 'wrong_kind')
    return 'This is not a brain-map report, so it has no pictures to list.';
  if (status === 400)
    return 'The form asked for the pictures in a way the server does not accept. Reload the page.';
  if (status === 403) return 'You are not allowed to see the pictures uploaded to this draft.';
  if (status === 404)
    return 'The pictures uploaded to this draft could not be found. The draft may have been removed.';
  return 'The pictures uploaded to this draft could not be listed. Check the connection and open the section again.';
}
