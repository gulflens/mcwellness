import type { IsoDate, Role } from '../shared/actor';

/**
 * The shapes the client-record rules operate on. This is not the schema —
 * db/migrations owns that — it is the slice of a client's record each pure
 * function needs, so a caller can assemble it however it likes (a single
 * query, several joined rows, a cached read) without the rules caring.
 */

export const CLIENT_STATUSES = ['lead', 'active', 'paused', 'closed', 'erased'] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const CONSENT_PURPOSES = [
  'participation',
  'minor_participation',
  'home_visit',
  'health_data',
  'photo_video',
  'research',
  'marketing',
] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

/**
 * The purposes a screen may offer today.
 *
 * `photo_video`, `research` and `marketing` are absent deliberately: on the
 * legal advisor's recommendation of 9 September 2026 the practice takes no
 * photographs, and uses a household's information for nothing but that
 * household's own sessions. They stay in `CONSENT_PURPOSES` above because
 * consent rows already name them and history is not ours to rewrite — what
 * changed is what the practice asks for, not what the column may hold.
 */
export const OFFERED_CONSENT_PURPOSES = [
  'participation',
  'minor_participation',
  'home_visit',
  'health_data',
] as const satisfies readonly ConsentPurpose[];
export type OfferedConsentPurpose = (typeof OFFERED_CONSENT_PURPOSES)[number];

export const CONSENT_STATUSES = ['active', 'withdrawn', 'expired', 'superseded'] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export const RELATIONSHIPS = ['self', 'mother', 'father', 'guardian', 'spouse', 'other'] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

export const EMIRATES = ['DXB', 'AUH', 'SHJ', 'AJM', 'UAQ', 'RAK', 'FUJ'] as const;
export type Emirate = (typeof EMIRATES)[number];

export const LOCATION_LABELS = ['home', 'work', 'school', 'studio', 'base', 'other'] as const;
export type LocationLabel = (typeof LOCATION_LABELS)[number];

export const DELIVERY_MODES = ['home', 'studio', 'remote'] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];

/** The purposes `canActivate` can ever require (docs/SPEC/client-record.md section 3). */
export type RequiredConsentPurpose =
  'participation' | 'minor_participation' | 'home_visit' | 'health_data';

export type ClientRecordClient = {
  id: string;
  status: ClientStatus;
  dateOfBirth: IsoDate | null;
};

export type ClientRecordContact = {
  id: string;
  relationship: Relationship;
  isLegalGuardian: boolean;
  canConsent: boolean;
  userId: string | null;
};

export type ClientRecordLocation = {
  id: string;
  emirate: Emirate;
  hasVerifiedPin: boolean;
  label: LocationLabel;
  isPrimary: boolean;
};

export type ClientRecordConsent = {
  purpose: ConsentPurpose;
  status: ConsentStatus;
  givenByContactId: string;
  givenAt: IsoDate;
  expiresAt: IsoDate | null;
};

export type ClientRecord = {
  client: ClientRecordClient;
  contacts: ClientRecordContact[];
  locations: ClientRecordLocation[];
  consents: ClientRecordConsent[];
};

/** The narrow slice of a client `canViewClient` needs: nothing about the person, only the gate. */
export type ClientSummary = Pick<ClientRecordClient, 'id' | 'status'> & { tenantId: string };

/** The narrow slice of an actor `canViewClient` needs, matching `Actor` in domain/shared/actor. */
export type ViewingActor = { userId: string; tenantId: string; roles: readonly Role[] };

export type ViewClientContext = {
  /** Clients on this practitioner's own schedule. */
  scheduledClientIds: readonly string[];
  /** Clients this client_contact's own contact rows point at. */
  contactClientIds: readonly string[];
};
