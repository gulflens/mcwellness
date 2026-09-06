import { KNOWN_MIME_TYPES, bytesAreAnEdf, bytesMatchMimeType } from '../shared/fileSignature';

/**
 * What an export's first bytes say it is, checked against what the caller says
 * it is (docs/SPEC/assessment.md section 7.1 and decision 3, amended on the
 * founder's equipment answer of 2026-09-06).
 *
 * A route that files whatever bytes it is handed under whatever media type it
 * is told is a route that will one day hold an HTML page called a report, and
 * a signed link to it is a link a browser may render. The store's own answers
 * narrow that — the folder implementation serves everything as an attachment —
 * but the bucket serves the type the row records, so the check belongs where
 * the row is written.
 *
 * **Three kinds now, because the practice's equipment is named.** Decision 3
 * accepted `application/pdf` alone "until the equipment is named"; on
 * 2026-09-06 the founder named it, and her own workflow produces three sorts
 * of file:
 *
 * - **the vendor's PDF** — the report the analysis software writes, one per
 *   condition, and the session summary the neurofeedback software exports;
 * - **the EDF recording** — the interchange format the amplifier's recorder
 *   writes, one file per condition, tens of megabytes each. Its header is
 *   fixed by the published format and begins with an eight-byte version field:
 *   an ASCII zero followed by seven spaces. That is a signature, and it is
 *   read here as one;
 * - **the amplifier software's own recording** — the format its own
 *   application reads and writes, which is where a recording lives before
 *   anything converts it.
 *
 * **Why the third is recognised differently, and it is a default taken rather
 * than a fact established.** The native format is a vendor's own and is not
 * published; the practice sent one file of it, and one file cannot prove that
 * anything at the front of it is fixed rather than a count or a rate that
 * changes with the recording. Guessing a signature from a single sample is how
 * a door starts refusing the practice's own files six months from now. So this
 * kind is accepted by the extension the file was chosen under together with a
 * declared `application/octet-stream`, which is the fallback
 * `docs/SPEC/assessment.md` names — and it is fenced rather than opened: bytes
 * the platform already recognises as one of its four known types are refused,
 * because a PDF under this extension is a mislabelled PDF, and so is anything
 * beginning as markup — past a byte-order mark and any leading whitespace,
 * because that is what a browser itself reads past — which is the one shape a
 * signed link could ever be talked into rendering. A second sample would let a signature replace all of
 * that, and it should.
 *
 * **An extension is not a file name.** What crosses the door is the few
 * characters after the last dot and never the name itself: the practice's own
 * files are named after the people in them, and a name is not something this
 * platform has any business receiving, logging or storing. `normaliseExtension`
 * refuses anything with a dot or a separator left in it for that reason, so a
 * caller sending a whole file name is told nothing was sent at all.
 *
 * **The EDF signature is `domain/shared`'s question**: the trunk answered it in
 * round 33, and it is re-exported below so no caller moved.
 *
 * **Nothing here parses a recording.** It reads at most the first eight bytes
 * and asks one question of them. The header's next field is the person's own
 * identity, and this module never reaches it (spec section 7.1).
 */

/**
 * The eight bytes the European Data Format fixes at the front of every file,
 * asked of `domain/shared/fileSignature.ts` and re-exported under the name this
 * stream's callers already use — the shape round 31 gave the PDF's five.
 */
export { bytesAreAnEdf } from '../shared/fileSignature';

/** The media types an export may be declared as, and no others. */
export const ASSESSMENT_FILE_MIME_TYPES = ['application/pdf', 'application/octet-stream'] as const;
export type AssessmentFileMimeType = (typeof ASSESSMENT_FILE_MIME_TYPES)[number];

export function isAssessmentFileMimeType(value: string): value is AssessmentFileMimeType {
  return (ASSESSMENT_FILE_MIME_TYPES as readonly string[]).includes(value);
}

/**
 * The type a report is declared as. Kept as a name of its own because the
 * console's `accept` attribute and a report's `document` row both want the PDF
 * specifically.
 */
export const ASSESSMENT_FILE_MIME_TYPE: AssessmentFileMimeType = 'application/pdf';

/** The type both recordings are declared as: bytes, with no registered type. */
export const RECORDING_MIME_TYPE: AssessmentFileMimeType = 'application/octet-stream';

/** What a recording the amplifier's own software wrote is chosen under. */
export const NATIVE_RECORDING_EXTENSION = 'eeg';

/** What the practice's interchange-format recordings are chosen under. */
export const EDF_RECORDING_EXTENSION = 'edf';

/** The three sorts of file an assessment may hold. */
export const ASSESSMENT_FILE_KINDS = ['vendor_pdf', 'edf_recording', 'native_recording'] as const;
export type AssessmentFileKind = (typeof ASSESSMENT_FILE_KINDS)[number];

export type FileRefusalReason = 'unsupported_media_type' | 'not_a_pdf' | 'not_a_recording';

export type FileClassification =
  { ok: true; kind: AssessmentFileKind } | { ok: false; reason: FileRefusalReason };

/** Whether these bytes begin as a PDF does. The shared check's own answer. */
export function bytesAreAPdf(bytes: Uint8Array): boolean {
  return bytesMatchMimeType(bytes, ASSESSMENT_FILE_MIME_TYPE);
}

/**
 * The bytes a parser steps over before it reads anything: tab, line feed, form
 * feed, carriage return and space.
 */
const LEADING_WHITESPACE: readonly number[] = [0x09, 0x0a, 0x0c, 0x0d, 0x20];

/**
 * `<`: the one opening byte a browser could ever be talked into rendering.
 *
 * Read past whatever a browser itself reads past, which is a UTF-8 byte-order
 * mark and then any run of whitespace. A newline in front of `<` is still a
 * page, and a fence that looked only at byte zero would have called it a
 * recording — the file would then be filed as `application/octet-stream`, which
 * is why this was hardening rather than a hole, but the fence should hold on
 * its own terms.
 */
function beginsAsMarkup(bytes: Uint8Array): boolean {
  let at = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  while (at < bytes.length && LEADING_WHITESPACE.includes(bytes[at]!)) at += 1;
  return bytes[at] === 0x3c;
}

/** Whether these bytes are one of the four types the platform already knows. */
function isSomethingElseKnown(bytes: Uint8Array): boolean {
  return KNOWN_MIME_TYPES.some((type) => bytesMatchMimeType(bytes, type));
}

/**
 * The extension a chooser sent, or nothing.
 *
 * Lower-cased, with a single leading dot allowed and taken off. Anything empty,
 * anything with a dot or a separator left in it, and anything longer than an
 * extension is refused rather than trimmed down to its tail: a caller sending a
 * whole file name has sent a person's name, and the answer to that is to take
 * none of it.
 */
export function normaliseExtension(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  const bare = trimmed.startsWith('.') ? trimmed.slice(1) : trimmed;
  if (bare === '' || bare.length > 16) return null;
  if (!/^[a-z0-9]+$/.test(bare)) return null;
  return bare;
}

/**
 * Which of the three kinds these bytes are, or why they are none of them.
 *
 * The declared media type narrows the question and the bytes answer it. A
 * recording's signature outranks the extension it arrived under, because the
 * signature is evidence and a name is not.
 */
export function classifyAssessmentFile(input: {
  declaredMimeType: string;
  bytes: Uint8Array;
  extension: string | null;
}): FileClassification {
  const { declaredMimeType, bytes, extension } = input;
  if (declaredMimeType === ASSESSMENT_FILE_MIME_TYPE) {
    return bytesAreAPdf(bytes)
      ? { ok: true, kind: 'vendor_pdf' }
      : { ok: false, reason: 'not_a_pdf' };
  }
  if (declaredMimeType === RECORDING_MIME_TYPE) {
    if (bytesAreAnEdf(bytes)) return { ok: true, kind: 'edf_recording' };
    if (
      extension === NATIVE_RECORDING_EXTENSION &&
      bytes.length > 0 &&
      !beginsAsMarkup(bytes) &&
      !isSomethingElseKnown(bytes)
    ) {
      return { ok: true, kind: 'native_recording' };
    }
    return { ok: false, reason: 'not_a_recording' };
  }
  return { ok: false, reason: 'unsupported_media_type' };
}
