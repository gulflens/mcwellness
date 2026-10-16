/**
 * The rules for what the website's Testimonials form sends
 * (docs/SPEC/testimonials.md). Pure: the door in app/api/testimonials applies
 * them, and the table (db/migrations/978_testimonial.sql) holds the same
 * limits again beneath whoever the caller is.
 *
 * **Refused, never cut.** The enquiry door clamps an over-long field and keeps
 * what fits, because an enquiry is a request to be rung and a shortened
 * message still gets a call. A review is somebody's words published under
 * their name: cut at 1200 characters it says something they did not write. So
 * every limit here is a refusal the form can show, and nothing is shortened.
 *
 * **Characters, not bytes.** Every length is counted in Unicode code points,
 * which is what Postgres's `char_length` counts on a UTF-8 database, so the
 * door and the table agree, and an Arabic review is measured as fairly as an
 * English one.
 */

export const TESTIMONIAL_LIMITS = {
  /** "Layla H.", as they want it shown. Long enough for a full name, short enough to sit on a card. */
  displayNameMax: 40,
  /** The optional line beneath the name, such as "HR Director, Dubai". */
  contextMax: 60,
  /** Shorter than this is a rating, not a review, and the page has the stars for that. */
  bodyMin: 20,
  bodyMax: 1200,
} as const;

export const TESTIMONIAL_LANGUAGES = ['en', 'ar'] as const;
export type TestimonialLanguage = (typeof TESTIMONIAL_LANGUAGES)[number];

/** A field the form must correct, by the name the form posts it under (the website contract). */
export type TestimonialField =
  'display_name' | 'context' | 'rating' | 'body' | 'language' | 'consent_to_publish';

/** The form's own order, so a page marks the first wrong field first. */
const FIELD_ORDER: readonly TestimonialField[] = [
  'display_name',
  'context',
  'rating',
  'body',
  'language',
  'consent_to_publish',
];

export type SubmittedTestimonial = {
  displayName: string;
  context: string | null;
  rating: 1 | 2 | 3 | 4 | 5;
  body: string;
  language: TestimonialLanguage;
};

export type TestimonialParseResult =
  | { ok: true; testimonial: SubmittedTestimonial }
  /** A hidden field was filled: a script. The door answers it exactly as it answers a person. */
  | { ok: false; reason: 'honeypot' }
  | { ok: false; reason: 'invalid'; fields: readonly TestimonialField[] };

// Tabs, vertical tabs and form feeds: control characters that are also
// white space, and read as a space.
const CONTROL_SPACE = /[\t\v\f]/g;
// Every other control character (Unicode Cc) and every invisible format
// character (Cf: zero-width spaces and joiners, direction overrides, the soft
// hyphen, the byte-order mark), but the line break. A direction override in a
// published name turns the rest of the card around; a zero-width run makes a
// name that shows as nothing, or pads a review past its minimum unseen.
// domain/reports/external.ts has a `tidy` for titles, which turns these into
// spaces and joins lines; here a character inside a word is taken out rather
// than splitting it, and the words keep their paragraphs.
const INVISIBLE = /(?!\n)[\p{Cc}\p{Cf}]/gu;

/** The words as typed, less what cannot be seen; line breaks kept. */
function text(value: unknown): string {
  if (typeof value !== 'string') return '';
  // One kind of line ending, so a review typed on Windows is not two
  // characters longer per paragraph than the same review typed anywhere else.
  return value.replace(/\r\n?/g, '\n').replace(CONTROL_SPACE, ' ').replace(INVISIBLE, '').trim();
}

/** A name or the line beneath it: as `text`, on one line. */
function line(value: unknown): string {
  return text(value).replace(/\s+/g, ' ');
}

function lengthOf(value: string): number {
  return [...value].length;
}

/**
 * A telephone number (seven digits or more, however spaced, dashed or
 * bracketed) or an email address. A review is published to the world, and the
 * table holds no way to reach anybody by design (migration 978), so a number
 * typed into one is refused rather than kept and shown.
 */
const PHONE_LIKE = /(?:\+?\d[\s\-().]*){7,}/;
const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

export function carriesContactDetails(value: string): boolean {
  return PHONE_LIKE.test(value) || EMAIL_LIKE.test(value);
}

function isHoneypotFilled(body: Record<string, unknown>): boolean {
  // The two names the website's forms already use for the hidden field
  // (domain/enquiry/parse.ts), so the site can reuse its markup.
  // Each is asked on its own: a page that sends one empty must not hide the other.
  return [body.website, body.botcheck].some(
    (value) =>
      value === true || value === 'on' || (typeof value === 'string' && value.trim() !== ''),
  );
}

function ratingOf(value: unknown): SubmittedTestimonial['rating'] | null {
  // A number from a script, or the one digit a <select> posts.
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (typeof value === 'string' && !/^[1-5]$/.test(value.trim())) return null;
  return Number.isInteger(n) && n >= 1 && n <= 5 ? (n as SubmittedTestimonial['rating']) : null;
}

/** Only an actual tick: anything else, absence included, is no consent to publish. */
function consented(value: unknown): boolean {
  return value === true || value === 'true' || value === 'on';
}

/** What the door keeps of a submission, or why it keeps nothing. */
export function parseTestimonial(body: Record<string, unknown>): TestimonialParseResult {
  if (isHoneypotFilled(body)) return { ok: false, reason: 'honeypot' };

  const wrong = new Set<TestimonialField>();

  const displayName = line(body.display_name);
  if (
    displayName === '' ||
    lengthOf(displayName) > TESTIMONIAL_LIMITS.displayNameMax ||
    carriesContactDetails(displayName)
  ) {
    wrong.add('display_name');
  }

  const context = line(body.context);
  if (lengthOf(context) > TESTIMONIAL_LIMITS.contextMax || carriesContactDetails(context)) {
    wrong.add('context');
  }

  const rating = ratingOf(body.rating);
  if (rating === null) wrong.add('rating');

  const words = text(body.body);
  if (
    lengthOf(words) < TESTIMONIAL_LIMITS.bodyMin ||
    lengthOf(words) > TESTIMONIAL_LIMITS.bodyMax ||
    carriesContactDetails(words)
  ) {
    wrong.add('body');
  }

  const language = (TESTIMONIAL_LANGUAGES as readonly unknown[]).includes(body.language)
    ? (body.language as TestimonialLanguage)
    : null;
  if (language === null) wrong.add('language');

  if (!consented(body.consent_to_publish)) wrong.add('consent_to_publish');

  if (wrong.size > 0 || rating === null || language === null) {
    return { ok: false, reason: 'invalid', fields: FIELD_ORDER.filter((f) => wrong.has(f)) };
  }
  return {
    ok: true,
    testimonial: {
      displayName,
      context: context === '' ? null : context,
      rating,
      body: words,
      language,
    },
  };
}
