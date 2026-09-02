import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { emiratesIdHash, sealEmiratesId, type IdentityKeys } from '../../domain/shared/identity';
import { SEED_OWNER_USER_ID, SEED_REASON, SEED_TENANT_ID, type SeedData } from './generate';

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
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (appEnv === 'production') return 'The seed never runs against production.';
  if (!local && appEnv !== 'staging') {
    return 'The seed runs against a local database, or a staging project only when APP_ENV=staging.';
  }
  return null;
}

export async function isSeeded(client: pg.Client): Promise<boolean> {
  const { rows } = await client.query('select 1 from tenant where id = $1', [SEED_TENANT_ID]);
  return rows.length > 0;
}

export async function applySeed(
  client: pg.Client,
  data: SeedData,
  keys: IdentityKeys,
): Promise<SeedCounts> {
  // The guard travels with the write, not only with the command that calls it.
  const refusal = seedTargetError(client.host, process.env.APP_ENV);
  if (refusal !== null) {
    throw new Error(refusal);
  }
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
      await insert(
        'document',
        {
          id: d.id,
          tenant_id: t.id,
          client_id: null,
          kind: d.kind,
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
