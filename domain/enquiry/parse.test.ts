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
      enquiringFor: null,
      interest: null,
      // A form that does not say which wording it showed showed the earlier one.
      noticeVersion: 1,
      marketingOptIn: null,
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
    expect(parseEnquiry(form({ name: '' }))).toEqual({
      ok: false,
      reason: 'incomplete',
      missing: ['name'],
    });
    expect(parseEnquiry(form({ phone: '' }))).toEqual({
      ok: false,
      reason: 'incomplete',
      missing: ['phone'],
    });
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

  it('reads which wording the form showed, and the news tick only under the second', () => {
    const read = (fields: Record<string, unknown>) => {
      const result = parseEnquiry(form(fields));
      return result.ok ? result.enquiry : null;
    };
    // The second wording, and its optional tick given, not given, and left alone.
    expect(read({ notice: '2', marketing: 'on' })).toMatchObject({
      noticeVersion: 2,
      marketingOptIn: true,
    });
    expect(read({ notice: '2', marketing: '' })).toMatchObject({
      noticeVersion: 2,
      marketingOptIn: false,
    });
    expect(read({ notice: 2 })).toMatchObject({ noticeVersion: 2, marketingOptIn: false });
    // The earlier wording had no such tick: a value that arrives under it answers nothing.
    expect(read({ marketing: 'on' })).toMatchObject({ noticeVersion: 1, marketingOptIn: null });
    expect(read({ notice: '3', marketing: 'on' })).toMatchObject({
      noticeVersion: 1,
      marketingOptIn: null,
    });
  });

  it('falls back to the website as the source when none is named', () => {
    const result = parseEnquiry(form({ source: undefined }));
    expect(result.ok && result.enquiry.source).toBe('website');
  });
});

/** What the expo form on the app itself sends: a plus-prefixed number, no country code. */
function expo(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source: 'expo',
    name: 'Rowan Meadow',
    phone: '+971500000098',
    email: '',
    area: 'Mirdif',
    enquiring_for: 'child',
    interest: 'both',
    message: 'Saw the stand, would like to know about home visits',
    consent: 'on',
    website: '',
    ...overrides,
  };
}

describe('parseEnquiry, the expo form', () => {
  it('reads a complete expo submission with who it is for and what they are interested in', () => {
    const result = parseEnquiry(expo());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.enquiry).toEqual({
      name: 'Rowan Meadow',
      whatsappE164: '+971500000098',
      email: null,
      area: 'Mirdif',
      message: 'Saw the stand, would like to know about home visits',
      concern: null,
      preferredTime: null,
      contactMethod: null,
      consent: true,
      source: 'expo',
      enquiringFor: 'child',
      interest: 'both',
      noticeVersion: 1,
      marketingOptIn: null,
    });
  });

  it('refuses an expo submission that does not say who or what, and names what is missing', () => {
    expect(parseEnquiry(expo({ enquiring_for: '' }))).toEqual({
      ok: false,
      reason: 'incomplete',
      missing: ['enquiring_for'],
    });
    expect(parseEnquiry(expo({ interest: undefined }))).toEqual({
      ok: false,
      reason: 'incomplete',
      missing: ['interest'],
    });
    // Everything at once, in the form's own order, so a page can mark each field.
    expect(parseEnquiry(expo({ name: '', phone: '', enquiring_for: '', interest: '' }))).toEqual({
      ok: false,
      reason: 'incomplete',
      missing: ['name', 'phone', 'enquiring_for', 'interest'],
    });
  });

  it('treats a value outside the fixed lists as not answered', () => {
    // Not stored as free text, and for the expo that is an unanswered question.
    expect(parseEnquiry(expo({ enquiring_for: 'my dog' }))).toEqual({
      ok: false,
      reason: 'incomplete',
      missing: ['enquiring_for'],
    });
    const other = parseEnquiry(expo({ interest: '<script>' }));
    expect(other).toEqual({ ok: false, reason: 'incomplete', missing: ['interest'] });
  });

  it("leaves the website's forms free of the expo's two questions", () => {
    // Absent is fine for the website, and a value sent anyway is not kept:
    // the website's forms do not ask, so it is not an answer to anything.
    const plain = parseEnquiry(form());
    expect(plain.ok && [plain.enquiry.enquiringFor, plain.enquiry.interest]).toEqual([null, null]);
    const answered = parseEnquiry(form({ interest: 'neurofeedback', enquiring_for: 'self' }));
    expect(answered.ok && [answered.enquiry.enquiringFor, answered.enquiry.interest]).toEqual([
      null,
      null,
    ]);
  });

  it("makes an expo enquiry's lead say it came from the expo", () => {
    const parsed = parseEnquiry(expo());
    if (!parsed.ok) throw new Error('fixture');
    const lead = leadFromEnquiry(parsed.enquiry);
    expect(lead.referralSource).toBe('expo');
    expect(lead.contact.phone).toBe('+971500000098');
    expect(lead.contact.email).toBeUndefined();
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
