import { describe, expect, it } from 'vitest';
import { leadFromEnquiry, parseEnquiry, toE164 } from './parse';

/** What the website's widget sends, as the door receives it. */
function form(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Hazel Harbour',
    country_code: '+971',
    phone: '50 000 0099',
    email: 'hazel@example.com',
    area: 'Jumeirah',
    message: 'I want to know more',
    consent: 'on',
    source: 'website',
    ...overrides,
  };
}

describe('toE164', () => {
  it('believes an explicit plus as given, whatever the picker shows', () => {
    expect(toE164('+44', '+971 50 000 0099')).toBe('+971500000099');
  });

  it('prepends the country code and drops a trunk zero', () => {
    expect(toE164('+971', '050 000 0099')).toBe('+971500000099');
  });

  it('does not double a country code somebody typed without the plus', () => {
    expect(toE164('+971', '971500000099')).toBe('+971500000099');
  });

  it('leaves a short local number alone even when it starts with the code digits', () => {
    // Guarded on length: a local number that happens to begin 971 is not the
    // country code and must not be truncated into nonsense.
    expect(toE164('+971', '9715')).toBe('+9719715');
  });

  it('answers empty for nothing at all', () => {
    expect(toE164('+971', '   ')).toBe('');
    expect(toE164('+971', '+')).toBe('');
  });

  it('answers empty for what no client record could hold, so the door says incomplete', () => {
    // The contact table's own check (060): a plus, 7 to 15 digits, no leading zero.
    expect(toE164('+971', '0')).toBe('');
    expect(toE164('+44', '+0 123 456')).toBe('');
    expect(toE164('+971', '5'.repeat(30))).toBe('');
    expect(toE164('+971', '50 000 0099')).toBe('+971500000099');
  });
});

describe('parseEnquiry', () => {
  it('reads a complete widget submission', () => {
    const result = parseEnquiry(form());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.enquiry).toEqual({
      name: 'Hazel Harbour',
      whatsappE164: '+971500000099',
      email: 'hazel@example.com',
      area: 'Jumeirah',
      message: 'I want to know more',
      concern: null,
      preferredTime: null,
      contactMethod: null,
      consent: true,
      source: 'website',
    });
  });

  it('answers as if accepted when the honeypot is filled, and keeps nothing', () => {
    // A script that fills every input fills this one; a person never sees it.
    for (const bot of [{ botcheck: 'on' }, { botcheck: true }, { website: 'http://x' }]) {
      const result = parseEnquiry(form(bot));
      expect(result).toEqual({ ok: false, reason: 'honeypot' });
    }
  });

  it('keeps an address only when it reads as one', () => {
    const bad = parseEnquiry(form({ email: 'not an address' }));
    expect(bad.ok && bad.enquiry.email).toBe(null);
    const good = parseEnquiry(form({ email: 'hazel@example.com' }));
    expect(good.ok && good.enquiry.email).toBe('hazel@example.com');
  });

  it('requires a name and a way to reply, and nothing else', () => {
    expect(parseEnquiry(form({ name: '' }))).toEqual({ ok: false, reason: 'incomplete' });
    expect(parseEnquiry(form({ phone: '' }))).toEqual({ ok: false, reason: 'incomplete' });
    const bare = parseEnquiry(form({ email: '', area: '', message: '' }));
    expect(bare.ok).toBe(true);
    if (bare.ok)
      expect([bare.enquiry.email, bare.enquiry.area, bare.enquiry.message]).toEqual([
        null,
        null,
        null,
      ]);
  });

  it('records consent as three values: ticked, untouched, refused', () => {
    const ticked = parseEnquiry(form({ consent: 'on' }));
    const untouched = parseEnquiry(form({ consent: undefined }));
    const blank = parseEnquiry(form({ consent: '' }));
    const refused = parseEnquiry(form({ consent: 'no' }));
    expect(ticked.ok && ticked.enquiry.consent).toBe(true);
    expect(untouched.ok && untouched.enquiry.consent).toBe(null);
    expect(blank.ok && blank.enquiry.consent).toBe(null);
    expect(refused.ok && refused.enquiry.consent).toBe(false);
  });

  it('caps every field so the table cannot be used as free storage', () => {
    const result = parseEnquiry(form({ message: 'x'.repeat(5000), name: 'y'.repeat(500) }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.enquiry.message?.length).toBe(2000);
    expect(result.enquiry.name.length).toBe(120);
  });

  it('carries the discovery-call form’s three answers when they are sent', () => {
    const result = parseEnquiry(
      form({
        source: 'discovery_call',
        concern: 'sleep',
        preferred_time: 'evenings',
        contact_method: 'whatsapp',
      }),
    );
    expect(result.ok && result.enquiry.source).toBe('discovery_call');
    expect(result.ok && result.enquiry.concern).toBe('sleep');
    expect(result.ok && result.enquiry.preferredTime).toBe('evenings');
    expect(result.ok && result.enquiry.contactMethod).toBe('whatsapp');
  });

  it('falls back to the website as the source when none is named', () => {
    const result = parseEnquiry(form({ source: undefined }));
    expect(result.ok && result.enquiry.source).toBe('website');
  });
});

describe('leadFromEnquiry', () => {
  it('splits the name at the first space and makes the person their own contact', () => {
    const parsed = parseEnquiry(form({ name: 'Hazel Fern Harbour' }));
    if (!parsed.ok) throw new Error('fixture');
    expect(leadFromEnquiry(parsed.enquiry)).toEqual({
      givenName: 'Hazel',
      familyName: 'Fern Harbour',
      referralSource: 'website',
      contact: {
        relationship: 'self',
        phone: '+971500000099',
        email: 'hazel@example.com',
        isLegalGuardian: false,
        canConsent: false,
        canReceiveReports: true,
        canPay: false,
      },
    });
  });

  it('records a single name as both, rather than inventing a second', () => {
    const parsed = parseEnquiry(form({ name: 'Hazel', email: '' }));
    if (!parsed.ok) throw new Error('fixture');
    const lead = leadFromEnquiry(parsed.enquiry);
    expect([lead.givenName, lead.familyName]).toEqual(['Hazel', 'Hazel']);
    expect(lead.contact.email).toBeUndefined();
  });
});
