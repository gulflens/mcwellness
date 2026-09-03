/**
 * Sending a money document to the family it belongs to.
 *
 * Two ways, one seam. Both are pure here: this file composes the message and
 * the hand-off link and decides nothing about the network
 * (`app/api/billing/sending.ts` holds the implementations, CLAUDE.md's seam
 * rule and docs/SEAMS.md).
 *
 * **WhatsApp is a hand-off, not an integration.** The practice already talks to
 * families on WhatsApp, and the WhatsApp Business API is not an approved vendor
 * (`docs/COMPLIANCE/approved-vendors.md`) and does not need to be for this: the
 * platform composes a `wa.me` link carrying a drafted bilingual message, the
 * person opens it, and they press send in their own WhatsApp. Nothing leaves
 * this system on our account and Meta receives nothing from this server. If the
 * Business API is ever approved it is a second implementation behind this same
 * seam, not a rewrite.
 *
 * **Email is a seam with nothing real behind it yet.** No email vendor is
 * approved either, so `sendDocument` ships with a fallback that composes the
 * message and hands the link back for the share sheet, and a real
 * implementation that is only reachable once somebody sets the environment
 * variable that names a configured vendor. Until a vendor is on the approved
 * list, the fallback is the whole of the behaviour and a test proves the
 * platform is fully usable that way.
 *
 * **What travels, and what does not.** A message names the document by its
 * reference — "INV-000001" — and never by an id from a URL, and the link it
 * carries is a short-lived signed one (docs/SEAMS.md). Nothing in the message
 * says what the visit was for.
 */

/** Which door a document goes out of. */
export const SEND_CHANNELS = ['whatsapp', 'email'] as const;
export type SendChannel = (typeof SEND_CHANNELS)[number];

/** Enough about a document to write a sentence about it. */
export type Sendable = {
  kind: 'invoice' | 'receipt';
  /** "INV-000001" or "RCP-000004". */
  reference: string;
  /** The practice's own name, as the document itself carries it. */
  practiceName: string;
  /** A short-lived signed link to the bytes. */
  url: string;
};

export type DraftedMessage = {
  /** English first, Arabic beneath: the practice writes to families in both. */
  text: string;
  subject: string;
};

/**
 * The message that goes with a document, in both languages.
 *
 * Deliberately plain and deliberately short. It says what the document is, who
 * it is from and where to open it, and it asks for nothing: no reply, no
 * confirmation, no prompt to come back. A family who owes nothing should be
 * able to read it and put their phone down.
 */
export function draftMessage(document_: Sendable): DraftedMessage {
  const isInvoice = document_.kind === 'invoice';
  const subject = isInvoice
    ? `${document_.practiceName} — invoice ${document_.reference}`
    : `${document_.practiceName} — receipt ${document_.reference}`;

  const english = isInvoice
    ? `Your invoice ${document_.reference} from ${document_.practiceName} is ready. ` +
      `You can open it here: ${document_.url}`
    : `Your receipt ${document_.reference} from ${document_.practiceName} is ready. ` +
      `You can open it here: ${document_.url}`;

  const arabic = isInvoice
    ? `فاتورتك ${document_.reference} من ${document_.practiceName} جاهزة. يمكنك فتحها هنا: ${document_.url}`
    : `إيصالك ${document_.reference} من ${document_.practiceName} جاهز. يمكنك فتحه هنا: ${document_.url}`;

  return { subject, text: `${english}\n\n${arabic}` };
}

/**
 * The `wa.me` hand-off: a link that opens WhatsApp with the message already
 * written, addressed to that number.
 *
 * The number is E.164 in the record (`contact.phone`) and `wa.me` wants the
 * digits alone, so the plus goes. Nothing else about it is changed: a number
 * that is not E.164 is refused rather than repaired, because a repaired
 * telephone number is a message sent to somebody else.
 */
export function whatsAppHandoff(phoneE164: string, message: DraftedMessage): string | null {
  if (!/^\+[1-9][0-9]{6,14}$/.test(phoneE164)) {
    return null;
  }
  return `https://wa.me/${phoneE164.slice(1)}?text=${encodeURIComponent(message.text)}`;
}

/** What a real email implementation is handed. The address never reaches the trail. */
export type EmailDelivery = {
  to: string;
  message: DraftedMessage;
};

/** What a send answered: it went, or here is the link to share by hand. */
export type SendOutcome =
  | { delivered: true; channel: SendChannel }
  | { delivered: false; channel: SendChannel; handoffUrl: string };

/**
 * The seam. One method, two implementations
 * (`app/api/billing/sending.ts`): a real one behind an environment setting, and
 * a fallback that composes the message and hands the link back so a person can
 * send it themselves.
 */
export type DocumentSender = {
  /** How this implementation would describe itself in a startup log. Never a credential. */
  readonly name: string;
  sendDocument(delivery: EmailDelivery): Promise<SendOutcome>;
};
