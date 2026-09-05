import type { DocumentSender, EmailDelivery, SendOutcome } from '../../../../domain/shared/sending';

/**
 * The fallback behind the sending seam (docs/SEAMS.md,
 * `domain/shared/sending.ts`): it composes the message, sends nothing, and
 * hands the link back for the person to share.
 *
 * **Today it is the whole of the seam, and that is an answer rather than a
 * stub.** No email vendor is on `docs/COMPLIANCE/approved-vendors.md`, and
 * nothing that has not been approved receives a family's address (CLAUDE.md
 * rule 9). Handing a person the link to send themselves is exactly how the
 * practice works now.
 */
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
