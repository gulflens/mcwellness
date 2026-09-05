import type { DocumentSender } from '../../../../domain/shared/sending';
import { shareSheetSender } from './share-sheet';

export { shareSheetSender } from './share-sheet';

/** Vendors this platform knows how to reach. None is approved yet, so none is here. */
const KNOWN_VENDORS: readonly string[] = [];

/**
 * Which implementation of the sending seam this deployment runs
 * (docs/SEAMS.md, `domain/shared/sending.ts`).
 *
 * **The real one is unreachable until a vendor exists.**
 * `DOCUMENT_EMAIL_VENDOR` names it; nothing names one today, and choosing a
 * name this platform has no implementation for is refused at startup rather
 * than on the first send weeks later, to a family that never got it. When a
 * vendor is approved in `docs/COMPLIANCE/approved-vendors.md`, its transport
 * becomes a file beside `share-sheet.ts` and this is the only other place that
 * changes.
 *
 * Chosen in the shape the storage and routing seams are chosen in
 * (`../storage/index.ts`, `../routing/index.ts`): the fallback when nothing
 * names a vendor, and a refusal rather than a silent wrong answer when
 * something names one that does not exist. It differs from those two in one
 * way, deliberately: an unset variable is the fallback everywhere and not only
 * on a laptop, because there is no second implementation for a deployment to
 * have meant instead.
 *
 * Nothing reaches the network at construction time.
 */
export function documentSender(
  env: Record<string, string | undefined> = process.env,
): DocumentSender {
  const named = env.DOCUMENT_EMAIL_VENDOR?.trim();
  if (!named) {
    return shareSheetSender();
  }
  if (!KNOWN_VENDORS.includes(named)) {
    throw new Error(
      `DOCUMENT_EMAIL_VENDOR names "${named}", which this platform has no implementation for. ` +
        'An email vendor is approved in docs/COMPLIANCE/approved-vendors.md before it exists here.',
    );
  }
  // Unreachable while KNOWN_VENDORS is empty, and deliberately so: the branch
  // exists so the seam has two sides, and the day a vendor is approved this is
  // the only place that changes.
  throw new Error(`No transport is built for "${named}" yet.`);
}
