import { practiceDocumentKey } from '../../domain/shared/storage';
import { CONSENT_TEXT_MIME_TYPE, loadConsentTexts, type ConsentText } from './consent-text';
import { FAMILY_NAMES, GIVEN_NAMES, type Name } from './names';
import { at, seededRandom } from './random';

/**
 * The synthetic practice: one tenant, four people with logins, three
 * practitioners with certifications, six services, twenty clients with
 * contacts, home locations and consents. Pure: the same options give the same
 * output, byte for byte. Every value is inside the reserved fake ranges
 * (.claude/rules/testing.md): ids of the form 0000000K-0000-4000-8000-*, phones
 * +971 50 000 1xxx, emails at example.com, Emirates IDs 784-1900-*, names from
 * ./names.ts. Nothing here describes a real person.
 */

export type Emirate = 'DXB' | 'AUH' | 'SHJ' | 'AJM' | 'UAQ' | 'RAK' | 'FUJ';
export type RoleKind = 'owner' | 'admin' | 'lead_practitioner' | 'practitioner' | 'finance';
export type DeliveryMode = 'home' | 'studio' | 'remote';
export type ClientStatus = 'lead' | 'active' | 'paused' | 'closed';
export type Relationship = 'self' | 'mother' | 'father';
export type ConsentPurpose =
  'participation' | 'minor_participation' | 'home_visit' | 'photo_video' | 'research' | 'marketing';
export type ConsentMethod = 'app_signature' | 'paper_scan' | 'verbal_witnessed';

export type SeedTenant = {
  id: string;
  legalName: string;
  trn: string;
  defaultEmirate: Emirate;
  timezone: string;
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
  practitioners: SeedPractitioner[];
  credentials: SeedCredential[];
  locations: SeedLocation[];
  clients: SeedClient[];
  contacts: SeedContact[];
  documents: SeedDocument[];
  consents: SeedConsent[];
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

/** 0000000K-0000-4000-8000-000000000NNN: readable, fixed, and shaped like a v4 uuid. */
export function seedId(kind: string, n: number): string {
  return `0000000${kind}-0000-4000-8000-${String(n).padStart(12, '0')}`;
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

const SERVICES: readonly Omit<SeedServiceType, 'id' | 'preflightChecklist' | 'ratingQuestions'>[] =
  [
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
    key: 'environment',
    label_en: 'Environment suitable: quiet, seated, well lit',
    label_ar: 'البيئة مناسبة: هادئة، مقعد مريح، إضاءة جيدة',
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
    trn: '000000000000000',
    defaultEmirate: 'DXB',
    timezone: 'Asia/Dubai',
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

  const practitioners: SeedPractitioner[] = team
    .map((member, i) => ({ member, user: at(users, i) }))
    .filter(({ member }) => member.practitioner)
    .map(({ member, user }, i) => ({
      id: seedId('5', i + 1),
      userId: user.id,
      displayNameAr: `${member.given.ar} ${member.family.ar}`,
      homeBaseLocationId: studio.id,
    }));

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
  const documents: SeedDocument[] = (options.consentTexts ?? loadConsentTexts()).map((text, i) => {
    const purpose = text.purpose as ConsentPurpose;
    if (!CONSENT_PURPOSES.includes(purpose)) {
      throw new Error(
        `${text.file} names the consent purpose "${text.purpose}", which does not exist.`,
      );
    }
    const id = seedId('a', i + 1);
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

    const consentingContactId = seedId('9', contactCount + 1);
    if (minor) {
      const parent: Relationship = n % 2 === 1 ? 'mother' : 'father';
      contacts.push({
        id: seedId('9', ++contactCount),
        clientId,
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

  return {
    today,
    tenant,
    users,
    roles,
    serviceTypes,
    practitioners,
    credentials,
    locations,
    clients,
    contacts,
    documents,
    consents,
  };
}

export { ageOn } from '../../domain/shared/dates';
