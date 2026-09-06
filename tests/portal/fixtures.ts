import type {
  AgreementsResponse,
  FamilyResponse,
  HomeResponse,
  MoneyResponse,
  VisitsResponse,
} from '../../app/api/portal/schema';

/**
 * One synthetic household, as the routes answer it, for the screen tests.
 *
 * Everything is invented and stays in the reserved ranges
 * (.claude/rules/testing.md): names from `db/seed/names.ts`, telephone numbers
 * in the hand-written `+971 50 000 00xx` block, addresses at example.com and
 * ids of the form `0000000K-0000-4000-8000-*`.
 *
 * A household of two, because that is the shape that exercises the per-client
 * headings; a household of one is the same fixture with one client, and the
 * tests build it by taking the first.
 */

export const CHILD_A = '00000001-0000-4000-8000-000000000021';
export const CHILD_B = '00000001-0000-4000-8000-000000000022';
export const MOTHER_CONTACT = '00000001-0000-4000-8000-000000000003';
export const FATHER_CONTACT = '00000001-0000-4000-8000-00000000000b';
export const CONSENT = '00000001-0000-4000-8000-0000000000b4';
export const INVOICE_DOCUMENT = '00000001-0000-4000-8000-0000000000b6';

const CLIENTS = [
  { id: CHILD_A, name: 'Cedar Meadow', nameAr: 'أرز مرج', moneyVisible: true },
  { id: CHILD_B, name: 'Clover Meadow', nameAr: null, moneyVisible: true },
];

export const HOME: HomeResponse = {
  practice: {
    name: 'Synthetic Wellness Studio',
    nameAr: 'استوديو صناعي للعافية',
    whatsappNumber: '+971500000024',
    timezone: 'Asia/Dubai',
  },
  locale: 'en',
  clients: CLIENTS,
  nextVisit: {
    clientId: CHILD_A,
    date: '2026-09-08',
    windowStart: '2026-09-08T06:00:00.000Z',
    windowEnd: '2026-09-08T06:45:00.000Z',
    serviceName: 'Neurofeedback session',
    serviceNameAr: 'جلسة تدريب',
    deliveryMode: 'home',
  },
  money: [
    { clientId: CHILD_A, outstandingFils: 100_000, sessionsUsed: 1, sessionsTotal: 2 },
    { clientId: CHILD_B, outstandingFils: -25_000, sessionsUsed: null, sessionsTotal: null },
  ],
  notices: [
    {
      kind: 'consent_newer_wording',
      clientId: CHILD_A,
      entityId: CONSENT,
      detail: 'minor_participation',
    },
    {
      kind: 'request_open',
      clientId: CHILD_B,
      entityId: '00000001-0000-4000-8000-000000000041',
      detail: 'erasure',
    },
  ],
};

/**
 * The same record as a young person's own login sees it (section 3.3): one
 * client, and not one this person may be shown figures for. No tab, and no
 * money screen to open.
 */
export const HOME_NO_MONEY: HomeResponse = {
  ...HOME,
  clients: [{ ...CLIENTS[0]!, moneyVisible: false }],
  money: [],
  notices: [],
};

export const VISITS: VisitsResponse = {
  clients: CLIENTS,
  upcoming: [
    {
      id: '00000001-0000-4000-8000-0000000000a1',
      clientId: CHILD_A,
      date: '2026-09-08',
      windowStart: '2026-09-08T06:00:00.000Z',
      windowEnd: '2026-09-08T06:45:00.000Z',
      serviceName: 'Neurofeedback session',
      serviceNameAr: 'جلسة تدريب',
      deliveryMode: 'home',
      status: 'confirmed',
      outcome: null,
    },
  ],
  past: [
    {
      id: '00000001-0000-4000-8000-0000000000a3',
      clientId: CHILD_A,
      date: '2026-08-29',
      windowStart: '2026-08-29T08:00:00.000Z',
      windowEnd: '2026-08-29T08:45:00.000Z',
      serviceName: 'Neurofeedback session',
      serviceNameAr: 'جلسة تدريب',
      deliveryMode: 'studio',
      status: 'completed',
      outcome: 'completed',
    },
    {
      id: '00000001-0000-4000-8000-0000000000a8',
      clientId: CHILD_B,
      date: '2026-08-20',
      windowStart: '2026-08-20T08:00:00.000Z',
      windowEnd: '2026-08-20T08:45:00.000Z',
      serviceName: 'Neurofeedback session',
      serviceNameAr: 'جلسة تدريب',
      deliveryMode: 'home',
      status: 'cancelled_late',
      outcome: 'cancelled',
    },
  ],
};

export const MONEY: MoneyResponse = {
  clients: CLIENTS,
  balances: [
    { clientId: CHILD_A, outstandingFils: 100_000, sessionsUsed: null, sessionsTotal: null },
    { clientId: CHILD_B, outstandingFils: 0, sessionsUsed: null, sessionsTotal: null },
  ],
  packages: [
    {
      id: '00000001-0000-4000-8000-000000000062',
      clientId: CHILD_A,
      name: 'Silver',
      nameAr: 'الفضية',
      purchasedOn: '2026-08-01',
      expiresOn: '2027-08-01',
      used: 1,
      total: 2,
    },
  ],
  invoices: [
    {
      id: '00000001-0000-4000-8000-000000000065',
      clientId: CHILD_A,
      reference: 'INV-000001',
      issuedOn: '2026-08-01',
      grossFils: 140_000,
      waivedOn: null,
      documentId: INVOICE_DOCUMENT,
    },
    // A call-out fee the practice forgave: the number, the day and the figure
    // stay, and the row says what happened (billing-06.md request 1).
    {
      id: '00000001-0000-4000-8000-000000000069',
      clientId: CHILD_A,
      reference: 'INV-000002',
      issuedOn: '2026-08-20',
      grossFils: 15_000,
      waivedOn: '2026-08-21',
      documentId: null,
    },
  ],
  payments: [
    {
      id: '00000001-0000-4000-8000-000000000067',
      clientId: CHILD_A,
      receivedOn: '2026-08-02',
      method: 'transfer',
      amountFils: 40_000,
      receiptReference: 'RCT-000001',
      documentId: null,
    },
  ],
};

export const FAMILY: FamilyResponse = {
  clients: [
    {
      ...CLIENTS[0]!,
      address: { displayAddress: 'Villa 1, Street 2, Synthetic Community, Dubai', emirate: 'DXB' },
    },
    { ...CLIENTS[1]!, address: null },
  ],
  people: [
    {
      id: MOTHER_CONTACT,
      clientId: CHILD_A,
      name: 'Hazel Meadow',
      nameAr: null,
      relationship: 'mother',
      canConsent: true,
      canReceiveReports: true,
      canPay: true,
      phone: '+971500000021',
      email: 'hazel.meadow@example.com',
      whatsappOptIn: true,
      isYou: true,
    },
    {
      id: FATHER_CONTACT,
      clientId: CHILD_A,
      name: 'Jasper Meadow',
      nameAr: null,
      relationship: 'father',
      canConsent: false,
      canReceiveReports: true,
      canPay: false,
      phone: '+971500000023',
      email: null,
      whatsappOptIn: false,
      isYou: false,
    },
  ],
};

export const AGREEMENTS: AgreementsResponse = {
  clients: CLIENTS,
  agreements: [
    {
      id: CONSENT,
      clientId: CHILD_A,
      purpose: 'minor_participation',
      status: 'active',
      givenAt: '2026-08-01T06:00:00.000Z',
      withdrawnAt: null,
      givenByRelationship: 'mother',
      wordingDocumentId: '00000001-0000-4000-8000-0000000000b1',
      newerWordingExists: true,
      requestedWithdrawal: false,
    },
    {
      id: '00000001-0000-4000-8000-0000000000b8',
      clientId: CHILD_A,
      purpose: 'photo_video',
      status: 'withdrawn',
      givenAt: '2026-08-01T06:00:00.000Z',
      withdrawnAt: '2026-08-20T06:00:00.000Z',
      givenByRelationship: 'mother',
      wordingDocumentId: '00000001-0000-4000-8000-0000000000b9',
      newerWordingExists: false,
      requestedWithdrawal: false,
    },
  ],
  erasureRequested: [],
};

/** The same household with one client, which is the other shape every screen has. */
export function alone<T extends { clients: readonly unknown[] }>(answer: T): T {
  return { ...answer, clients: answer.clients.slice(0, 1) };
}
