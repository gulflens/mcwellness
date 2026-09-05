import { describe, expect, it } from 'vitest';
import { canDeliver, type DeliverableContact, type ParticipationConsent } from './canDeliver';

/**
 * Rule 4b (docs/SPEC/reports-v1.md sections 7.2, 8 and 11): the two gates and
 * the WhatsApp opt-in on top, every branch.
 *
 * The telephone is in the reserved fixture block and the address is at
 * example.com (.claude/rules/testing.md).
 */

const TODAY = '2026-09-06';

function consent(over: Partial<ParticipationConsent> = {}): ParticipationConsent {
  return { status: 'active', expiresOn: null, ...over };
}

function contact(over: Partial<DeliverableContact> = {}): DeliverableContact {
  return {
    canReceiveReports: true,
    whatsappOptIn: true,
    phone: '+971500000012',
    email: 'contact@example.com',
    ...over,
  };
}

const issued = { status: 'issued' as const };

describe('canDeliver', () => {
  it('admits an issued report to a consenting contact who receives reports', () => {
    expect(
      canDeliver({
        report: issued,
        consent: consent(),
        contact: contact(),
        channel: 'email',
        today: TODAY,
      }),
    ).toEqual({ ok: true });
  });

  it('admits a superseded version, because a household may be sent the correction of one', () => {
    expect(
      canDeliver({
        report: { status: 'superseded' },
        consent: consent(),
        contact: contact(),
        channel: 'email',
        today: TODAY,
      }),
    ).toEqual({ ok: true });
  });

  it('refuses a draft: nothing unsigned goes out under the practice’s name', () => {
    expect(
      canDeliver({
        report: { status: 'draft' },
        consent: consent(),
        contact: contact(),
        channel: 'email',
        today: TODAY,
      }),
    ).toEqual({ ok: false, code: 'not_issued' });
  });

  it('refuses when the client has no participation consent at all', () => {
    expect(
      canDeliver({
        report: issued,
        consent: null,
        contact: contact(),
        channel: 'email',
        today: TODAY,
      }),
    ).toEqual({ ok: false, code: 'no_consent' });
  });

  it('refuses a withdrawn consent, and an expired one, and a superseded one', () => {
    for (const status of ['withdrawn', 'expired', 'superseded'] as const) {
      expect(
        canDeliver({
          report: issued,
          consent: consent({ status }),
          contact: contact(),
          channel: 'email',
          today: TODAY,
        }),
      ).toEqual({ ok: false, code: 'no_consent' });
    }
  });

  it('refuses a consent that ran out yesterday and admits one that ends today', () => {
    expect(
      canDeliver({
        report: issued,
        consent: consent({ expiresOn: '2026-09-05' }),
        contact: contact(),
        channel: 'email',
        today: TODAY,
      }),
    ).toEqual({ ok: false, code: 'no_consent' });
    expect(
      canDeliver({
        report: issued,
        consent: consent({ expiresOn: TODAY }),
        contact: contact(),
        channel: 'email',
        today: TODAY,
      }),
    ).toEqual({ ok: true });
  });

  it('refuses a contact whose record says they do not receive reports', () => {
    expect(
      canDeliver({
        report: issued,
        consent: consent(),
        contact: contact({ canReceiveReports: false }),
        channel: 'email',
        today: TODAY,
      }),
    ).toEqual({ ok: false, code: 'contact_may_not_receive' });
  });

  it('refuses WhatsApp without the opt-in, even where the number is on file', () => {
    expect(
      canDeliver({
        report: issued,
        consent: consent(),
        contact: contact({ whatsappOptIn: false }),
        channel: 'whatsapp',
        today: TODAY,
      }),
    ).toEqual({ ok: false, code: 'no_whatsapp_opt_in' });
  });

  it('refuses WhatsApp with the opt-in but no number', () => {
    expect(
      canDeliver({
        report: issued,
        consent: consent(),
        contact: contact({ phone: null }),
        channel: 'whatsapp',
        today: TODAY,
      }),
    ).toEqual({ ok: false, code: 'no_usable_number' });
  });

  it('refuses email with no address, and does not mind a missing address on WhatsApp', () => {
    expect(
      canDeliver({
        report: issued,
        consent: consent(),
        contact: contact({ email: null }),
        channel: 'email',
        today: TODAY,
      }),
    ).toEqual({ ok: false, code: 'no_email' });
    expect(
      canDeliver({
        report: issued,
        consent: consent(),
        contact: contact({ email: null }),
        channel: 'whatsapp',
        today: TODAY,
      }),
    ).toEqual({ ok: true });
  });

  it('asks the consent before the contact’s own flag', () => {
    // Order matters for the sentence a person reads: a household that has
    // withdrawn consent is told that, not that a contact may not receive one.
    expect(
      canDeliver({
        report: issued,
        consent: consent({ status: 'withdrawn' }),
        contact: contact({ canReceiveReports: false }),
        channel: 'email',
        today: TODAY,
      }),
    ).toEqual({ ok: false, code: 'no_consent' });
  });
});
