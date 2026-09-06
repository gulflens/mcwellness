import { bytesMatchMimeType } from '../shared/fileSignature';

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
 * line here and a line in the change request, not a guess made now.
 *
 * **The bytes themselves are `domain/shared`'s question now.** This file used
 * to carry its own copy of the five bytes a PDF begins with, because
 * `docs/SPEC/OWNERSHIP.md` rule 3 forbade importing `domain/client`'s. The
 * trunk's round 31 answered request 1 of
 * `docs/CHANGE-REQUESTS/assessment-01.md` and moved the question to
 * `domain/shared/fileSignature.ts`, so what is left here is the practice's own
 * decision — which media type an export may be — and nothing about file
 * formats at all.
 */

/** The one media type an assessment export may be filed as. */
export const ASSESSMENT_FILE_MIME_TYPE = 'application/pdf';

/** Whether these bytes are consistent with the one type an export may be. */
export function bytesAreAPdf(bytes: Uint8Array): boolean {
  return bytesMatchMimeType(bytes, ASSESSMENT_FILE_MIME_TYPE);
}
