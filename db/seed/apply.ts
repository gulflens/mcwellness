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

/**
 * The contact rows, written by one statement that picks its own column list.
 *
 * `contact`'s four name columns arrive with migration 101, which belongs to the
 * client record's range. The seed has to fill a database migrated to either
 * side of it, so the choice is made in SQL rather than in TypeScript: the same
 * statement is rendered into the script that seeds a hosted project this
 * process never connects to, and a decision taken here against a laptop would
 * be the wrong decision there. `execute` keeps each shape unplanned until its
 * branch is taken, so a database without the columns never resolves them.
 *
 * The names go into the insert rather than into an update after it. An update
 * would be a second write on every contact, and the audit trail would carry
 * twenty-three changes to rows that were never changed — a trail that says a
 * name was amended when it was only ever recorded.
 *
 * Values travel through a transaction-local setting because a `do` block takes
 * no parameters; the rendered script inlines that one statement the way it
 * inlines every other. Sealed bytes go as hex, jsonb having no bytea of its
 * own, and `seq` keeps the rows in the order the generator built them.
 */
const CONTACTS_SETTING = 'app.seed_contacts';

type ContactColumn = {
  name: string;
  /** Its type in the record definition, which is what jsonb is read through. */
  type: string;
  /** How the value reaches the column, when it is not simply the field itself. */
  value?: string;
};

const CONTACT_COLUMNS: ContactColumn[] = [
  { name: 'id', type: 'uuid' },
  { name: 'tenant_id', type: 'uuid' },
  { name: 'client_id', type: 'uuid' },
  // The portal account, on the two contacts that have one (migration 700's
  // door is what puts a real sign-in behind it; the seed only links the row).
  { name: 'user_id', type: 'uuid' },
  { name: 'relationship', type: 'public.relationship' },
  { name: 'is_legal_guardian', type: 'boolean' },
  { name: 'can_consent', type: 'boolean' },
  { name: 'can_receive_reports', type: 'boolean' },
  { name: 'can_pay', type: 'boolean' },
  { name: 'phone', type: 'text' },
  { name: 'email', type: 'text' },
  { name: 'whatsapp_opt_in', type: 'boolean' },
  { name: 'emirates_id_encrypted', type: 'text', value: "decode(v.emirates_id_encrypted, 'hex')" },
  { name: 'emirates_id_hash', type: 'text', value: "decode(v.emirates_id_hash, 'hex')" },
  { name: 'created_by', type: 'uuid' },
];

/** Migration 101's four. Present in the payload always; in the statement only when the table has them. */
const CONTACT_NAME_COLUMNS: ContactColumn[] = [
  { name: 'given_name', type: 'text' },
  { name: 'family_name', type: 'text' },
  { name: 'given_name_ar', type: 'text' },
  { name: 'family_name_ar', type: 'text' },
];

/** Not a column of `contact`: the generator's own order, so the rows go in as they were built. */
const CONTACT_SEQUENCE: ContactColumn = { name: 'seq', type: 'int' };

function contactInsert(columns: ContactColumn[]): string {
  const definition = [...columns, CONTACT_SEQUENCE].map((c) => `${c.name} ${c.type}`).join(', ');
  return (
    `insert into public.contact (${columns.map((c) => c.name).join(', ')})\n` +
    `      select ${columns.map((c) => c.value ?? `v.${c.name}`).join(', ')}\n` +
    `        from pg_catalog.jsonb_to_recordset(` +
    `pg_catalog.current_setting('${CONTACTS_SETTING}')::jsonb)\n` +
    `          as v(${definition})\n` +
    `       order by v.seq`
  );
}

const INSERT_CONTACTS = `do $contacts$
begin
  -- All four, not one of them: a database part-way through the migration, or
  -- one where a column was renamed, is not a database these names fit.
  if (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'contact'
      and column_name in (${CONTACT_NAME_COLUMNS.map((c) => `'${c.name}'`).join(', ')})
  ) = ${CONTACT_NAME_COLUMNS.length} then
    execute $named$${contactInsert([...CONTACT_COLUMNS, ...CONTACT_NAME_COLUMNS])}$named$;
  else
    execute $plain$${contactInsert(CONTACT_COLUMNS)}$plain$;
  end if;
end
$contacts$`;

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

const SYNTHETIC_ID = /^0{6}[0-9a-f]{2}-0000-4000-8000-[0-9a-f]{12}$/;
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
    data.prices,
    data.packages,
    data.packages.flatMap((p) => p.components),
    data.packages.map((p) => p.price),
    data.practitioners,
    data.credentials,
    data.kit,
    data.locations,
    data.clients,
    data.contacts,
    data.documents,
    data.consents,
    data.assessments,
    data.appointments,
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
      legal_name_ar: t.legalNameAr,
      trn: t.trn,
      licence_number: t.licenceNumber,
      licensing_authority: t.licensingAuthority,
      licence_expires_on: t.licenceExpiresOn,
      vat_registered: t.vatRegistered,
      vat_trn: t.vatTrn,
      default_emirate: t.defaultEmirate,
      timezone: t.timezone,
      whatsapp_number: t.whatsappNumber,
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

    // The price list, then the programmes. Both after service_type, which they
    // reference, and both carrying the VAT rate and setting version stamped at
    // write time from vat_setting version 1 - the row 400_billing_catalogue.sql's
    // tenant trigger created when the tenant above was inserted (CLAUDE.md rule 6:
    // nobody types a rate).
    for (const p of data.prices) {
      await insert('price', {
        id: p.id,
        tenant_id: t.id,
        service_type_id: p.serviceTypeId,
        list_price_fils: p.listPriceFils,
        discount_fils: p.discountFils,
        discount_basis_points: p.discountBasisPoints,
        unit_price_fils: p.unitPriceFils,
        vat_rate_basis_points: p.vatRateBasisPoints,
        vat_setting_version: p.vatSettingVersion,
        valid_from: p.validFrom,
        amendment_reason: p.amendmentReason,
        created_by: owner,
      });
    }

    for (const p of data.packages) {
      await insert('package', {
        id: p.id,
        tenant_id: t.id,
        code: p.code,
        name: p.name,
        name_ar: p.nameAr,
        list_price_fils: p.listPriceFils,
        expiry_months: p.expiryMonths,
        created_by: owner,
      });
      for (const c of p.components) {
        await insert('package_component', {
          id: c.id,
          tenant_id: t.id,
          package_id: c.packageId,
          service_type_id: c.serviceTypeId,
          quantity: c.quantity,
          line_no: c.lineNo,
          created_by: owner,
        });
      }
      await insert('package_price', {
        id: p.price.id,
        tenant_id: t.id,
        package_id: p.id,
        list_price_fils: p.price.listPriceFils,
        discount_fils: p.price.discountFils,
        discount_basis_points: p.price.discountBasisPoints,
        amount_fils: p.price.amountFils,
        vat_rate_basis_points: p.price.vatRateBasisPoints,
        vat_setting_version: p.price.vatSettingVersion,
        valid_from: p.price.validFrom,
        amendment_reason: p.price.amendmentReason,
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

    // The studio, once it exists: tenant.location_id is a circular reference
    // (030_location.sql) so it can only be set after the row it names. Without
    // it the practice has an address nothing points at, and every invoice
    // app.stamp_invoice_supplier numbers carries a blank supplier address.
    const studio = data.locations.find((l) => l.ownerType === 'tenant');
    if (studio) {
      await client.query('update tenant set location_id = $1 where id = $2', [studio.id, t.id]);
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

    // The equipment register, after the practitioners it is assigned to
    // (docs/CHANGE-REQUESTS/session-capture-04.md item 9).
    for (const k of data.kit) {
      await insert('kit', {
        id: k.id,
        tenant_id: t.id,
        serial: k.serial,
        model: k.model,
        kind: k.kind,
        status: k.status,
        assigned_practitioner_id: k.assignedPractitionerId,
        last_calibrated_at: k.lastCalibratedAt,
        calibration_due_at: k.calibrationDueAt,
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
    // One statement for all of them, because the column list is the database's
    // to choose (see INSERT_CONTACTS). The audit trigger is per row, so the
    // trail reads exactly as it did when these were twenty-three inserts.
    await client.query(`select set_config('${CONTACTS_SETTING}', $1, true)`, [
      JSON.stringify(
        data.contacts.map((c, i) => {
          const sealed =
            c.emiratesId === null ? null : sealEmiratesId(c.emiratesId, keys, nonceFor(c.id), c.id);
          const hash = c.emiratesId === null ? null : emiratesIdHash(c.emiratesId, keys);
          return {
            seq: i + 1,
            id: c.id,
            tenant_id: t.id,
            client_id: c.clientId,
            user_id: c.userId,
            relationship: c.relationship,
            is_legal_guardian: c.isLegalGuardian,
            can_consent: c.canConsent,
            can_receive_reports: c.canReceiveReports,
            can_pay: c.canPay,
            phone: c.phone,
            email: c.email,
            whatsapp_opt_in: c.whatsappOptIn,
            emirates_id_encrypted: sealed === null ? null : sealed.toString('hex'),
            emirates_id_hash: hash === null ? null : hash.toString('hex'),
            created_by: owner,
            given_name: c.givenName,
            family_name: c.familyName,
            given_name_ar: c.givenNameAr,
            family_name_ar: c.familyNameAr,
          };
        }),
      ),
    ]);
    await client.query(INSERT_CONTACTS);
    // What the statement above wrote: it is one statement, so nothing counts it
    // for us, and the rows are the ones assertSynthetic already vouched for.
    counts.contact = data.contacts.length;
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

    // The measurements, last: they reference a client and a practitioner, and
    // nothing references them (docs/CHANGE-REQUESTS/assessment-01.md item 4).
    // No file is seeded against any of them, deliberately: an export is a
    // vendor's own PDF and there is no synthetic one to invent.
    for (const a of data.assessments) {
      await insert('assessment', {
        id: a.id,
        tenant_id: t.id,
        client_id: a.clientId,
        performed_by_practitioner_id: a.practitionerId,
        performed_at: a.performedAt,
        instrument: a.instrument,
        instrument_version: a.instrumentVersion,
        // jsonb: the text of the object, which Postgres casts.
        derived: JSON.stringify(a.derived),
        condition_note: a.conditionNote,
        reference_age_years: a.referenceAgeYears,
        reference_sex: a.referenceSex,
        created_by: owner,
      });
    }

    // The planning day (docs/SPEC/route-planning.md section 14): the visits
    // the day map draws and the optimiser reorders. Last of the practice's
    // rows, because an appointment names a client, a practitioner, a service
    // and a place, and every one of them has to exist first.
    for (const a of data.appointments) {
      await insert('appointment', {
        id: a.id,
        tenant_id: t.id,
        client_id: a.clientId,
        practitioner_id: a.practitionerId,
        service_type_id: a.serviceTypeId,
        location_id: a.locationId,
        delivery_mode: 'home',
        window_start: a.windowStart,
        window_end: a.windowEnd,
        travel_buffer_minutes: a.travelBufferMinutes,
        status: a.status,
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
    'price',
    'package',
    'package_component',
    'package_price',
    'practitioner',
    'credential',
    'kit',
    'location',
    'client',
    'contact',
    'document',
    'consent',
    'assessment',
    'appointment',
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
