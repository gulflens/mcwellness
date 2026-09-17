/**
 * The rules for what the website's enquiry forms send
 * (docs/superpowers/specs/2026-09-09-enquiries-design.md). Pure: the door in
 * app/api/enquiries applies them and the database keeps what survives them.
 *
 * Ported from the retiring project's `lodge_enquiry` edge function, which is
 * the reference for what the two forms actually send — the homepage widget on
 * every page, and the discovery-call form on book.html — and for the three
 * telephone-number rules below, each of which was learned from a real
 * submission.
 */

/** Long enough for anything a person writes, short enough that the table cannot be used as free storage. */
const LIMITS = {
  name: 120,
  phone: 24,
  email: 200,
  area: 120,
  message: 2000,
  // Chosen from short lists on the website, so these are generous already.
  concern: 120,
  preferredTime: 60,
  contactMethod: 60,
  source: 40,
  // The expo form's two answers, each one word from a fixed list.
  choice: 40,
} as const;

/**
 * `website` and `discovery_call` are the two forms on the practice's site.
 * `expo` is the form on the app itself, at `/expo`, which a visitor reaches by
 * scanning the code on the practice's stand (amended 2026-09-16, the
 * AccessAbilities Expo).
 */
export const ENQUIRY_SOURCES = ['website', 'discovery_call', 'expo'] as const;
export type EnquirySource = (typeof ENQUIRY_SOURCES)[number];

/**
 * The two answers only the expo form asks, each from a fixed list so the
 * office reads a word and never free text. Who the visitor is asking about:
 * themselves, a child, another family member, or someone else. Which of the
 * practice's two services: a brain map, neurofeedback, or both.
 */
export const ENQUIRING_FOR = ['self', 'child', 'family_member', 'someone_else'] as const;
export type EnquiringFor = (typeof ENQUIRING_FOR)[number];
export const INTERESTS = ['brain_map', 'neurofeedback', 'both'] as const;
export type Interest = (typeof INTERESTS)[number];

/** A field the door needs and the form did not give, in the form's own order. */
export type MissingField = 'name' | 'phone' | 'enquiring_for' | 'interest';

export type LodgedEnquiry = {
  name: string;
  whatsappE164: string;
  email: string | null;
  area: string | null;
  message: string | null;
  concern: string | null;
  preferredTime: string | null;
  contactMethod: string | null;
  /** Three-valued on purpose: a form with no consent box sends nothing, and that is "never asked", not "refused". */
  consent: boolean | null;
  source: EnquirySource;
  /** The expo form's two answers; null from the website's forms, which never ask. */
  enquiringFor: EnquiringFor | null;
  interest: Interest | null;
};

export type ParseResult =
  | { ok: true; enquiry: LodgedEnquiry }
  /**
   * `honeypot`: a hidden field was filled, so this is a script; the door
   * answers exactly as it answers a person and keeps nothing. `incomplete`:
   * no name or no number, the two things an enquiry is for — and, from the
   * expo form, no answer to who it is for or what they are interested in.
   * `missing` names each one so a page can mark the field.
   */
  | { ok: false; reason: 'honeypot' }
  | { ok: false; reason: 'incomplete'; missing: readonly MissingField[] };

function clamp(value: unknown, limit: number): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, limit);
}

function orNull(value: string): string | null {
  return value === '' ? null : value;
}

/**
 * A number the practice can ring, from what two forms send about it.
 *
 * The widget sends a dialling code and the number separately. The
 * discovery-call form sends one field, which people fill every way there is:
 * with the +971, with a trunk zero, with neither. Blindly prepending a country
 * code to a number that already carries one produced +971971500000099, which
 * nobody can ring. So: an explicit plus is believed as given; otherwise a
 * leading country code is recognised and not doubled, and a trunk zero is
 * dropped. The recognition is guarded on length so a short local number that
 * happens to begin with the code's digits is not truncated into nonsense.
 */
/** The shape the contact table insists on (060_client.sql): a plus, then 7 to 15 digits, no leading zero. */
const E164 = /^\+[1-9][0-9]{6,14}$/;
/** An address with one @ and a dot after it; anything else is kept as nothing rather than as a bad address. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function toE164(countryCode: string, phone: string): string {
  const raw = phone.trim();
  const code = (countryCode || '+971').replace(/\D/g, '') || '971';

  if (raw.startsWith('+')) {
    const digits = raw.replace(/\D/g, '');
    return asE164(digits ? `+${digits}` : '');
  }

  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith(code) && digits.length > code.length + 5) {
    digits = digits.slice(code.length);
  }
  digits = digits.replace(/^0+/, '');
  if (!digits) return '';
  return asE164(`+${code}${digits}`);
}

/** Empty unless it is a number a client record could hold: the door then answers "incomplete". */
function asE164(candidate: string): string {
  return E164.test(candidate) ? candidate : '';
}

function asEmail(candidate: string | null): string | null {
  return candidate !== null && EMAIL.test(candidate) ? candidate : null;
}

function isHoneypotFilled(body: Record<string, unknown>): boolean {
  const value = body.botcheck ?? body.website ?? '';
  if (value === true || value === 'on') return true;
  return typeof value === 'string' && value.trim() !== '';
}

function consentOf(value: unknown): boolean | null {
  if (value === true || value === 'on' || value === 'true') return true;
  if (value === undefined || value === null || value === '') return null;
  return false;
}

function sourceOf(value: unknown): EnquirySource {
  const named = clamp(value, LIMITS.source);
  return (ENQUIRY_SOURCES as readonly string[]).includes(named)
    ? (named as EnquirySource)
    : 'website';
}

/** One of a fixed list, or nothing: a value off the list is "not answered", never kept as text. */
function oneOf<T extends string>(value: unknown, list: readonly T[]): T | null {
  const named = clamp(value, LIMITS.choice);
  return (list as readonly string[]).includes(named) ? (named as T) : null;
}

/** What the door keeps of a submission, or why it keeps nothing. */
export function parseEnquiry(body: Record<string, unknown>): ParseResult {
  if (isHoneypotFilled(body)) return { ok: false, reason: 'honeypot' };

  const name = clamp(body.name, LIMITS.name);
  const whatsappE164 = toE164(
    typeof body.country_code === 'string' ? body.country_code : '+971',
    clamp(body.phone, LIMITS.phone),
  );
  const source = sourceOf(body.source);
  // The two answers are the expo form's alone: the website's forms do not
  // ask, so a value that arrives from them is not an answer to anything.
  const enquiringFor = source === 'expo' ? oneOf(body.enquiring_for, ENQUIRING_FOR) : null;
  const interest = source === 'expo' ? oneOf(body.interest, INTERESTS) : null;

  const missing: MissingField[] = [];
  if (!name) missing.push('name');
  if (!whatsappE164) missing.push('phone');
  if (source === 'expo') {
    if (enquiringFor === null) missing.push('enquiring_for');
    if (interest === null) missing.push('interest');
  }
  if (missing.length > 0) return { ok: false, reason: 'incomplete', missing };

  return {
    ok: true,
    enquiry: {
      name,
      whatsappE164,
      email: asEmail(orNull(clamp(body.email, LIMITS.email))),
      area: orNull(clamp(body.area, LIMITS.area)),
      message: orNull(clamp(body.message, LIMITS.message)),
      concern: orNull(clamp(body.concern, LIMITS.concern)),
      preferredTime: orNull(clamp(body.preferred_time, LIMITS.preferredTime)),
      contactMethod: orNull(clamp(body.contact_method, LIMITS.contactMethod)),
      consent: consentOf(body.consent),
      source,
      enquiringFor,
      interest,
    },
  };
}

/** The lead a converted enquiry becomes: the shape `POST /api/clients` takes. */
export type LeadFromEnquiry = {
  givenName: string;
  familyName: string;
  referralSource: string;
  contact: {
    relationship: 'self';
    phone: string;
    email?: string;
    isLegalGuardian: false;
    canConsent: false;
    canReceiveReports: true;
    canPay: false;
  };
};

/**
 * Convert to lead. The name splits at the first space; a single name is
 * recorded as both given and family rather than a second one being invented.
 * The person is their own first contact, and nothing about consent is decided
 * here — that is the practice's judgement, on the record screen.
 */
export function leadFromEnquiry(enquiry: LodgedEnquiry): LeadFromEnquiry {
  const [givenName, ...rest] = enquiry.name.split(/\s+/);
  const given = givenName ?? enquiry.name;
  const family = rest.length > 0 ? rest.join(' ') : given;
  return {
    givenName: given,
    familyName: family,
    referralSource: enquiry.source,
    contact: {
      relationship: 'self',
      phone: enquiry.whatsappE164,
      ...(enquiry.email ? { email: enquiry.email } : {}),
      isLegalGuardian: false,
      canConsent: false,
      canReceiveReports: true,
      canPay: false,
    },
  };
}
