import { createHash, randomUUID } from 'node:crypto';
import { emiratesIdHash, sealEmiratesId, type IdentityKeys } from '../../domain/shared/identity';
import { isLocalHost } from '../runner/plan';
import { SEED_OWNER_USER_ID, SEED_REASON, SEED_TENANT_ID, type SeedData } from './generate';

/** What applySeed needs from a connection: a query, and the host it reaches. */
export type SeedClient = {
  host?: string | undefined;
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
};

/**
 * Writes the synthetic practice into a database, in one transaction, with the
 * audit context set so every row's trail reads "synthetic seed". The tenant and
 * the owner are written as the system; everything after them is written as the
 * owner, the way a practice creates its own records.
 */

export type SeedCounts = Record<string, number>;

type Row = Record<string, unknown>;
type Wrap = Record<string, (placeholder: string) => string>;

const GEOGRAPHY: Wrap[string] = (p) => `extensions.st_geogfromtext(${p})`;
const HEX: Wrap[string] = (p) => `decode(${p}, 'hex')`;

function point(p: { lng: number; lat: number } | null): string | null {
  return p === null ? null : `SRID=4326;POINT(${p.lng} ${p.lat})`;
}

/** A nonce that never repeats across contacts and never changes for one, so the seed is stable. */
function nonceFor(contactId: string): Buffer {
  return createHash('sha256').update(`mcwellness-seed-nonce:${contactId}`).digest().subarray(0, 12);
}

/**
 * Where the seed may write: a local database always, a Supabase project only when
 * APP_ENV says staging, production never. Returns the refusal, or null.
 */
export function seedTargetError(
  host: string | undefined,
  appEnv: string | undefined,
): string | null {
  const local = host !== undefined && isLocalHost(host);
  if (appEnv === 'production') return 'The seed never runs against production.';
  if (!local && appEnv !== 'staging') {
    return 'The seed runs against a local database, or a staging project only when APP_ENV=staging.';
  }
  return null;
}

const SYNTHETIC_ID = /^0000000[0-9a-f]-0000-4000-8000-[0-9a-f]{12}$/;
const SYNTHETIC_PHONE = /^\+97150000\d{4}$/;
const SYNTHETIC_EMAIL = /@example\.com$/;
const SYNTHETIC_EMIRATES_ID = /^7841900\d{8}$/;

/**
 * "Synthetic" is a property the write path enforces, not one the caller promises:
 * every id, phone, email and Emirates ID must sit in the reserved ranges
 * generate.ts documents, whichever way the data arrived.
 */
export function assertSynthetic(data: SeedData): void {
  const refuse = (what: string): never => {
    throw new Error(`The seed writes synthetic data only: ${what}.`);
  };
  if (data.tenant.id !== SEED_TENANT_ID) refuse('the tenant is not the synthetic practice');
  const collections: Array<{ id: string }[]> = [
    data.users,
    data.roles,
    data.serviceTypes,
    data.practitioners,
    data.credentials,
    data.locations,
    data.clients,
    data.contacts,
    data.documents,
    data.consents,
  ];
  for (const rows of collections) {
    for (const row of rows) {
      if (!SYNTHETIC_ID.test(row.id)) refuse(`id ${row.id} is outside the reserved range`);
    }
  }
  for (const u of data.users) {
    if (!SYNTHETIC_PHONE.test(u.phone)) refuse('a phone is outside the reserved block');
    if (!SYNTHETIC_EMAIL.test(u.email)) refuse('an email is not at example.com');
  }
  for (const c of data.contacts) {
    if (!SYNTHETIC_PHONE.test(c.phone)) refuse('a phone is outside the reserved block');
    if (!SYNTHETIC_EMAIL.test(c.email)) refuse('an email is not at example.com');
    if (c.emiratesId !== null && !SYNTHETIC_EMIRATES_ID.test(c.emiratesId.replace(/\D/g, ''))) {
      refuse('an Emirates ID is outside the 784-1900 range');
    }
  }
}

export async function isSeeded(client: SeedClient): Promise<boolean> {
  const { rows } = await client.query('select 1 from tenant where id = $1', [SEED_TENANT_ID]);
  return rows.length > 0;
}

export async function applySeed(
  client: SeedClient,
  data: SeedData,
  keys: IdentityKeys,
): Promise<SeedCounts> {
  // The guards travel with the write: here for a connection, and rendered into the
  // script for a paste (render.ts), since only the database is present when that runs.
  const refusal = seedTargetError(client.host, process.env.APP_ENV);
  if (refusal !== null) {
    throw new Error(refusal);
  }
  assertSynthetic(data);
  if (await isSeeded(client)) {
    throw new Error('The synthetic practice is already seeded; nothing added.');
  }
  const counts: SeedCounts = {};
  const insert = async (table: string, row: Row, wrap: Wrap = {}): Promise<void> => {
    const columns = Object.keys(row);
    const values = columns.map((column, i) => (wrap[column] ?? ((p) => p))(`$${i + 1}`));
    await client.query(
      `insert into ${table} (${columns.join(', ')}) values (${values.join(', ')})`,
      columns.map((column) => row[column]),
    );
    counts[table] = (counts[table] ?? 0) + 1;
  };
  const owner = SEED_OWNER_USER_ID;

  await client.query('begin');
  try {
    await client.query(
      "select set_config('app.reason', $1, true), set_config('app.request_id', $2, true)",
      [SEED_REASON, randomUUID()],
    );

    const t = data.tenant;
    await insert('tenant', {
      id: t.id,
      legal_name: t.legalName,
      trn: t.trn,
      default_emirate: t.defaultEmirate,
      timezone: t.timezone,
    });

    for (const u of data.users) {
      await insert('app_user', {
        id: u.id,
        tenant_id: t.id,
        auth_id: u.authId,
        display_name: u.displayName,
        email: u.email,
        phone: u.phone,
        preferred_locale: u.preferredLocale,
        created_by: u.id === owner ? null : owner,
      });
      if (u.id === owner) {
        // From here on the owner is the actor, with the roles they hold, as a request would stamp them.
        await client.query(
          "select set_config('app.actor_id', $1, true), set_config('app.actor_roles', $2, true)",
          [owner, ownerRoles(data)],
        );
      }
    }

    for (const r of data.roles) {
      await insert('user_role', {
        id: r.id,
        tenant_id: t.id,
        user_id: r.userId,
        role: r.role,
        granted_by: owner,
        created_by: owner,
      });
    }

    for (const s of data.serviceTypes) {
      await insert('service_type', {
        id: s.id,
        tenant_id: t.id,
        code: s.code,
        name: s.name,
        name_ar: s.nameAr,
        duration_minutes: s.durationMinutes,
        requires_certification: s.requiresCertification,
        delivery_modes: s.deliveryModes,
        // jsonb columns (migration 901): the text of the array, which Postgres casts.
        preflight_checklist: JSON.stringify(s.preflightChecklist),
        rating_questions: JSON.stringify(s.ratingQuestions),
        created_by: owner,
      });
    }

    for (const l of data.locations) {
      await insert(
        'location',
        {
          id: l.id,
          tenant_id: t.id,
          owner_type: l.ownerType,
          owner_id: l.ownerId,
          label: l.label,
          emirate: l.emirate,
          makani_number: l.makaniNumber,
          entrance_point: point(l.entrance),
          parking_point: point(l.parking),
          display_address: l.displayAddress,
          access_notes: l.accessNotes,
          is_primary: l.isPrimary,
          created_by: owner,
        },
        { entrance_point: GEOGRAPHY, parking_point: GEOGRAPHY },
      );
    }

    for (const p of data.practitioners) {
      await insert('practitioner', {
        id: p.id,
        tenant_id: t.id,
        user_id: p.userId,
        display_name_ar: p.displayNameAr,
        home_base_location_id: p.homeBaseLocationId,
        created_by: owner,
      });
    }

    for (const c of data.credentials) {
      await insert('credential', {
        id: c.id,
        tenant_id: t.id,
        practitioner_id: c.practitionerId,
        service_type_id: c.serviceTypeId,
        certification: c.certification,
        certifying_body: c.certifyingBody,
        certificate_number: c.certificateNumber,
        valid_from: c.validFrom,
        valid_to: c.validTo,
        can_author_protocol: c.canAuthorProtocol,
        can_execute_session: c.canExecuteSession,
        can_sign_report: c.canSignReport,
        created_by: owner,
      });
    }

    for (const d of data.documents) {
      // retention_until is deliberately absent, and so null. A practice
      // document is otherwise kept five years from upload
      // (domain/shared/storage.ts, migration 903), but consent wording is
      // exempt from that clock: it is kept while any consent still points at
      // it and the last of those clients is still within their own retention.
      // Null here means "not on an upload clock", never "nobody computed it".
      await insert(
        'document',
        {
          id: d.id,
          tenant_id: t.id,
          client_id: null,
          kind: d.kind,
          purpose: d.purpose,
          locale: d.locale,
          version: d.version,
          status: d.status,
          storage_key: d.storageKey,
          mime_type: d.mimeType,
          sha256: d.sha256Hex,
          uploaded_by: owner,
          is_immutable: true,
          created_by: owner,
        },
        { sha256: HEX },
      );
    }

    // A client points at its primary contact and a contact at its client, so
    // the client is written first, then its contacts, then the link.
    for (const c of data.clients) {
      await insert('client', {
        id: c.id,
        tenant_id: t.id,
        mrn: c.mrn,
        given_name: c.givenName,
        family_name: c.familyName,
        given_name_ar: c.givenNameAr,
        family_name_ar: c.familyNameAr,
        date_of_birth: c.dateOfBirth,
        sex_at_birth: c.sexAtBirth,
        preferred_locale: c.preferredLocale,
        primary_location_id: c.primaryLocationId,
        referral_source: c.referralSource,
        status: c.status,
        created_by: owner,
      });
    }
    for (const c of data.contacts) {
      const sealed =
        c.emiratesId === null ? null : sealEmiratesId(c.emiratesId, keys, nonceFor(c.id), c.id);
      const hash = c.emiratesId === null ? null : emiratesIdHash(c.emiratesId, keys);
      await insert('contact', {
        id: c.id,
        tenant_id: t.id,
        client_id: c.clientId,
        relationship: c.relationship,
        is_legal_guardian: c.isLegalGuardian,
        can_consent: c.canConsent,
        can_receive_reports: c.canReceiveReports,
        can_pay: c.canPay,
        phone: c.phone,
        email: c.email,
        whatsapp_opt_in: c.whatsappOptIn,
        emirates_id_encrypted: sealed,
        emirates_id_hash: hash,
        created_by: owner,
      });
    }
    for (const c of data.clients) {
      await client.query('update client set primary_contact_id = $1 where id = $2', [
        c.primaryContactId,
        c.id,
      ]);
    }

    for (const c of data.consents) {
      await insert('consent', {
        id: c.id,
        tenant_id: t.id,
        client_id: c.clientId,
        given_by_contact_id: c.givenByContactId,
        purpose: c.purpose,
        version: c.version,
        text_document_id: c.textDocumentId,
        status: c.status,
        given_at: c.givenAt,
        withdrawn_at: c.withdrawnAt,
        method: c.method,
        created_by: owner,
      });
    }

    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }
  return counts;
}

export function describeSeed(counts: SeedCounts): string {
  const order = [
    'tenant',
    'app_user',
    'user_role',
    'service_type',
    'practitioner',
    'credential',
    'location',
    'client',
    'contact',
    'document',
    'consent',
  ];
  const parts = order.filter((table) => counts[table]).map((table) => `${counts[table]} ${table}`);
  return `Seeded the synthetic practice: ${parts.join(', ')}.`;
}

const ROLE_ORDER = ['owner', 'admin', 'lead_practitioner', 'practitioner', 'finance'] as const;

/** The owner's roles in the order the resolver returns them, comma-joined as the middleware stamps them. */
function ownerRoles(data: SeedData): string {
  return ROLE_ORDER.filter((role) =>
    data.roles.some((r) => r.userId === SEED_OWNER_USER_ID && r.role === role),
  ).join(',');
}
