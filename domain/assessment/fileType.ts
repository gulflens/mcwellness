/**
 * What an export's first bytes say it is, checked against what the caller says
 * it is (docs/SPEC/assessment.md section 10, decision 3).
 *
 * A route that files whatever bytes it is handed under whatever media type it
 * is told is a route that will one day hold an HTML page called a report, and
 * a signed link to it is a link a browser may render. The store's own answers
 * narrow that — the folder implementation serves everything as an attachment —
 * but the bucket serves the type the row records, so the check belongs where
 * the row is written.
 *
 * **One type**, and deliberately: `application/pdf` alone until the operator
 * names the practice's equipment and its export. A second type is one more
 * signature here and a line in the change request, not a guess made now.
 *
 * **Why this is not `domain/client/fileSignature.ts`.** It is the same
 * question and very nearly the same four bytes, and that file is where it
 * ought to live for everybody — but `docs/SPEC/OWNERSHIP.md` rule 3 forbids
 * one module importing another module's `domain/`, and the two streams before
 * this one made the same note rather than the same import
 * (app/api/sessions/photo.ts, app/api/appointments/create.ts). So the request
 * to move `bytesMatchMimeType` into `domain/shared`, where every stream may
 * read it, is written in `docs/CHANGE-REQUESTS/assessment-01.md` and this
 * stands until the trunk answers it.
 */

/** The one media type an assessment export may be filed as. */
export const ASSESSMENT_FILE_MIME_TYPE = 'application/pdf';

/** `%PDF-`, the five bytes every PDF begins with. */
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d] as const;

export function bytesAreAPdf(bytes: Uint8Array): boolean {
  if (bytes.length < PDF_SIGNATURE.length) return false;
  return PDF_SIGNATURE.every((byte, index) => bytes[index] === byte);
}
