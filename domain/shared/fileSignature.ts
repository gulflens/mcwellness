/**
 * What the first bytes of a file say it is, checked against what the caller
 * says it is.
 *
 * A route that files whatever bytes it is handed under whatever media type it
 * is told is a route that will one day hold an HTML page called `image/png`,
 * and a signed link to it is a link a browser may render. The store's own
 * answers narrow that — the folder implementation serves everything as
 * `application/octet-stream` with `content-disposition: attachment` — but the
 * bucket serves the type the row records, so the check belongs where the row
 * is written.
 *
 * Deliberately small: four magic numbers, one question, no parsing. It says
 * whether the bytes are consistent with the declared type, never what the
 * file contains. `bytesAreAnEdf` sits beside them and asks the same sort of
 * question of a format that has no registered media type to key it on.
 *
 * **Why it is here rather than in `domain/client`, where it was written.**
 * Three streams reached the same wall: a route that writes a `document` row
 * has to ask this question, and `docs/SPEC/OWNERSHIP.md` rule 3 forbids one
 * module importing another module's `domain/`. The session capture and
 * scheduling streams wrote the note; the assessment stream wrote its own
 * five-byte copy for one media type and asked for the move (request 1 of
 * docs/CHANGE-REQUESTS/assessment-01.md). This is the answer: the question
 * belongs to nobody in particular, so it lives where everybody may read it —
 * the same move `formatFils` made, for the same reason.
 *
 * `domain/client` re-exports it, so no caller had to move with it.
 */

/** The media types this platform will hold as evidence or as a filed document. */
export const KNOWN_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
] as const;
export type KnownMimeType = (typeof KNOWN_MIME_TYPES)[number];

export function isKnownMimeType(value: string): value is KnownMimeType {
  return (KNOWN_MIME_TYPES as readonly string[]).includes(value);
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

/** `RIFF....WEBP`: the four-byte size between the two words is the file's own. */
function isWebp(bytes: Uint8Array): boolean {
  return (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes.length >= 12 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}

/**
 * Whether `bytes` are consistent with `mimeType`. False for an unknown type,
 * so a caller cannot get past this by naming something it does not check.
 */
export function bytesMatchMimeType(bytes: Uint8Array, mimeType: string): boolean {
  switch (mimeType) {
    case 'image/png':
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/jpeg':
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case 'image/webp':
      return isWebp(bytes);
    case 'application/pdf':
      return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    default:
      return false;
  }
}

/**
 * The eight bytes the European Data Format fixes at the front of every file:
 * the version field, an ASCII `0` followed by seven spaces. Its `+` variant
 * begins with the same eight, so this accepts both.
 *
 * **A named export rather than a fifth case in the switch.** EDF has no
 * registered media type to key one on, so `KNOWN_MIME_TYPES` stays at four and
 * `bytesMatchMimeType` is untouched: a caller filing a recording declares it
 * `application/octet-stream` and asks this question separately. The shape was
 * the trunk's to choose (request 2 of `docs/CHANGE-REQUESTS/assessment-02.md`).
 *
 * **This module never reads the next field.** After the version comes an
 * eighty-byte identification field naming the person the recording was made
 * of. Nothing here reaches past byte eight, and nothing in this repository
 * parses a recording at all (`docs/SPEC/assessment.md` section 7.1): a
 * recording is filed exactly as the practice sent it.
 */
export function bytesAreAnEdf(bytes: Uint8Array): boolean {
  return startsWith(bytes, [0x30, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20, 0x20]);
}
