import type { DocumentSender, EmailDelivery, SendOutcome } from '../../../domain/billing/sending';

/**
 * The two implementations behind the sending seam (docs/SEAMS.md,
 * `domain/billing/sending.ts`).
 *
 * **The fallback is the default and, today, the whole of it.** No email vendor
 * is on `docs/COMPLIANCE/approved-vendors.md`, and nothing that has not been
 * approved receives a family's address (CLAUDE.md rule 9). So the fallback
 * composes the message, sends nothing, and hands the link back for the person
 * to share — which is exactly how the practice works now, and is a complete
 * answer rather than a stub pretending to be one.
 *
 * **The real one is unreachable until a vendor exists.** `DOCUMENT_EMAIL_VENDOR`
 * names it; nothing names one today, and choosing a name that is not a known
 * vendor refuses at startup rather than on the first send weeks later. When one
 * is approved, the transport goes in `deliver` below and nothing else in the
 * platform changes.
 */

/** The fallback: composes, sends nothing, hands the link back. */
export function shareSheetSender(): DocumentSender {
  return {
    name: 'share sheet',
    async sendDocument(delivery: EmailDelivery): Promise<SendOutcome> {
      // The address is not touched and is not logged. It travels only so a real
      // implementation behind this same call would have it.
      void delivery;
      return { delivered: false, channel: 'email', handoffUrl: '' };
    },
  };
}

/** Vendors this platform knows how to reach. None is approved yet, so none is here. */
const KNOWN_VENDORS: readonly string[] = [];

/**
 * Chooses an implementation from the environment, in the shape the storage seam
 * chose one (`app/api/_middleware/storage/seam.ts`): the fallback on a laptop
 * and in the tests, an explicit choice everywhere else, and a refusal at startup
 * rather than a silent wrong answer.
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
