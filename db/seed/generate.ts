import { BANDS } from '../../domain/shared/bands';
import { ageOn } from '../../domain/shared/dates';
import { practiceDocumentKey } from '../../domain/shared/storage';
import { CONSENT_TEXT_MIME_TYPE, loadConsentTexts, type ConsentText } from './consent-text';
import { FAMILY_NAMES, GIVEN_NAMES, type Name } from './names';
import { at, seededRandom } from './random';

/**
 * The synthetic practice: one tenant, six people with logins (four of the
 * practice's own, and two households in the client portal), three
 * practitioners with certifications, six services with the practice's own
 * prices and its three programmes, twenty clients with contacts, home
 * locations and consents. Pure: the same options give the same
 * output, byte for byte. Every value is inside the reserved fake ranges
 * (.claude/rules/testing.md): ids of the form 0000000K-0000-4000-8000-*, phones (or `000000KK-...` for a two-character kind such as the billing catalogue's `d0` to `d3`)
 * +971 50 000 1xxx, emails at example.com, Emirates IDs 784-1900-*, names from
 * ./names.ts. Nothing here describes a real person.
 */

export type Emirate = 'DXB' | 'AUH' | 'SHJ' | 'AJM' | 'UAQ' | 'RAK' | 'FUJ';
export type RoleKind =
  'owner' | 'admin' | 'lead_practitioner' | 'practitioner' | 'finance' | 'client_contact';
export type DeliveryMode = 'home' | 'studio' | 'remote';
export type ClientStatus = 'lead' | 'active' | 'paused' | 'closed';
export type Relationship = 'self' | 'mother' | 'father';
export type ConsentPurpose =
  'participation' | 'minor_participation' | 'home_visit' | 'photo_video' | 'research' | 'marketing';
export type ConsentMethod = 'app_signature' | 'paper_scan' | 'verbal_witnessed';

export type SeedTenant = {
  id: string;
  legalName: string;
  legalNameAr: string;
  /** The corporate-tax registration the practice holds today, never a VAT one (migration 905). */
  trn: string;
  licenceNumber: string;
  licensingAuthority: string;
  licenceExpiresOn: string;
  /**
   * The synthetic practice is not registered for VAT, because the real one is
   * not: registration follows the AED 375,000 threshold (docs/SPEC/billing.md
   * section 5.1) and has not happened. So there is no VAT number to seed, and
   * a screen built against this fixture meets the state it will actually meet.
   */
  vatRegistered: false;
  vatTrn: null;
  defaultEmirate: Emirate;
  timezone: string;
  /**
   * The number a household messages the practice on (migration 910). The
   * portal's "ask for a visit" opens WhatsApp on it, so a practice without one
   * shows the sentence and no button.
   */
  whatsappNumber: string;
};
export type SeedUser = {
  id: string;
  authId: string;
  displayName: string;
  email: string;
  phone: string;
  preferredLocale: 'en' | 'ar';
};
export type SeedRole = { id: string; userId: string; role: RoleKind };
export type ChecklistItem = { key: string; label_en: string; label_ar: string };
export type RatingQuestion = ChecklistItem & { min: 0; max: 10 };
export type SeedServiceType = {
  id: string;
  code: string;
  name: string;
  nameAr: string;
  durationMinutes: number;
  requiresCertification: string | null;
  deliveryModes: DeliveryMode[];
  /** What the practitioner confirms at the door (migration 901, session-capture.md 3.2). */
  preflightChecklist: ChecklistItem[];
  /** The 0-to-10 questions asked before the session and again after it. */
  ratingQuestions: RatingQuestion[];
};
/** One service's price, net of VAT. Append-only in the database; one row each here. */
export type SeedPrice = {
  id: string;
  serviceTypeId: string;
  unitPriceFils: number;
  vatRateBasisPoints: number;
  vatSettingVersion: number;
  validFrom: string;
  amendmentReason: string;
};
export type SeedPackageComponent = {
  id: string;
  packageId: string;
  serviceTypeId: string;
  quantity: number;
  lineNo: number;
};
export type SeedPackage = {
  id: string;
  code: string;
  name: string;
  nameAr: string;
  /** What the contents come to bought one at a time. Set by the practice, never derived. */
  listPriceFils: number;
  expiryMonths: number;
  components: SeedPackageComponent[];
  /** What it is selling for today, with the reason behind the figure. */
  price: {
    id: string;
    amountFils: number;
    vatRateBasisPoints: number;
    vatSettingVersion: number;
    validFrom: string;
    amendmentReason: string;
  };
};
export type SeedPractitioner = {
  id: string;
  userId: string;
  displayNameAr: string | null;
  homeBaseLocationId: string;
};
export type SeedCredential = {
  id: string;
  practitionerId: string;
  serviceTypeId: string;
  certification: string;
  certifyingBody: string;
  certificateNumber: string;
  validFrom: string;
  validTo: string | null;
  canAuthorProtocol: boolean;
  canExecuteSession: boolean;
  canSignReport: boolean;
};
export type Point = { lng: number; lat: number };
export type SeedLocation = {
  id: string;
  ownerType: 'client' | 'tenant';
  ownerId: string;
  label: 'home' | 'studio';
  emirate: Emirate;
  makaniNumber: string | null;
  entrance: Point;
  parking: Point | null;
  displayAddress: string;
  accessNotes: string | null;
  isPrimary: boolean;
};
export type SeedClient = {
  id: string;
  mrn: string;
  givenName: string;
  familyName: string;
  givenNameAr: string | null;
  familyNameAr: string | null;
  dateOfBirth: string;
  sexAtBirth: 'female' | 'male' | 'unknown';
  preferredLocale: 'en' | 'ar';
  primaryContactId: string;
  primaryLocationId: string;
  referralSource: string;
  status: ClientStatus;
};
export type SeedContact = {
  id: string;
  clientId: string;
  /**
   * The portal account, on the two households that have one; null on the rest,
   * which is the ordinary case (`contact.user_id` is nullable precisely
   * because most contacts never sign in).
   */
  userId: string | null;
  /** The person to ask for at the door, and the person a consent was given by. */
  givenName: string;
  familyName: string;
  /** The same name in Arabic, on the households that read Arabic; null on the rest, as a client's is. */
  givenNameAr: string | null;
  familyNameAr: string | null;
  relationship: Relationship;
  isLegalGuardian: boolean;
  canConsent: boolean;
  canReceiveReports: boolean;
  canPay: boolean;
  phone: string;
  email: string;
  whatsappOptIn: boolean;
  /** Display form, 784-1900-*, only on the adult who consents for a minor. Sealed on write. */
  emiratesId: string | null;
};
/**
 * One instrument on the practice's register (docs/SPEC/practitioner-phone.md
 * section 6, `docs/SPEC/00-data-model.md` section 5).
 *
 * The serial is in the same reserved shape as an id, deliberately: a serial
 * that looked like a real one would be a real manufacturer's number sitting in
 * a fixture, and this way "no real serial" is a property of the text rather
 * than of somebody's care. The model name is fictional for the same reason.
 */
export type SeedKit = {
  id: string;
  serial: string;
  model: string;
  kind: 'amplifier' | 'laptop' | 'electrode_set';
  status: 'active' | 'inactive';
  assignedPractitionerId: string | null;
  lastCalibratedAt: string | null;
  calibrationDueAt: string | null;
};

/**
 * One measurement of the synthetic practice
 * (docs/CHANGE-REQUESTS/assessment-01.md item 4, docs/SPEC/assessment.md
 * section 6).
 *
 * Three clients each get a baseline brain map, a re-map ninety days later and
 * one questionnaire total, so a comparison can be shown on staging without
 * anybody typing ninety figures. **No file is seeded at all**: an export is a
 * vendor's own PDF and there is no synthetic one to invent, so the Assessments
 * tab shows "none attached" and the file door is exercised by the tests rather
 * than by the fixture.
 *
 * Every figure comes from the seeded random source under the fixed seed, so
 * the same practice comes out on every run — and none of them says anything
 * about anybody: they are numbers with units and no words beside them.
 */
export type SeedAssessment = {
  id: string;
  clientId: string;
  practitionerId: string;
  performedAt: string;
  instrument: 'qeeg' | 'questionnaire.sample';
  instrumentVersion: string;
  /** Validated against the instrument's declared shape by the seed's own test. */
  derived: Record<string, unknown>;
  conditionNote: string | null;
  referenceAgeYears: number | null;
  referenceSex: 'female' | 'male' | 'unknown' | null;
};

export type SeedDocument = {
  id: string;
  purpose: ConsentPurpose;
  locale: 'en' | 'ar';
  version: string;
  status: 'draft' | 'approved';
  kind: 'consent_text';
  storageKey: string;
  mimeType: string;
  sha256Hex: string;
  /** The file this row is the record of, and its bytes, for whoever puts them in the store. */
  file: string;
  bytes: Buffer;
};
export type SeedConsent = {
  id: string;
  clientId: string;
  givenByContactId: string;
  purpose: ConsentPurpose;
  /**
   * The consent record's OWN version, counting amendments of this consent:
   * every seeded one is a first giving, so every one is 1. It is not the
   * wording's version, which this row carries only as the pointer
   * `textDocumentId` — the document row holds `version` ('0.1-draft' today)
   * and the two never need to agree (docs/SPEC/00-data-model.md section 3).
   */
  version: 1;
  textDocumentId: string;
  status: 'active' | 'withdrawn';
  givenAt: string;
  withdrawnAt: string | null;
  method: ConsentMethod;
};
export type SeedData = {
  today: string;
  tenant: SeedTenant;
  users: SeedUser[];
  roles: SeedRole[];
  serviceTypes: SeedServiceType[];
  prices: SeedPrice[];
  packages: SeedPackage[];
  practitioners: SeedPractitioner[];
  credentials: SeedCredential[];
  kit: SeedKit[];
  locations: SeedLocation[];
  clients: SeedClient[];
  contacts: SeedContact[];
  documents: SeedDocument[];
  consents: SeedConsent[];
  assessments: SeedAssessment[];
};
export type SeedOptions = {
  seed?: number;
  today?: string;
  /** The wording files. Read from docs/CONSENT unless a test hands its own in. */
  consentTexts?: ConsentText[];
};

export const SEED_DEFAULT = 20_260_902;
export const SEED_TODAY = '2026-09-02';
export const SEED_REASON = 'synthetic seed';

/** 0000000K-0000-4000-8000-000000000NNN: readable, fixed, and shaped like a v4 uuid.
 *  `kind` is one or two hex characters; the single characters are nearly spent. */
export function seedId(kind: string, n: number): string {
  return `${'0000000'.slice(kind.length - 1)}${kind}-0000-4000-8000-${String(n).padStart(12, '0')}`;
}
export const SEED_TENANT_ID = seedId('1', 1);
export const SEED_OWNER_USER_ID = seedId('2', 1);

const EMIRATES: readonly { code: Emirate; name: string; centre: Point }[] = [
  { code: 'DXB', name: 'Dubai', centre: { lng: 55.27, lat: 25.2 } },
  { code: 'AUH', name: 'Abu Dhabi', centre: { lng: 54.38, lat: 24.45 } },
  { code: 'SHJ', name: 'Sharjah', centre: { lng: 55.4, lat: 25.35 } },
  { code: 'AJM', name: 'Ajman', centre: { lng: 55.45, lat: 25.4 } },
  { code: 'UAQ', name: 'Umm Al Quwain', centre: { lng: 55.55, lat: 25.55 } },
  { code: 'RAK', name: 'Ras Al Khaimah', centre: { lng: 55.95, lat: 25.78 } },
  { code: 'FUJ', name: 'Fujairah', centre: { lng: 56.33, lat: 25.12 } },
];

/** A service as the catalogue lists it; its session settings are attached below. */
type SeedServiceDefinition = Omit<SeedServiceType, 'id' | 'preflightChecklist' | 'ratingQuestions'>;

const SERVICES: readonly SeedServiceDefinition[] = [
  {
    code: 'discovery-call',
    name: 'Discovery call',
    nameAr: 'مكالمة تعارف',
    durationMinutes: 60,
    requiresCertification: null,
    deliveryModes: ['remote'],
  },
  {
    code: 'consultation',
    name: 'Consultation',
    nameAr: 'استشارة',
    durationMinutes: 45,
    requiresCertification: null,
    deliveryModes: ['home', 'remote'],
  },
  {
    code: 'brain-map',
    name: 'Brain map (QEEG)',
    nameAr: 'خريطة الدماغ',
    durationMinutes: 90,
    requiresCertification: 'vendor_qeeg',
    deliveryModes: ['home'],
  },
  {
    code: 'results-call',
    name: 'Results call',
    nameAr: 'مكالمة النتائج',
    durationMinutes: 30,
    requiresCertification: null,
    deliveryModes: ['remote'],
  },
  {
    code: 'nf-session',
    name: 'Neurofeedback session',
    nameAr: 'جلسة التغذية الراجعة العصبية',
    durationMinutes: 60,
    requiresCertification: 'bcia_bcn',
    deliveryModes: ['home'],
  },
  {
    code: 'compassionate-inquiry',
    name: 'Compassionate Inquiry',
    nameAr: 'الاستقصاء الرحيم',
    durationMinutes: 60,
    requiresCertification: null,
    deliveryModes: ['home', 'remote'],
  },
];

/**
 * Drafts, and marked as drafts: the practice edits both lists in the app once
 * Settings can (session-capture.md sections 3.2 and 3.5 name exactly these).
 * They sit on the neurofeedback session only — a consultation has no
 * electrodes to check — and every other seeded service starts with none, the
 * way a real catalogue starts.
 */
const NF_PREFLIGHT: readonly ChecklistItem[] = [
  { key: 'identity', label_en: 'Client identity confirmed', label_ar: 'تم التأكد من هوية العميل' },
  {
    key: 'guardian_present',
    label_en: 'Guardian present, if the client is under 18',
    label_ar: 'وجود الوصي إذا كان العميل دون الثامنة عشرة',
  },
  {
    // The minor-participation wording promises the child's own agreement
    // ("A child's 'no' ends the session", section 2), and a promise nothing
    // records is a promise nobody can show was kept. Beside the guardian's
    // presence because that is the order the door is worked in.
    key: 'child_assents',
    label_en: 'For a child: they agreed to take part today',
    label_ar: 'للطفل: وافق على المشاركة اليوم',
  },
  {
    key: 'environment',
    label_en: 'Environment suitable: quiet, seated, well lit',
    label_ar: 'البيئة مناسبة: هادئة، والعميل جالس، وإضاءة جيدة',
  },
  {
    key: 'equipment',
    label_en: 'Sensors and consumables ready',
    label_ar: 'المستشعرات والمستلزمات جاهزة',
  },
];
const NF_RATINGS: readonly RatingQuestion[] = [
  { key: 'sleep', label_en: 'Sleep last night', label_ar: 'النوم الليلة الماضية', min: 0, max: 10 },
  { key: 'focus', label_en: 'Focus today', label_ar: 'التركيز اليوم', min: 0, max: 10 },
  { key: 'mood', label_en: 'Mood now', label_ar: 'المزاج الآن', min: 0, max: 10 },
];

/**
 * What the practice charges, net of VAT (the founder's decisions of
 * 2026-09-03). A discovery call, a consultation and a results call are
 * included in something else and never billed, so they carry a zero price
 * rather than no price: an unpriced service that is delivered goes to
 * billing_exception, and a free call is not an exception. Compassionate
 * Inquiry is deliberately absent - no figure has been set.
 */
const PRICES: readonly { code: string; fils: number; why: string }[] = [
  { code: 'discovery-call', fils: 0, why: 'Free of charge; never billed.' },
  { code: 'consultation', fils: 0, why: 'Included in a programme; never sold alone.' },
  { code: 'brain-map', fils: 82_500, why: 'Opening price list.' },
  { code: 'results-call', fils: 0, why: "Included in the brain map's price; never billed." },
  { code: 'nf-session', fils: 70_000, why: 'Opening price list.' },
];

/**
 * The three programmes. The list price is what the contents come to one at a
 * time; the price now is the founder's own launch figure, and no discount
 * percentage is stored anywhere (docs/SPEC/billing.md section 2.3, and the
 * founder's decision of 2026-09-03).
 */
const LAUNCH_REASON = "Launch pricing, ends on the founder's word.";
const PACKAGES: readonly {
  code: string;
  name: string;
  nameAr: string;
  listFils: number;
  nowFils: number;
  contents: { code: string; quantity: number }[];
}[] = [
  {
    code: 'silver',
    name: 'Silver',
    nameAr: 'الفضية',
    listFils: 1_215_000,
    nowFils: 1_032_500,
    contents: [
      { code: 'consultation', quantity: 1 },
      { code: 'brain-map', quantity: 2 },
      { code: 'nf-session', quantity: 15 },
    ],
  },
  {
    code: 'gold',
    name: 'Gold',
    nameAr: 'الذهبية',
    listFils: 1_997_500,
    nowFils: 1_697_500,
    contents: [
      { code: 'consultation', quantity: 2 },
      { code: 'brain-map', quantity: 3 },
      { code: 'nf-session', quantity: 25 },
    ],
  },
  {
    code: 'platinum',
    name: 'Platinum',
    nameAr: 'البلاتينية',
    listFils: 3_130_000,
    nowFils: 2_660_500,
    contents: [
      { code: 'consultation', quantity: 3 },
      { code: 'brain-map', quantity: 4 },
      { code: 'nf-session', quantity: 40 },
    ],
  },
];

/**
 * The VAT the seeded prices carry. Not a figure anyone types per price
 * (CLAUDE.md rule 6): it is the rate and version app.default_vat_setting()
 * writes for every new tenant (400_billing_catalogue.sql), restated here
 * because the generator is pure and reads no database, and proved equal to
 * the tenant's own vat_setting row in tests/db/seed.test.ts.
 */
const VAT_RATE_BASIS_POINTS = 500;
const VAT_SETTING_VERSION = 1;
/** The price list opens before the seed's own "today", so every price is in force. */
const PRICED_FROM = '2026-01-01';
/** Twelve months, the founder's decision of 2026-09-03; package.expiry_months's own default. */
const PACKAGE_EXPIRY_MONTHS = 12;

const CONSENT_PURPOSES: readonly ConsentPurpose[] = [
  'participation',
  'minor_participation',
  'home_visit',
  'photo_video',
  'research',
  'marketing',
];
const REFERRAL_SOURCES = ['website', 'word_of_mouth', 'instagram', 'school', 'coach'] as const;
const ADULT_AGES = [22, 27, 31, 34, 38, 41, 44, 47, 50, 53, 56, 58] as const;
const MINOR_AGES = [8, 9, 11, 12, 14, 15, 16, 17] as const;
const ARABIC_FIRST = new Set([2, 5, 8, 11, 14, 17, 19, 20]);
const PHOTO_CONSENT = new Set([5, 6, 17]);
const WITHDRAWN_PHOTO_CONSENT = 7;
const SECOND_PARENT = new Set([13, 17, 19]);

/**
 * The two households with a portal login (docs/CHANGE-REQUESTS/client-portal-05.md
 * item 7). Client 17 is an active fourteen-year-old with both parents on the
 * record; client 5 is an active Arabic-first adult who is her own contact.
 */
const PORTAL_LOGINS: readonly {
  client: number;
  relationship: Relationship;
  locale: 'en' | 'ar';
}[] = [
  { client: 17, relationship: 'mother', locale: 'en' },
  { client: 5, relationship: 'self', locale: 'ar' },
];

/** +971 50 000 1xxx: the reserved synthetic block. Tests keep 0001 to 0099. */
function phone(n: number): string {
  return `+97150000${String(1000 + n).padStart(4, '0')}`;
}

/**
 * 784-1900-NNNNNNN-C from the reserved fake range, with a real Luhn check digit
 * so a seeded identifier passes the same validation a captured one must, and
 * fixtures can be drawn from here (.claude/rules/testing.md).
 */
function emiratesId(seq: number): string {
  const digits = `7841900${String(seq).padStart(7, '0')}`;
  return `784-1900-${digits.slice(7)}-${luhnCheckDigit(digits)}`;
}

/** The check digit that makes `payload` + digit pass the Luhn test. */
export function luhnCheckDigit(payload: string): number {
  let sum = 0;
  for (let i = payload.length - 1, double = true; i >= 0; i--, double = !double) {
    let d = Number(payload[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

function email(local: string): string {
  return `${local.toLowerCase().replace(/[^a-z0-9.]/g, '')}@example.com`;
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * A day so many days before or after another. Calendar arithmetic on a plain
 * date, never on an instant: a seed that added `interval '90 days'` to a
 * timestamp would answer differently in a zone with daylight saving.
 */
function addDays(day: string, days: number): string {
  const at = new Date(`${day}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** A birthday earlier in the year than `today`, so the age is exactly `age` on that day. */
function birthDate(today: string, age: number, month: number, day: number): string {
  const year = Number(today.slice(0, 4)) - age;
  const todayMonth = Number(today.slice(5, 7));
  const safeMonth = Math.min(month, Math.max(1, todayMonth - 1));
  return isoDate(year, safeMonth, Math.min(day, 28));
}

function fullName(given: Name, family: Name): string {
  return `${given.en} ${family.en}`;
}

export function generateSeed(options: SeedOptions = {}): SeedData {
  const today = options.today ?? SEED_TODAY;
  const rng = seededRandom(options.seed ?? SEED_DEFAULT);

  const tenant: SeedTenant = {
    id: SEED_TENANT_ID,
    legalName: 'Synthetic Wellness Studio',
    legalNameAr: 'استوديو العافية التجريبي',
    trn: '000000000000000',
    licenceNumber: 'SYN-000000',
    licensingAuthority: 'Synthetic Department of Economy and Tourism',
    licenceExpiresOn: isoDate(Number(today.slice(0, 4)) + 1, 12, 31),
    vatRegistered: false,
    vatTrn: null,
    defaultEmirate: 'DXB',
    timezone: 'Asia/Dubai',
    whatsappNumber: phone(999),
  };

  const studio: SeedLocation = {
    id: seedId('7', 1),
    ownerType: 'tenant',
    ownerId: tenant.id,
    label: 'studio',
    emirate: 'DXB',
    makaniNumber: '0000000001',
    entrance: { lng: 55.26, lat: 25.19 },
    parking: { lng: 55.2605, lat: 25.1905 },
    displayAddress: 'Unit 1, Synthetic Tower, Dubai',
    accessNotes: null,
    isPrimary: true,
  };

  // People with logins. The owner is also the lead practitioner and holds the
  // admin and finance roles, as the practice runs today; a coordinator holds
  // admin alone so screens can tell an admin from the owner.
  const team: { given: Name; family: Name; roles: RoleKind[]; practitioner: boolean }[] = [
    {
      given: at(GIVEN_NAMES, 7),
      family: at(FAMILY_NAMES, 4),
      roles: ['owner', 'admin', 'finance', 'lead_practitioner'],
      practitioner: true,
    },
    {
      given: at(GIVEN_NAMES, 9),
      family: at(FAMILY_NAMES, 9),
      roles: ['practitioner'],
      practitioner: true,
    },
    {
      given: at(GIVEN_NAMES, 11),
      family: at(FAMILY_NAMES, 10),
      roles: ['practitioner'],
      practitioner: true,
    },
    {
      given: at(GIVEN_NAMES, 16),
      family: at(FAMILY_NAMES, 6),
      roles: ['admin'],
      practitioner: false,
    },
  ];
  const users: SeedUser[] = team.map((member, i) => ({
    id: seedId('2', i + 1),
    authId: seedId('3', i + 1),
    displayName: fullName(member.given, member.family),
    email: email(`${member.given.en}.${member.family.en}`),
    phone: phone(i + 1),
    preferredLocale: 'en',
  }));
  let roleCount = 0;
  const roles: SeedRole[] = team.flatMap((member, i) =>
    member.roles.map((role) => ({ id: seedId('c', ++roleCount), userId: at(users, i).id, role })),
  );

  const serviceTypes: SeedServiceType[] = SERVICES.map((service, i) => ({
    id: seedId('4', i + 1),
    ...service,
    deliveryModes: [...service.deliveryModes],
    preflightChecklist:
      service.code === 'nf-session' ? NF_PREFLIGHT.map((item) => ({ ...item })) : [],
    ratingQuestions: service.code === 'nf-session' ? NF_RATINGS.map((item) => ({ ...item })) : [],
  }));
  const service = (code: string): SeedServiceType => {
    const found = serviceTypes.find((s) => s.code === code);
    if (!found) throw new Error(`No service ${code}.`);
    return found;
  };

  const prices: SeedPrice[] = PRICES.map((row, i) => ({
    id: seedId('d0', i + 1),
    serviceTypeId: service(row.code).id,
    unitPriceFils: row.fils,
    vatRateBasisPoints: VAT_RATE_BASIS_POINTS,
    vatSettingVersion: VAT_SETTING_VERSION,
    validFrom: PRICED_FROM,
    amendmentReason: row.why,
  }));
  let componentCount = 0;
  const packages: SeedPackage[] = PACKAGES.map((bundle, i) => {
    const id = seedId('d1', i + 1);
    return {
      id,
      code: bundle.code,
      name: bundle.name,
      nameAr: bundle.nameAr,
      listPriceFils: bundle.listFils,
      expiryMonths: PACKAGE_EXPIRY_MONTHS,
      components: bundle.contents.map((line, lineNo) => ({
        id: seedId('d2', ++componentCount),
        packageId: id,
        serviceTypeId: service(line.code).id,
        quantity: line.quantity,
        lineNo: lineNo + 1,
      })),
      price: {
        id: seedId('d3', i + 1),
        amountFils: bundle.nowFils,
        vatRateBasisPoints: VAT_RATE_BASIS_POINTS,
        vatSettingVersion: VAT_SETTING_VERSION,
        validFrom: PRICED_FROM,
        amendmentReason: LAUNCH_REASON,
      },
    };
  });

  const practitioners: SeedPractitioner[] = team
    .map((member, i) => ({ member, user: at(users, i) }))
    .filter(({ member }) => member.practitioner)
    .map(({ member, user }, i) => ({
      id: seedId('5', i + 1),
      userId: user.id,
      displayNameAr: `${member.given.ar} ${member.family.ar}`,
      homeBaseLocationId: studio.id,
    }));

  /**
   * The equipment register (docs/CHANGE-REQUESTS/session-capture-04.md item 9).
   *
   * An amplifier apiece, calibrated last year and in date for another one, so
   * the staging demo's own visits check in; and one unassigned amplifier whose
   * calibration lapsed a month ago, so the block is demonstrable without
   * blocking anybody's day. That last row is the whole point of the pair: a
   * spare on the shelf is exactly the case "no item assigned is no block" was
   * written for, and a register with only in-date items would prove nothing.
   */
  const year = Number(today.slice(0, 4));
  const kit: SeedKit[] = [
    ...practitioners.map((person, i) => ({
      id: seedId('e', i + 1),
      serial: seedId('e', i + 1),
      model: 'Synthetic Bench Amplifier',
      kind: 'amplifier' as const,
      status: 'active' as const,
      assignedPractitionerId: person.id,
      lastCalibratedAt: `${isoDate(year - 1, 6, 1)}T08:00:00+04:00`,
      calibrationDueAt: `${isoDate(year + 1, 6, 1)}T08:00:00+04:00`,
    })),
    {
      id: seedId('e', 90),
      serial: seedId('e', 90),
      model: 'Synthetic Bench Amplifier',
      kind: 'amplifier',
      status: 'active',
      // Nobody's, so it stops nobody: the register can show an overdue item
      // without a demonstration turning into a day of refused check-ins.
      assignedPractitionerId: null,
      lastCalibratedAt: `${isoDate(year - 2, 6, 1)}T08:00:00+04:00`,
      calibrationDueAt: `${isoDate(year - 1, 6, 1)}T08:00:00+04:00`,
    },
  ];

  // Certifications: the owner may author, execute and sign; the second
  // practitioner executes both; the third executes sessions but their brain-map
  // certification has expired, so "not currently certified" exists in the data.
  const credentialRows: Omit<SeedCredential, 'id'>[] = [
    {
      practitionerId: at(practitioners, 0).id,
      serviceTypeId: service('nf-session').id,
      certification: 'bcia_bcn',
      certifyingBody: 'BCIA',
      certificateNumber: 'SYN-0001',
      validFrom: '2022-01-15',
      validTo: '2029-01-14',
      canAuthorProtocol: true,
      canExecuteSession: true,
      canSignReport: true,
    },
    {
      practitionerId: at(practitioners, 0).id,
      serviceTypeId: service('brain-map').id,
      certification: 'vendor_qeeg',
      certifyingBody: 'Equipment vendor',
      certificateNumber: 'SYN-0002',
      validFrom: '2023-03-01',
      validTo: null,
      canAuthorProtocol: false,
      canExecuteSession: true,
      canSignReport: true,
    },
    {
      practitionerId: at(practitioners, 1).id,
      serviceTypeId: service('nf-session').id,
      certification: 'bcia_bcn',
      certifyingBody: 'BCIA',
      certificateNumber: 'SYN-0003',
      validFrom: '2024-06-01',
      validTo: '2028-05-31',
      canAuthorProtocol: false,
      canExecuteSession: true,
      canSignReport: false,
    },
    {
      practitionerId: at(practitioners, 1).id,
      serviceTypeId: service('brain-map').id,
      certification: 'vendor_qeeg',
      certifyingBody: 'Equipment vendor',
      certificateNumber: 'SYN-0004',
      validFrom: '2024-06-01',
      validTo: null,
      canAuthorProtocol: false,
      canExecuteSession: true,
      canSignReport: false,
    },
    {
      practitionerId: at(practitioners, 2).id,
      serviceTypeId: service('nf-session').id,
      certification: 'bcia_bcn',
      certifyingBody: 'BCIA',
      certificateNumber: 'SYN-0005',
      validFrom: '2025-01-10',
      validTo: '2029-01-09',
      canAuthorProtocol: false,
      canExecuteSession: true,
      canSignReport: false,
    },
    {
      practitionerId: at(practitioners, 2).id,
      serviceTypeId: service('brain-map').id,
      certification: 'vendor_qeeg',
      certifyingBody: 'Equipment vendor',
      certificateNumber: 'SYN-0006',
      validFrom: '2023-01-01',
      validTo: '2025-06-30',
      canAuthorProtocol: false,
      canExecuteSession: true,
      canSignReport: false,
    },
  ];
  const credentials: SeedCredential[] = credentialRows.map((row, i) => ({
    id: seedId('6', i + 1),
    ...row,
  }));

  // The consent wording: one practice document per file in docs/CONSENT — no
  // client, immutable, carrying the file's own version and status and the
  // fingerprint of its actual bytes. The text is the practice's real words,
  // not a synthetic stand-in: a person signs the version they were shown.
  const documents: SeedDocument[] = (options.consentTexts ?? loadConsentTexts()).map((text) => {
    const purpose = text.purpose as ConsentPurpose;
    if (!CONSENT_PURPOSES.includes(purpose)) {
      throw new Error(
        `${text.file} names the consent purpose "${text.purpose}", which does not exist.`,
      );
    }
    // Keyed by what the wording IS, not by where it sat in the directory
    // listing: purpose, then language. Numbering by position meant adding a
    // ninth file — a research wording, say — silently renumbered every
    // wording sorting after it, and with it the storage key of each and the
    // text_document_id every seeded consent points at. Two digits per
    // purpose, one for the language: 11 is participation in English, 42
    // photo_video in Arabic.
    const id = seedId(
      'a',
      (CONSENT_PURPOSES.indexOf(purpose) + 1) * 10 + (text.locale === 'en' ? 1 : 2),
    );
    return {
      id,
      purpose,
      locale: text.locale,
      version: text.version,
      status: text.status,
      kind: 'consent_text' as const,
      storageKey: practiceDocumentKey(SEED_TENANT_ID, id),
      mimeType: CONSENT_TEXT_MIME_TYPE,
      sha256Hex: text.sha256Hex,
      file: text.file,
      bytes: text.bytes,
    };
  });
  /** The wording a person reading in this language was shown. */
  const wording = (purpose: ConsentPurpose, locale: 'en' | 'ar'): SeedDocument => {
    const found = documents.find((d) => d.purpose === purpose && d.locale === locale);
    if (!found)
      throw new Error(`No ${locale} wording for ${purpose}; docs/CONSENT has no such file.`);
    return found;
  };

  // Twenty clients: twelve adults (1 to 12) and eight minors (13 to 20).
  const locations: SeedLocation[] = [studio];
  const clients: SeedClient[] = [];
  const contacts: SeedContact[] = [];
  const consents: SeedConsent[] = [];
  let contactCount = 0;
  let consentCount = 0;
  let guardianCount = 0;

  const statusFor = (n: number): ClientStatus => {
    if ([1, 2, 13, 14].includes(n)) return 'lead';
    if ([3, 15].includes(n)) return 'paused';
    if ([4, 16].includes(n)) return 'closed';
    return 'active';
  };

  for (let n = 1; n <= 20; n++) {
    const minor = n > 12;
    const given = at(GIVEN_NAMES, n - 1);
    const family = rng.pick(FAMILY_NAMES);
    const arabicFirst = ARABIC_FIRST.has(n);
    const age = minor ? at(MINOR_AGES, n - 13) : at(ADULT_AGES, n - 1);
    const emirate = at(EMIRATES, (n - 1) % EMIRATES.length);
    const status = statusFor(n);
    const clientId = seedId('8', n);
    const locationId = seedId('7', n + 1);

    locations.push({
      id: locationId,
      ownerType: 'client',
      ownerId: clientId,
      label: 'home',
      emirate: emirate.code,
      makaniNumber: emirate.code === 'DXB' ? `00${String(n).padStart(8, '0')}` : null,
      entrance: {
        lng: Number((emirate.centre.lng + ((n - 1) % 5) * 0.01).toFixed(4)),
        lat: Number((emirate.centre.lat + Math.floor((n - 1) / 5) * 0.01).toFixed(4)),
      },
      parking:
        status === 'lead'
          ? null
          : {
              lng: Number((emirate.centre.lng + ((n - 1) % 5) * 0.01 + 0.0005).toFixed(4)),
              lat: Number((emirate.centre.lat + Math.floor((n - 1) / 5) * 0.01).toFixed(4)),
            },
      displayAddress: `Villa ${n}, Street ${(n % 9) + 1}, Synthetic Community, ${emirate.name}`,
      accessNotes: status === 'lead' ? null : rng.pick(['Gate on the left', 'Ring twice', null]),
      isPrimary: true,
    });

    // A contact's name, on the household's own family name: a mother and her
    // child share it, and an adult contact is the client. Arabic only where
    // the client carries Arabic, so a household reads as one household. The
    // given names come from a fixed offset into the list rather than from the
    // random source, so adding a name changes nothing else the seed produces.
    const named = (person: Name) => ({
      givenName: person.en,
      familyName: family.en,
      givenNameAr: arabicFirst ? person.ar : null,
      familyNameAr: arabicFirst ? family.ar : null,
    });

    const consentingContactId = seedId('9', contactCount + 1);
    if (minor) {
      const parent: Relationship = n % 2 === 1 ? 'mother' : 'father';
      contacts.push({
        id: seedId('9', ++contactCount),
        clientId,
        userId: null,
        ...named(at(GIVEN_NAMES, (n + 6) % GIVEN_NAMES.length)),
        relationship: parent,
        isLegalGuardian: true,
        canConsent: true,
        canReceiveReports: true,
        canPay: true,
        phone: phone(100 + contactCount),
        email: email(`${family.en}.${given.en}.${parent}`),
        whatsappOptIn: rng.chance(0.7),
        emiratesId: status === 'lead' ? null : emiratesId(++guardianCount),
      });
      if (SECOND_PARENT.has(n)) {
        const other: Relationship = parent === 'mother' ? 'father' : 'mother';
        contacts.push({
          id: seedId('9', ++contactCount),
          clientId,
          userId: null,
          ...named(at(GIVEN_NAMES, (n + 12) % GIVEN_NAMES.length)),
          relationship: other,
          isLegalGuardian: true,
          canConsent: false,
          canReceiveReports: true,
          canPay: false,
          phone: phone(100 + contactCount),
          email: email(`${family.en}.${given.en}.${other}`),
          whatsappOptIn: rng.chance(0.5),
          emiratesId: null,
        });
      }
    } else {
      contacts.push({
        id: seedId('9', ++contactCount),
        clientId,
        userId: null,
        ...named(given),
        relationship: 'self',
        isLegalGuardian: false,
        canConsent: true,
        canReceiveReports: true,
        canPay: true,
        phone: phone(100 + contactCount),
        email: email(`${given.en}.${family.en}`),
        whatsappOptIn: rng.chance(0.7),
        emiratesId: null,
      });
    }

    clients.push({
      id: clientId,
      mrn: `MW-${String(n).padStart(6, '0')}`,
      givenName: given.en,
      familyName: family.en,
      givenNameAr: arabicFirst ? given.ar : null,
      familyNameAr: arabicFirst ? family.ar : null,
      dateOfBirth: birthDate(today, age, rng.int(1, 8), rng.int(1, 28)),
      sexAtBirth: n % 5 === 0 ? 'unknown' : n % 2 === 0 ? 'male' : 'female',
      preferredLocale: arabicFirst ? 'ar' : 'en',
      primaryContactId: consentingContactId,
      primaryLocationId: locationId,
      referralSource: at(REFERRAL_SOURCES, (n - 1) % REFERRAL_SOURCES.length),
      status,
    });

    // Consents follow the activation rule (client-record.md section 3): every
    // client who has ever been active carries participation and home_visit,
    // plus minor_participation under 18. Leads have none yet.
    if (status !== 'lead') {
      const givenAt = `${isoDate(Number(today.slice(0, 4)) - 1, rng.int(1, 12), rng.int(1, 28))}T09:00:00+04:00`;
      const method: ConsentMethod =
        n % 7 === 0 ? 'paper_scan' : n === 11 ? 'verbal_witnessed' : 'app_signature';
      const purposes: ConsentPurpose[] = ['participation', 'home_visit'];
      if (minor) purposes.push('minor_participation');
      if (PHOTO_CONSENT.has(n)) purposes.push('photo_video');
      // One household changed its mind about photographs: an optional consent,
      // given and then withdrawn, so the seed carries that shape too.
      if (n === WITHDRAWN_PHOTO_CONSENT) purposes.push('photo_video');
      for (const purpose of purposes) {
        const withdrawn = n === WITHDRAWN_PHOTO_CONSENT && purpose === 'photo_video';
        consents.push({
          id: seedId('b', ++consentCount),
          clientId,
          givenByContactId: consentingContactId,
          purpose,
          // A first giving, never an amendment: see SeedConsent.version.
          version: 1,
          // The wording in the language this household reads: the version they were shown.
          textDocumentId: wording(purpose, arabicFirst ? 'ar' : 'en').id,
          status: withdrawn ? 'withdrawn' : 'active',
          givenAt,
          withdrawnAt: withdrawn ? `${today}T08:00:00+04:00` : null,
          method,
        });
      }
    }
  }

  // The two households in the client portal (docs/SPEC/client-portal.md,
  // docs/CHANGE-REQUESTS/client-portal-05.md item 7). Both are ordinary
  // contacts who happen to have been invited: a login is a `user_id` on a
  // contact row and nothing else.
  //
  // One of each shape the portal has to render. The mother of a fourteen-year
  // old with a second parent on the record reads in English and sees the
  // household's money, because a parent does; the Arabic-first adult is the
  // `self` contact of her own record and reads the portal right to left. A
  // young person's own login — the one case that sees no figure — is
  // deliberately not seeded: the rule is proved on the boundary day in
  // tests/portal/db, where the birthday can be moved, and a synthetic practice
  // is a poor place to invent a child's sign-in.
  for (const login of PORTAL_LOGINS) {
    const clientId = seedId('8', login.client);
    const contact = contacts.find(
      (c) => c.clientId === clientId && c.relationship === login.relationship,
    );
    if (!contact) {
      throw new Error(`No ${login.relationship} on client ${login.client} to give a login to.`);
    }
    const n = users.length + 1;
    const user: SeedUser = {
      id: seedId('2', n),
      authId: seedId('3', n),
      displayName: `${contact.givenName} ${contact.familyName}`,
      // Their own address, distinct from the contact row's: the account and
      // the contact are two records of the same person and the seed keeps
      // every address and every number unique so a test can tell them apart.
      email: email(`${contact.givenName}.${contact.familyName}.portal`),
      phone: phone(200 + users.length),
      preferredLocale: login.locale,
    };
    users.push(user);
    roles.push({ id: seedId('c', ++roleCount), userId: user.id, role: 'client_contact' });
    contact.userId = user.id;
  }

  /**
   * The measurements (docs/CHANGE-REQUESTS/assessment-01.md item 4).
   *
   * Three active households, each with a baseline brain map, a re-map ninety
   * days later and one questionnaire total on the baseline day. Five sites of
   * the ten-twenty map and all five bands, in microvolts squared, which is
   * enough for the comparison screen to have something to set side by side
   * without inventing a whole ninety-five-figure export.
   *
   * The reference age and sex are snapshots of what the software's own
   * comparison was made against, which for a fixture is the client's own age
   * on the day and their recorded sex — the point of the columns being that
   * the answer does not move afterwards when a birthday does.
   *
   * The recording practitioner is the one who holds a current brain-map
   * certification in this fixture (the second: the third's has expired, which
   * the credentials above deliberately arrange).
   */
  const assessments: SeedAssessment[] = [];
  const MEASURED_CLIENTS = [5, 6, 7] as const;
  const MAP_SITES = ['Fz', 'Cz', 'Pz', 'O1', 'O2'] as const;
  // The bands are `domain/shared/bands.ts`'s, not a sixth copy of the five:
  // a fixture whose bands could drift from the software's would prove nothing
  // about the screens and the reports it exists to fill.
  const SOFTWARE = { software: 'Synthetic Mapping Suite', softwareVersion: '3.2.1' };
  const mapFigures = () =>
    MAP_SITES.flatMap((site) =>
      BANDS.map((band) => ({
        site,
        band,
        value: Number((rng.int(200, 2400) / 100).toFixed(2)),
        unit: 'uV2',
      })),
    );
  let assessmentCount = 0;
  for (const n of MEASURED_CLIENTS) {
    const client = clients.find((row) => row.id === seedId('8', n));
    if (!client) continue;
    const practitioner = at(practitioners, 1);
    const baselineOn = addDays(today, -180);
    const remapOn = addDays(baselineOn, 90);
    for (const [index, day] of [baselineOn, remapOn].entries()) {
      assessments.push({
        id: seedId('f', ++assessmentCount),
        clientId: client.id,
        practitionerId: practitioner.id,
        performedAt: `${day}T09:00:00+04:00`,
        instrument: 'qeeg',
        instrumentVersion: '1',
        derived: {
          kind: 'brain-map',
          provenance: SOFTWARE,
          condition: 'eyes-closed',
          figures: mapFigures(),
        },
        conditionNote:
          index === 0
            ? 'Eyes closed, quiet room; the first minute carried an artefact.'
            : 'Eyes closed, quiet room.',
        referenceAgeYears: ageOn(client.dateOfBirth, day),
        referenceSex: client.sexAtBirth,
      });
    }
    const answers = ['q1', 'q2', 'q3'].map((key) => ({ key, value: rng.int(0, 4) }));
    assessments.push({
      id: seedId('f', ++assessmentCount),
      clientId: client.id,
      practitionerId: practitioner.id,
      performedAt: `${baselineOn}T11:00:00+04:00`,
      instrument: 'questionnaire.sample',
      instrumentVersion: '1',
      derived: {
        kind: 'questionnaire',
        provenance: SOFTWARE,
        answers,
        total: answers.reduce((sum, answer) => sum + answer.value, 0),
        maximum: 12,
      },
      conditionNote: null,
      // A questionnaire is a person's own answers on a day; there is no
      // reference database behind it and nothing to snapshot.
      referenceAgeYears: null,
      referenceSex: null,
    });
  }

  return {
    today,
    tenant,
    users,
    roles,
    serviceTypes,
    prices,
    packages,
    practitioners,
    credentials,
    kit,
    locations,
    clients,
    contacts,
    documents,
    consents,
    assessments,
  };
}

export { ageOn } from '../../domain/shared/dates';
