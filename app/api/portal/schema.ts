import { z } from 'zod';
import { APPOINTMENT_STATUSES, INVITE_KINDS, VISIT_OUTCOMES } from '../../../domain/portal';
import { cleanText } from '../_middleware/text';

/**
 * Every shape the portal answers and every body it accepts
 * (docs/SPEC/client-portal.md section 7).
 *
 * The answers are parsed on the way out, not only typed: a route reads rows
 * that carry a great deal this household must never see — a coordinate, an
 * arrival note, a Makani number, an Emirates ID column, a practitioner's name
 * — and `Schema.parse` at the boundary is what makes "nothing extra leaks" a
 * fact rather than a discipline. Anything not named here does not travel.
 *
 * The bodies are parsed on the way in for the same reason in reverse: a
 * telephone in the shape the column's own check accepts, an address that is an
 * address, a note cleaned and capped at 200, and a password of at least twelve
 * characters.
 */

export const LOCALES = ['en', 'ar'] as const;
export const Locale = z.enum(LOCALES);
export type Locale = z.infer<typeof Locale>;

export const DELIVERY_MODES = ['home', 'studio', 'remote'] as const;

/** YYYY-MM-DD, as the practice's own day. */
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * E.164, the shape `contact.phone` itself checks: a plus, a country code that
 * does not begin with zero, and seven to fifteen digits in all. Refused here
 * with a sentence rather than surfacing as a constraint violation.
 */
export const E164 = z
  .string()
  .transform((value) => value.replace(/[\s()-]/g, ''))
  .refine((value) => /^\+[1-9][0-9]{6,14}$/.test(value), 'A telephone number is +971 50 000 0000.');

/** An address, or nothing at all: a household may have neither. */
const OptionalEmail = z
  .string()
  .max(320)
  .nullable()
  .transform((value) => {
    const cleaned = cleanText(value ?? '', 320);
    return cleaned.length === 0 ? null : cleaned;
  })
  .refine((value) => value === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), {
    message: 'An email address is somebody@example.com.',
  });

/** The name of a person or a service, in both languages where one exists. */
const Named = z.object({ name: z.string(), nameAr: z.string().nullable() });

// ---------------------------------------------------------------------------
// The practice, and the person signed in.
// ---------------------------------------------------------------------------

export const Practice = z.object({
  name: z.string(),
  nameAr: z.string().nullable(),
  /**
   * The number the "ask for a visit" button opens. Null where the practice has
   * recorded none, and the screen then says "ask the practice" without a
   * button rather than opening WhatsApp on nothing.
   */
  whatsappNumber: z.string().nullable(),
  timezone: z.string(),
});
export type Practice = z.infer<typeof Practice>;

/** One client of the household, as every screen heads its section. */
export const PortalClient = Named.extend({
  id: z.uuid(),
  /** Whether this person may be shown this client's money (section 5, rule 5). */
  moneyVisible: z.boolean(),
});
export type PortalClient = z.infer<typeof PortalClient>;

// ---------------------------------------------------------------------------
// Home.
// ---------------------------------------------------------------------------

export const NextVisit = z.object({
  clientId: z.uuid(),
  date: IsoDate,
  /** The arrival window, start and end. Never a point time (section 3.2). */
  windowStart: z.string(),
  windowEnd: z.string(),
  serviceName: z.string(),
  serviceNameAr: z.string().nullable(),
  deliveryMode: z.enum(DELIVERY_MODES),
});

/** What a client's money comes to, in one line, for Home. */
export const MoneySummary = z.object({
  /** Positive: owed. Negative: in credit. Zero: settled. */
  outstandingFils: z.number().int(),
  /** "Session n of N" on the household's current bundle, when one is running. */
  sessionsUsed: z.number().int().nonnegative().nullable(),
  sessionsTotal: z.number().int().nonnegative().nullable(),
});
export type MoneySummary = z.infer<typeof MoneySummary>;

/** Something waiting on the household (section 3.1). */
export const Notice = z.object({
  kind: z.enum(['consent_newer_wording', 'request_open', 'request_handled']),
  clientId: z.uuid(),
  /** The consent or the request the notice is about. */
  entityId: z.uuid(),
  /** A consent purpose, or a request kind: the dictionary turns it into words. */
  detail: z.string(),
});
export type Notice = z.infer<typeof Notice>;

export const HomeResponse = z.object({
  practice: Practice,
  locale: Locale,
  clients: z.array(PortalClient),
  nextVisit: NextVisit.nullable(),
  money: z.array(MoneySummary.extend({ clientId: z.uuid() })),
  notices: z.array(Notice),
});
export type HomeResponse = z.infer<typeof HomeResponse>;

// ---------------------------------------------------------------------------
// Visits.
// ---------------------------------------------------------------------------

export const Visit = z.object({
  id: z.uuid(),
  clientId: z.uuid(),
  date: IsoDate,
  windowStart: z.string(),
  windowEnd: z.string(),
  serviceName: z.string(),
  serviceNameAr: z.string().nullable(),
  deliveryMode: z.enum(DELIVERY_MODES),
  status: z.enum(APPOINTMENT_STATUSES),
  /** Null while the visit is still to come. */
  outcome: z.enum(VISIT_OUTCOMES).nullable(),
});
export type Visit = z.infer<typeof Visit>;

export const VisitsResponse = z.object({
  clients: z.array(PortalClient),
  upcoming: z.array(Visit),
  past: z.array(Visit),
});
export type VisitsResponse = z.infer<typeof VisitsResponse>;

// ---------------------------------------------------------------------------
// Money.
// ---------------------------------------------------------------------------

export const PortalPackage = Named.extend({
  id: z.uuid(),
  clientId: z.uuid(),
  purchasedOn: IsoDate,
  /**
   * The day these credits stop being usable, and null when they never do —
   * the programme was sold with no term (migration 412, the operator's ruling
   * of 12 September 2026). The screen says so in words; a household is never
   * shown a blank where a date would be.
   */
  expiresOn: IsoDate.nullable(),
  used: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type PortalPackage = z.infer<typeof PortalPackage>;

export const PortalInvoice = z.object({
  id: z.uuid(),
  clientId: z.uuid(),
  reference: z.string(),
  issuedOn: IsoDate,
  grossFils: z.number().int(),
  /**
   * The day the practice forgave this charge, and null while it stands
   * (migration 408; `docs/CHANGE-REQUESTS/billing-06.md` request 1). A day
   * rather than an instant, like `issuedOn` beside it and `receivedOn` on a
   * payment: the household is told which day, never which second.
   */
  waivedOn: IsoDate.nullable(),
  /** The rendered PDF, when one has been filed. Opened through a signed link. */
  documentId: z.uuid().nullable(),
});
export type PortalInvoice = z.infer<typeof PortalInvoice>;

export const PortalPayment = z.object({
  id: z.uuid(),
  clientId: z.uuid(),
  receivedOn: IsoDate,
  method: z.string(),
  amountFils: z.number().int(),
  receiptReference: z.string().nullable(),
  documentId: z.uuid().nullable(),
});
export type PortalPayment = z.infer<typeof PortalPayment>;

export const MoneyResponse = z.object({
  clients: z.array(PortalClient),
  balances: z.array(MoneySummary.extend({ clientId: z.uuid() })),
  packages: z.array(PortalPackage),
  invoices: z.array(PortalInvoice),
  payments: z.array(PortalPayment),
});
export type MoneyResponse = z.infer<typeof MoneyResponse>;

export const DocumentLinkResponse = z.object({
  url: z.string(),
  expiresInSeconds: z.number().int().positive(),
});
export type DocumentLinkResponse = z.infer<typeof DocumentLinkResponse>;

// ---------------------------------------------------------------------------
// Family.
// ---------------------------------------------------------------------------

/**
 * The address as the household is shown it: the line and the emirate, and
 * nothing else. Never a coordinate, an arrival note, a parking point or a
 * Makani number — those are what the practitioner drives by, not what the
 * household reads (section 3.4).
 */
export const PortalAddress = z.object({
  displayAddress: z.string().nullable(),
  emirate: z.string(),
});

export const Person = z.object({
  id: z.uuid(),
  clientId: z.uuid(),
  name: z.string(),
  nameAr: z.string().nullable(),
  relationship: z.string(),
  canConsent: z.boolean(),
  canReceiveReports: z.boolean(),
  canPay: z.boolean(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  whatsappOptIn: z.boolean(),
  /** The signed-in person's own row: the one this screen's form may change. */
  isYou: z.boolean(),
});
export type Person = z.infer<typeof Person>;

export const FamilyResponse = z.object({
  clients: z.array(PortalClient.extend({ address: PortalAddress.nullable() })),
  people: z.array(Person),
});
export type FamilyResponse = z.infer<typeof FamilyResponse>;

/** The one form on the portal (section 3.4). */
export const UpdateContactInput = z.object({
  phone: E164.nullable(),
  email: OptionalEmail,
  whatsappOptIn: z.boolean(),
});
export type UpdateContactInput = z.infer<typeof UpdateContactInput>;

// ---------------------------------------------------------------------------
// Agreements.
// ---------------------------------------------------------------------------

export const Agreement = z.object({
  id: z.uuid(),
  clientId: z.uuid(),
  purpose: z.string(),
  status: z.string(),
  givenAt: z.string(),
  withdrawnAt: z.string().nullable(),
  /** Who gave it, in words the dictionary knows. */
  givenByRelationship: z.string(),
  /** The exact wording this person was shown. */
  wordingDocumentId: z.uuid().nullable(),
  /**
   * True when the wording this consent points at has been retired and a newer
   * approved version of the same purpose and language stands (section 3.5).
   * The screen says a newer version exists; it never withdraws anything.
   */
  newerWordingExists: z.boolean(),
  /** An open request already made about this consent, so the screen says so. */
  requestedWithdrawal: z.boolean(),
});
export type Agreement = z.infer<typeof Agreement>;

export const AgreementsResponse = z.object({
  clients: z.array(PortalClient),
  agreements: z.array(Agreement),
  /** Open erasure requests, per client, so "Ask for erasure" reads as asked. */
  erasureRequested: z.array(z.uuid()),
});
export type AgreementsResponse = z.infer<typeof AgreementsResponse>;

// ---------------------------------------------------------------------------
// Reports (docs/SPEC/reports-v1.md section 7.3). The household's sixth screen,
// specified by the reports piece and built here because this is where the
// portal's screens live.
// ---------------------------------------------------------------------------

/**
 * One report as a household reads it: its reference, what kind it is, what it
 * covers and when it was issued.
 *
 * Nothing of its body travels. The figures, the goals and the practitioner's
 * words are inside the PDF, which opens through a short-lived audited link;
 * putting them in this answer would put a household's most personal document
 * into every response the screen makes.
 */
export const PortalReport = z.object({
  id: z.uuid(),
  clientId: z.uuid(),
  kind: z.enum(['session', 'progress']),
  status: z.enum(['draft', 'issued', 'superseded']),
  reference: z.string().nullable(),
  issuedOn: IsoDate.nullable(),
  coverageFrom: IsoDate.nullable(),
  coverageTo: IsoDate.nullable(),
  version: z.number().int().min(1),
  documentId: z.uuid().nullable(),
});
export type PortalReport = z.infer<typeof PortalReport>;

export const PortalReportsResponse = z.object({
  clients: z.array(PortalClient),
  reports: z.array(PortalReport),
});
export type PortalReportsResponse = z.infer<typeof PortalReportsResponse>;

export const WordingResponse = z.object({
  id: z.uuid(),
  purpose: z.string(),
  locale: Locale,
  version: z.string(),
  status: z.string(),
  mimeType: z.string(),
  textUrl: z.string(),
  expiresInSeconds: z.number().int().positive(),
});
export type WordingResponse = z.infer<typeof WordingResponse>;

// ---------------------------------------------------------------------------
// Requests.
// ---------------------------------------------------------------------------

export const REQUEST_KINDS = ['consent_withdrawal', 'erasure'] as const;
export const REQUEST_NOTE_MAX = 200;

export const CreateRequestInput = z
  .object({
    clientId: z.uuid(),
    kind: z.enum(REQUEST_KINDS),
    consentId: z.uuid().nullable().default(null),
    note: z
      .string()
      .max(2000)
      .nullable()
      .default(null)
      .transform((value) => {
        const cleaned = cleanText(value ?? '', REQUEST_NOTE_MAX);
        return cleaned.length === 0 ? null : cleaned;
      }),
  })
  // The same pair the column's own check holds: a withdrawal names a consent
  // and an erasure names none.
  .refine((value) => (value.kind === 'consent_withdrawal') === (value.consentId !== null), {
    path: ['consentId'],
    message: 'A withdrawal names the consent it is about; an erasure names none.',
  });
export type CreateRequestInput = z.infer<typeof CreateRequestInput>;

export const PortalRequest = z.object({
  id: z.uuid(),
  clientId: z.uuid(),
  kind: z.enum(REQUEST_KINDS),
  consentId: z.uuid().nullable(),
  note: z.string().nullable(),
  status: z.enum(['open', 'handled']),
  createdAt: z.string(),
  handledAt: z.string().nullable(),
});
export type PortalRequest = z.infer<typeof PortalRequest>;

export const RequestResponse = z.object({ request: PortalRequest });

/** The office's own list: the client's name travels, the note travels, no number does. */
export const OfficeRequest = PortalRequest.extend({
  clientName: z.string(),
  askedByName: z.string(),
  askedByRelationship: z.string(),
});
export type OfficeRequest = z.infer<typeof OfficeRequest>;

export const OfficeRequestsResponse = z.object({ requests: z.array(OfficeRequest) });
export type OfficeRequestsResponse = z.infer<typeof OfficeRequestsResponse>;

// ---------------------------------------------------------------------------
// Household access (the practice's own screen, section 3.8).
// ---------------------------------------------------------------------------

export const ACCESS_STATES = ['none', 'invited', 'active', 'revoked'] as const;

export const AccessRow = z.object({
  contactId: z.uuid(),
  clientId: z.uuid(),
  clientName: z.string(),
  name: z.string(),
  relationship: z.string(),
  /**
   * Whether the contact has a telephone and an address at all — never the
   * values. This screen decides whether a link can be sent, not what to.
   */
  hasPhone: z.boolean(),
  hasEmail: z.boolean(),
  state: z.enum(ACCESS_STATES),
  /** When an outstanding invitation runs out; only while the state is invited. */
  expiresAt: z.string().nullable(),
  /** When the person first came through the door; only while the state is active. */
  since: z.string().nullable(),
});
export type AccessRow = z.infer<typeof AccessRow>;

export const AccessResponse = z.object({ access: z.array(AccessRow) });
export type AccessResponse = z.infer<typeof AccessResponse>;

/**
 * What issuing an invitation answers: the link, once, and the drafted
 * bilingual message. Neither is readable again — only the token's hash is
 * stored — so the screen shows both and the practice hands them over.
 */
export const InviteResponse = z.object({
  contactId: z.uuid(),
  kind: z.enum(INVITE_KINDS),
  url: z.string(),
  expiresAt: z.string(),
  message: z.object({ en: z.string(), ar: z.string() }),
  /**
   * The number the WhatsApp hand-off opens, when the contact has one. The
   * browser composes the `wa.me` link; nothing leaves this server
   * (docs/SEAMS.md).
   */
  phone: z.string().nullable(),
});
export type InviteResponse = z.infer<typeof InviteResponse>;

export const RevokeResponse = z.object({ contactId: z.uuid(), state: z.enum(ACCESS_STATES) });

// ---------------------------------------------------------------------------
// The door, which is the one route outside the fence.
// ---------------------------------------------------------------------------

// One floor, the practice's, shared with the page that changes a password.
import { PASSWORD_MIN_LENGTH } from '../../../domain/shared/password';
export { PASSWORD_MIN_LENGTH };

export const RedeemInput = z.object({
  /** 32 random bytes in base64url: 43 characters, and never anything longer. */
  token: z.string().min(16).max(200),
  email: z
    .string()
    .max(320)
    .transform((value) => cleanText(value, 320))
    .refine((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), {
      message: 'An email address is somebody@example.com.',
    }),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(200),
});
export type RedeemInput = z.infer<typeof RedeemInput>;

/**
 * `{ ok: true }`, and — only where the fake seam is the one running — the auth
 * id the development door can sign a token for. A deployment with a real
 * project never answers it: the browser signs in with the address and password
 * the person just chose.
 */
export const RedeemResponse = z.object({
  ok: z.literal(true),
  authId: z.uuid().optional(),
});
export type RedeemResponse = z.infer<typeof RedeemResponse>;
