import { describe, expect, it } from 'vitest';
import { TESTIMONIAL_LIMITS, carriesContactDetails, parseTestimonial } from './parse';

/** What the website's Testimonials form sends, as the door receives it. Synthetic. */
function form(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    display_name: 'Hazel H.',
    context: 'Parent · Dubai',
    rating: 5,
    body: 'The home visits fitted around our week, and the team explained every step.',
    language: 'en',
    consent_to_publish: true,
    website: '',
    ...overrides,
  };
}

describe('parseTestimonial', () => {
  it('keeps what the form gave, trimmed', () => {
    const parsed = parseTestimonial(form({ display_name: '  Hazel H.  ', context: '  ' }));
    expect(parsed).toEqual({
      ok: true,
      testimonial: {
        displayName: 'Hazel H.',
        context: null,
        rating: 5,
        body: 'The home visits fitted around our week, and the team explained every step.',
        language: 'en',
      },
    });
  });

  it('answers a filled honeypot as a script, whichever of the two names it uses', () => {
    expect(parseTestimonial(form({ website: 'https://spam.example' }))).toEqual({
      ok: false,
      reason: 'honeypot',
    });
    expect(parseTestimonial(form({ botcheck: true }))).toEqual({ ok: false, reason: 'honeypot' });
  });

  it('refuses without a tick to publish: the promise on the page is consent first', () => {
    for (const consent of [undefined, false, 'false', '', null, 'yes please']) {
      const parsed = parseTestimonial(form({ consent_to_publish: consent }));
      expect(parsed, String(consent)).toEqual({
        ok: false,
        reason: 'invalid',
        fields: ['consent_to_publish'],
      });
    }
    // A checkbox posted the classic way says "on"; a script that built JSON says true.
    expect(parseTestimonial(form({ consent_to_publish: 'on' })).ok).toBe(true);
    expect(parseTestimonial(form({ consent_to_publish: 'true' })).ok).toBe(true);
  });

  it('refuses a body too short or too long rather than cutting somebody’s words', () => {
    const short = parseTestimonial(form({ body: 'Very good.' }));
    expect(short).toEqual({ ok: false, reason: 'invalid', fields: ['body'] });
    const long = parseTestimonial(form({ body: 'a'.repeat(TESTIMONIAL_LIMITS.bodyMax + 1) }));
    expect(long).toEqual({ ok: false, reason: 'invalid', fields: ['body'] });
    expect(parseTestimonial(form({ body: 'a'.repeat(TESTIMONIAL_LIMITS.bodyMax) })).ok).toBe(true);
    expect(parseTestimonial(form({ body: 'a'.repeat(TESTIMONIAL_LIMITS.bodyMin) })).ok).toBe(true);
  });

  it('counts characters, not bytes or UTF-16 units, so Arabic and emoji are measured fairly', () => {
    // 1200 Arabic letters are 2400 bytes; they are still 1200 characters.
    const arabic = 'ب'.repeat(TESTIMONIAL_LIMITS.bodyMax);
    expect(parseTestimonial(form({ body: arabic, language: 'ar' })).ok).toBe(true);
    // An emoji outside the basic plane is two UTF-16 units and one character.
    const emoji = '😊'.repeat(TESTIMONIAL_LIMITS.bodyMax);
    expect(parseTestimonial(form({ body: emoji })).ok).toBe(true);
  });

  it('refuses a display name that is missing or too long, and a context over sixty', () => {
    expect(parseTestimonial(form({ display_name: '   ' }))).toEqual({
      ok: false,
      reason: 'invalid',
      fields: ['display_name'],
    });
    expect(
      parseTestimonial(form({ display_name: 'H'.repeat(TESTIMONIAL_LIMITS.displayNameMax + 1) })),
    ).toEqual({ ok: false, reason: 'invalid', fields: ['display_name'] });
    expect(parseTestimonial(form({ context: 'c'.repeat(61) }))).toEqual({
      ok: false,
      reason: 'invalid',
      fields: ['context'],
    });
    expect(parseTestimonial(form({ context: 'c'.repeat(60) })).ok).toBe(true);
  });

  it('takes a whole rating from one to five, as a number or the digit a select posts', () => {
    for (const rating of [1, 5, '3']) {
      expect(parseTestimonial(form({ rating })).ok, String(rating)).toBe(true);
    }
    for (const rating of [0, 6, 4.5, '4.5', '', null, undefined, 'five']) {
      expect(parseTestimonial(form({ rating })), String(rating)).toEqual({
        ok: false,
        reason: 'invalid',
        fields: ['rating'],
      });
    }
  });

  it('takes the language from the page, English or Arabic, and nothing else', () => {
    expect(parseTestimonial(form({ language: 'ar' })).ok).toBe(true);
    for (const language of ['fr', '', undefined, 'EN']) {
      expect(parseTestimonial(form({ language })), String(language)).toEqual({
        ok: false,
        reason: 'invalid',
        fields: ['language'],
      });
    }
  });

  it('refuses a telephone number or an email address anywhere it would be published', () => {
    // Nothing on this table is a way to reach somebody, by design: a review is
    // shown to the world, and a number in it would be published with it.
    expect(
      parseTestimonial(form({ body: 'Lovely team, call me on 050 000 0099 to hear more.' })),
    ).toEqual({ ok: false, reason: 'invalid', fields: ['body'] });
    expect(parseTestimonial(form({ display_name: 'hazel@example.com' }))).toEqual({
      ok: false,
      reason: 'invalid',
      fields: ['display_name'],
    });
    expect(parseTestimonial(form({ context: 'Reach me +971500000099' }))).toEqual({
      ok: false,
      reason: 'invalid',
      fields: ['context'],
    });
  });

  it('names every field that is wrong, in the form’s own order', () => {
    expect(parseTestimonial({})).toEqual({
      ok: false,
      reason: 'invalid',
      fields: ['display_name', 'rating', 'body', 'language', 'consent_to_publish'],
    });
  });
});

describe('control and invisible characters', () => {
  it('takes them out of the name, the line under it and the words, keeping line breaks in the words', () => {
    const parsed = parseTestimonial(
      form({
        display_name: 'Ha\u200bzel\u0007 H.\u202e',
        context: 'Parent,\u00ad Dubai\ufeff',
        body: 'The home visits\u200d fitted our week.\nThe team\u0000 explained every\u2066 step.',
      }),
    );
    expect(parsed).toEqual({
      ok: true,
      testimonial: {
        displayName: 'Hazel H.',
        context: 'Parent, Dubai',
        rating: 5,
        body: 'The home visits fitted our week.\nThe team explained every step.',
        language: 'en',
      },
    });
  });

  it('keeps a name on one line, and a tab as a space', () => {
    const parsed = parseTestimonial(form({ display_name: 'Hazel\nH.', context: 'Parent,\tDubai' }));
    expect(parsed.ok && parsed.testimonial.displayName).toBe('Hazel H.');
    expect(parsed.ok && parsed.testimonial.context).toBe('Parent, Dubai');
  });

  it('refuses a name that is nothing once they are out', () => {
    expect(parseTestimonial(form({ display_name: '\u200b\u200b\u202e' }))).toEqual({
      ok: false,
      reason: 'invalid',
      fields: ['display_name'],
    });
  });

  it('counts the words after they are out, so invisible padding cannot reach the minimum', () => {
    const padded = `${'\u200b'.repeat(30)}Too short.`;
    expect(parseTestimonial(form({ body: padded }))).toMatchObject({
      ok: false,
      fields: ['body'],
    });
  });
});

describe('carriesContactDetails', () => {
  it('finds a number of seven digits or more however it is spaced, and an address', () => {
    expect(carriesContactDetails('+971 50 000 0099')).toBe(true);
    expect(carriesContactDetails('050-000-0099')).toBe(true);
    expect(carriesContactDetails('write to hazel@example.com')).toBe(true);
  });

  it('leaves ordinary counts and years alone', () => {
    expect(carriesContactDetails('After 20 sessions in 2026, my sleep is better.')).toBe(false);
    expect(carriesContactDetails('Ten out of 10')).toBe(false);
  });
});
