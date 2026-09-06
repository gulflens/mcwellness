import type { ReportStatus } from './types';

/**
 * Rule 4b (docs/SPEC/reports-v1.md section 7.2): who may be sent a report.
 *
 * **Two gates that already exist, checked at the moment of sending and never
 * cached** (CLAUDE.md compliance rule on consent): the client's `participation`
 * consent must be active, and the contact's own `can_receive_reports` must be
 * true — the flag the portal's Family screen already shows in words. WhatsApp
 * needs `whatsapp_opt_in` on top, exactly as the billing hand-off checks it.
 *
 * **And the report must be one there is something to send.** A draft has no
 * document and no reference; sending one would put an unsigned page in front
 * of a household under the practice's name.
 *
 * Pure: the consent, the contact, the channel and the moment come in; an
 * answer goes out. The route reads all three fresh in the sending transaction
 * and asks this; the row policies refuse the delivery underneath.
 */

export type DeliverRefusalCode =
  | 'not_issued'
  | 'no_consent'
  | 'contact_may_not_receive'
  | 'no_whatsapp_opt_in'
  | 'no_usable_number'
  | 'no_email';

export type DeliverAnswer = { ok: true } | { ok: false; code: DeliverRefusalCode };

export const DELIVERY_CHANNELS = ['whatsapp', 'email'] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

/** The client's participation consent, as much of it as this question needs. */
export type ParticipationConsent = {
  status: 'active' | 'withdrawn' | 'expired' | 'superseded';
  /** When it stops standing, where it has an end. */
  expiresOn: string | null;
};

/** The contact a report would go to. */
export type DeliverableContact = {
  canReceiveReports: boolean;
  whatsappOptIn: boolean;
  /** E.164 in the record, or none. */
  phone: string | null;
  email: string | null;
};

export function canDeliver(input: {
  report: { status: ReportStatus };
  consent: ParticipationConsent | null;
  contact: DeliverableContact;
  channel: DeliveryChannel;
  /** The practice's own today, as YYYY-MM-DD. */
  today: string;
}): DeliverAnswer {
  if (input.report.status === 'draft') {
    return { ok: false, code: 'not_issued' };
  }

  // A consent that is not active, or has run out on the day of sending, is no
  // consent. Asked here rather than trusted from a cached boolean, which is
  // what CLAUDE.md's compliance rule forbids.
  const consent = input.consent;
  if (
    consent === null ||
    consent.status !== 'active' ||
    (consent.expiresOn !== null && consent.expiresOn < input.today)
  ) {
    return { ok: false, code: 'no_consent' };
  }

  if (!input.contact.canReceiveReports) {
    return { ok: false, code: 'contact_may_not_receive' };
  }

  if (input.channel === 'whatsapp') {
    // The household said no to WhatsApp. That answer is the whole point of the
    // column and it is not the sender's to overrule.
    if (!input.contact.whatsappOptIn) {
      return { ok: false, code: 'no_whatsapp_opt_in' };
    }
    if (input.contact.phone === null || input.contact.phone.length === 0) {
      return { ok: false, code: 'no_usable_number' };
    }
    return { ok: true };
  }

  if (input.contact.email === null || input.contact.email.length === 0) {
    return { ok: false, code: 'no_email' };
  }
  return { ok: true };
}
