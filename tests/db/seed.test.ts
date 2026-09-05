import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applySeed, isSeeded, type SeedCounts } from '../../db/seed/apply';
import {
  generateSeed,
  SEED_OWNER_USER_ID,
  SEED_REASON,
  SEED_TENANT_ID,
} from '../../db/seed/generate';
import { deriveIdentityKeys, openEmiratesId } from '../../domain/shared/identity';
import { normaliseEmiratesId } from '../../domain/shared/emirates-id';
import { asApiRole, freshDatabase, rolledBack } from './helpers';

// A test key that unlocks nothing outside this file.
const KEYS = deriveIdentityKeys(Buffer.alloc(32, 7));
const data = generateSeed();

// The tables the seed itself writes (00-data-model.md sections 2 and 3). A
// stream's own after-insert trigger on tenant (099_tenant_scoped_keys.sql's
// convention, docs/SPEC/00-data-model.md section 7) writes its default row
// under the same transaction and reason, so audit-row counts below are
// floored to this set rather than every row the seed's transaction produced.
const SEED_TABLES = [
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
];

let owner: pg.Client;
let counts: SeedCounts;

beforeAll(async () => {
  owner = await freshDatabase();
  expect(await isSeeded(owner)).toBe(false);
  counts = await applySeed(owner, data, KEYS);
});

afterAll(async () => {
  await owner.end();
});

/**
 * How many rows the seed goes back and updates: the circular references the
 * data model adds after the row they name (section 11) — every practitioner's
 * home base, every client's primary location and primary contact, and the
 * tenant's own studio.
 */
const SEED_UPDATES = 21;

async function count(table: string): Promise<number> {
  const { rows } = await owner.query<{ n: number }>(`select count(*)::int as n from ${table}`);
  return rows[0]?.n ?? -1;
}

describe('the synthetic seed', () => {
  it('writes every generated row and reports what it wrote', async () => {
    const expected: Record<string, number> = {
      tenant: 1,
      app_user: data.users.length,
      user_role: data.roles.length,
      service_type: data.serviceTypes.length,
      price: data.prices.length,
      package: data.packages.length,
      package_component: data.packages.reduce((n, p) => n + p.components.length, 0),
      package_price: data.packages.length,
      practitioner: data.practitioners.length,
      credential: data.credentials.length,
      location: data.locations.length,
      client: data.clients.length,
      contact: data.contacts.length,
      document: data.documents.length,
      consent: data.consents.length,
    };
    for (const [table, n] of Object.entries(expected)) {
      expect(await count(table), table).toBe(n);
      expect(counts[table], table).toBe(n);
    }
    expect(await isSeeded(owner)).toBe(true);
  });

  it('leaves the synthetic practice unregistered for VAT, with a synthetic licence', async () => {
    // Migration 905. The real practice is not VAT registered — registration
    // follows the AED 375,000 threshold (docs/SPEC/billing.md section 5.1) —
    // so the fixture is not either, and a screen built against it meets the
    // state it will actually meet. The licence is synthetic like every other
    // fact here: the practice's real identity is entered on staging by the
    // operator and never seeded.
    const { rows } = await owner.query<{
      legal_name_ar: string | null;
      licence_number: string | null;
      licensing_authority: string | null;
      vat_registered: boolean;
      vat_trn: string | null;
    }>(
      'select legal_name_ar, licence_number, licensing_authority, vat_registered, vat_trn ' +
        'from tenant where id = $1',
      [SEED_TENANT_ID],
    );
    expect(rows[0]).toEqual({
      legal_name_ar: data.tenant.legalNameAr,
      licence_number: data.tenant.licenceNumber,
      licensing_authority: data.tenant.licensingAuthority,
      vat_registered: false,
      vat_trn: null,
    });
  });

  it('stamps every price with the VAT the tenant trigger set, never a typed figure', async () => {
    // CLAUDE.md rule 6. The generator is pure and reads no database, so the
    // rate it carries is proved here against the row app.default_vat_setting()
    // wrote when the tenant was inserted, rather than trusted.
    const { rows: setting } = await owner.query<{ version: number; rate: number }>(
      'select version, rate_basis_points as rate from vat_setting where tenant_id = $1',
      [SEED_TENANT_ID],
    );
    expect(setting).toHaveLength(1);
    const { rows: stamped } = await owner.query<{ version: number; rate: number; n: number }>(
      'select vat_setting_version as version, vat_rate_basis_points as rate, count(*)::int as n ' +
        'from (select vat_setting_version, vat_rate_basis_points from price ' +
        'union all select vat_setting_version, vat_rate_basis_points from package_price) as stamped ' +
        'group by 1, 2',
    );
    expect(stamped).toHaveLength(1);
    expect(stamped[0]?.version).toBe(setting[0]?.version);
    expect(stamped[0]?.rate).toBe(setting[0]?.rate);
    expect(stamped[0]?.n).toBe(data.prices.length + data.packages.length);
  });

  it("lists each programme's contents against the practice's own price list", async () => {
    // The screen shows the list price beside what the bundle sells for, and
    // warns when the parts do not add up to the first. The seed must not be
    // the thing that raises that warning.
    const { rows } = await owner.query<{ code: string; list: number; total: number }>(
      'select p.code, p.list_price_fils as list, ' +
        'sum(c.quantity * pr.unit_price_fils)::int as total ' +
        'from package p ' +
        'join package_component c on c.package_id = p.id ' +
        'join price pr on pr.service_type_id = c.service_type_id ' +
        'group by p.code, p.list_price_fils order by p.list_price_fils',
    );
    expect(rows.map((r) => r.code)).toEqual(['silver', 'gold', 'platinum']);
    for (const row of rows) expect(row.total, row.code).toBe(row.list);
  });

  it('refuses to seed a second time and adds nothing', async () => {
    await expect(applySeed(owner, data, KEYS)).rejects.toThrow('already seeded');
    expect(await count('client')).toBe(20);
  });

  it('is visible through the API role only with the practice set', async () => {
    const seen = await rolledBack(owner, () =>
      asApiRole(owner, SEED_TENANT_ID, () => count('client')),
    );
    const unseen = await rolledBack(owner, () => asApiRole(owner, null, () => count('client')));
    expect(seen).toBe(20);
    expect(unseen).toBe(0);
  });

  it('records every row in the audit trail under the seed reason, as the owner', async () => {
    const { rows } = await owner.query<{ action: string; actor_id: string | null; n: number }>(
      'select action, actor_id, count(*)::int as n from audit_log where reason = $1 ' +
        'and entity_type = any($2) group by action, actor_id',
      [SEED_REASON, SEED_TABLES],
    );
    const inserted = Object.values(counts).reduce((sum, n) => sum + n, 0);
    const insertRows = rows.filter((r) => r.action === 'insert');
    expect(insertRows.reduce((sum, r) => sum + r.n, 0)).toBe(inserted);
    // The tenant and the owner are written as the system; everything else as the owner.
    expect(insertRows.find((r) => r.actor_id === null)?.n).toBe(2);
    expect(insertRows.find((r) => r.actor_id === SEED_OWNER_USER_ID)?.n).toBe(inserted - 2);
    // The circular references, each set after the row it names exists
    // (docs/SPEC/00-data-model.md section 11): a practitioner's home base, a
    // client's primary location and primary contact, and — from shared-zone
    // round 20 — the tenant's own studio. A number that moves is a row the
    // seed started or stopped writing, so it is changed deliberately or not
    // at all.
    expect(rows.find((r) => r.action === 'update')?.n).toBe(SEED_UPDATES);
    const { rows: roled } = await owner.query<{ n: number }>(
      'select count(*)::int as n from audit_log where reason = $1 and actor_id = $2 ' +
        'and actor_role = $3 and entity_type = any($4)',
      [SEED_REASON, SEED_OWNER_USER_ID, 'owner,admin,lead_practitioner,finance', SEED_TABLES],
    );
    expect(roled[0]?.n).toBe(inserted - 2 + SEED_UPDATES);
  });

  it('seals every Emirates ID with a lookup fingerprint and stores no digits in the clear', async () => {
    const { rows } = await owner.query<{
      id: string;
      emirates_id_encrypted: Buffer;
      emirates_id_hash: Buffer;
    }>(
      'select id, emirates_id_encrypted, emirates_id_hash from contact where emirates_id_hash is not null',
    );
    expect(rows).toHaveLength(data.contacts.filter((c) => c.emiratesId !== null).length);
    for (const row of rows) {
      const contact = data.contacts.find((c) => c.id === row.id);
      expect(contact?.emiratesId).toBeDefined();
      expect(openEmiratesId(row.emirates_id_encrypted, KEYS, row.id)).toBe(
        normaliseEmiratesId(contact?.emiratesId ?? ''),
      );
      expect(row.emirates_id_hash).toHaveLength(32);
      expect(row.emirates_id_encrypted.toString('latin1')).not.toContain('784');
    }
  });

  it('gives two households a portal login and the practice a WhatsApp number', async () => {
    const { rows } = await owner.query<{
      id: string;
      client_id: string;
      relationship: string;
      display_name: string;
      preferred_locale: string;
      roles: string[];
    }>(
      'select ct.id, ct.client_id, ct.relationship, u.display_name, u.preferred_locale, ' +
        '(select array_agg(r.role::text) from user_role r where r.user_id = u.id) as roles ' +
        'from contact ct join app_user u on u.id = ct.user_id order by ct.id',
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.roles).toEqual(['client_contact']);
      const contact = data.contacts.find((c) => c.id === row.id);
      expect(contact?.userId).not.toBeNull();
    }
    // One of each shape the portal renders: a parent reading in English, and
    // an Arabic-first adult who is her own contact.
    expect(rows.map((r) => r.relationship).sort()).toEqual(['mother', 'self']);
    expect(rows.map((r) => r.preferred_locale).sort()).toEqual(['ar', 'en']);

    const { rows: practice } = await owner.query<{ whatsapp_number: string }>(
      'select whatsapp_number from tenant where id = $1',
      [data.tenant.id],
    );
    expect(practice[0]?.whatsapp_number).toBe(data.tenant.whatsappNumber);
    expect(practice[0]?.whatsapp_number).toMatch(/^\+97150000[0-9]{4}$/);
  });

  it('resolves a seeded login to its roles and certifications', async () => {
    const { rows } = await owner.query<{ roles: string[]; capabilities: unknown[] }>(
      'select roles, capabilities from app.resolve_actor($1)',
      [data.users[0]?.authId],
    );
    // Postgres orders an enum by its declared order, not alphabetically.
    expect(rows[0]?.roles).toEqual(['owner', 'admin', 'lead_practitioner', 'finance']);
    expect(rows[0]?.capabilities).toHaveLength(2);
  });
});

// The four name columns arrive with migration 101, which belongs to the client
// record's range and is not on main yet, so the seed asks the database whether
// it has them (db/seed/apply.ts). Both answers are proved here rather than
// waiting for the merge: one database has the columns added by hand, the other
// has them removed, and each is a database this seed must fill.
const CONTACT_NAME_COLUMNS = ['given_name', 'family_name', 'given_name_ar', 'family_name_ar'];

async function withContactNameColumns(client: pg.Client): Promise<void> {
  await client.query(
    `alter table contact ${CONTACT_NAME_COLUMNS.map((c) => `add column if not exists ${c} text`).join(', ')}`,
  );
}

async function withoutContactNameColumns(client: pg.Client): Promise<void> {
  await client.query(
    `alter table contact ${CONTACT_NAME_COLUMNS.map((c) => `drop column if exists ${c}`).join(', ')}`,
  );
}

type ContactNameRow = {
  id: string;
  given_name: string | null;
  family_name: string | null;
  given_name_ar: string | null;
  family_name_ar: string | null;
};

const CONTACT_NAMES_QUERY =
  'select id, given_name, family_name, given_name_ar, family_name_ar from contact';

function expectEveryContactNamed(rows: ContactNameRow[]): void {
  expect(rows).toHaveLength(data.contacts.length);
  for (const row of rows) {
    const contact = data.contacts.find((c) => c.id === row.id);
    expect(contact, row.id).toBeDefined();
    expect(row.given_name, row.id).toBe(contact?.givenName);
    expect(row.family_name, row.id).toBe(contact?.familyName);
    expect(row.given_name_ar, row.id).toBe(contact?.givenNameAr);
    expect(row.family_name_ar, row.id).toBe(contact?.familyNameAr);
  }
}

/** How the audit trail read a contact: recorded once, and never amended after. */
async function contactAudit(client: pg.Client): Promise<{ inserts: number; updates: number }> {
  const { rows } = await client.query<{ action: string; n: number }>(
    'select action, count(*)::int as n from audit_log where reason = $1 ' +
      "and entity_type = 'contact' group by action",
    [SEED_REASON],
  );
  return {
    inserts: rows.find((r) => r.action === 'insert')?.n ?? 0,
    updates: rows.find((r) => r.action === 'update')?.n ?? 0,
  };
}

describe('a seeded contact carries a name', () => {
  it('writes all four columns when the database has them', async () => {
    const fresh = await freshDatabase();
    try {
      await withContactNameColumns(fresh);
      await applySeed(fresh, data, KEYS);
      const { rows } = await fresh.query<ContactNameRow>(CONTACT_NAMES_QUERY);
      expectEveryContactNamed(rows);
      // The name is part of recording the contact, not a change made to one:
      // one insert each, and not a single update anywhere in the trail.
      expect(await contactAudit(fresh)).toEqual({
        inserts: data.contacts.length,
        updates: 0,
      });
    } finally {
      await fresh.end();
    }
  });

  it('fills the same practice when the database has no name columns, and writes no name', async () => {
    const fresh = await freshDatabase();
    try {
      await withoutContactNameColumns(fresh);
      const counted = await applySeed(fresh, data, KEYS);
      expect(counted.contact).toBe(data.contacts.length);
      const { rows } = await fresh.query<{ column_name: string }>(
        'select column_name from information_schema.columns where table_schema = $1 ' +
          'and table_name = $2 and column_name = any($3)',
        ['public', 'contact', CONTACT_NAME_COLUMNS],
      );
      expect(rows).toHaveLength(0);
      // The same trail as the database that has them: nothing extra either way.
      expect(await contactAudit(fresh)).toEqual({
        inserts: data.contacts.length,
        updates: 0,
      });
    } finally {
      // The columns go back before the next file sees this database: six of
      // them do not reset it themselves, and app.erase_client reads all four.
      await withContactNameColumns(fresh);
      await fresh.end();
    }
  });
});

describe('the rendered seed script', () => {
  it('applied as plain SQL, yields exactly the practice applySeed writes, audited the same way', async () => {
    const { renderSeedSql } = await import('../../db/seed/render');
    const sql = await renderSeedSql(data, KEYS, { target: 'local' });
    expect(sql).not.toMatch(/\$\d/);
    expect(sql.split('\n')[0]).toContain('for a local database');
    const fresh = await freshDatabase();
    try {
      await fresh.query(sql);
      for (const [table, n] of Object.entries(counts)) {
        const { rows } = await fresh.query<{ n: number }>(
          `select count(*)::int as n from ${table}`,
        );
        expect(rows[0]?.n, table).toBe(n);
      }
      const inserted = Object.values(counts).reduce((sum, n) => sum + n, 0);
      const { rows } = await fresh.query<{ action: string; actor_id: string | null; n: number }>(
        'select action, actor_id, count(*)::int as n from audit_log where reason = $1 ' +
          'and request_id is not null and entity_type = any($2) group by action, actor_id',
        [SEED_REASON, SEED_TABLES],
      );
      const insertRows = rows.filter((r) => r.action === 'insert');
      expect(insertRows.find((r) => r.actor_id === null)?.n).toBe(2);
      expect(insertRows.find((r) => r.actor_id === SEED_OWNER_USER_ID)?.n).toBe(inserted - 2);
      expect(rows.find((r) => r.action === 'update')?.n).toBe(SEED_UPDATES);
      const { rows: roled } = await fresh.query<{ n: number }>(
        'select count(*)::int as n from audit_log where reason = $1 and actor_role = $2 ' +
          'and entity_type = any($3)',
        [SEED_REASON, 'owner,admin,lead_practitioner,finance', SEED_TABLES],
      );
      expect(roled[0]?.n).toBe(inserted - 2 + SEED_UPDATES);
      const { rows: sealed } = await fresh.query<{ id: string; emirates_id_encrypted: Buffer }>(
        'select id, emirates_id_encrypted from contact where emirates_id_hash is not null',
      );
      for (const row of sealed) {
        const contact = data.contacts.find((c) => c.id === row.id);
        expect(openEmiratesId(row.emirates_id_encrypted, KEYS, row.id)).toBe(
          normaliseEmiratesId(contact?.emiratesId ?? ''),
        );
      }

      // The guards travel inside the script: a second application is refused whole.
      await expect(fresh.query(sql)).rejects.toThrow('already holds a practice');
      const { rows: still } = await fresh.query<{ n: number }>(
        'select count(*)::int as n from client',
      );
      expect(still[0]?.n).toBe(20);
    } finally {
      await fresh.end();
    }
  });

  it('carries the same gate, so a hosted database with the columns gets the names', async () => {
    const { renderSeedSql } = await import('../../db/seed/render');
    const sql = await renderSeedSql(data, KEYS, { target: 'local' });
    const fresh = await freshDatabase();
    try {
      await withContactNameColumns(fresh);
      await fresh.query(sql);
      const { rows } = await fresh.query<ContactNameRow>(CONTACT_NAMES_QUERY);
      expectEveryContactNamed(rows);
    } finally {
      await fresh.end();
    }
  });

  it('stops before writing anything when applied statement by statement', async () => {
    const { renderSeedSql } = await import('../../db/seed/render');
    const sql = await renderSeedSql(data, KEYS, { target: 'local' });
    const lines = sql.split('\n').filter((l) => l !== '' && !l.startsWith('--'));
    const at = lines.findIndex((l) => l.startsWith("select set_config('app.reason'"));
    expect(at).toBeGreaterThan(0);
    const fresh = await freshDatabase();
    try {
      // Outside a transaction the transaction-local context evaporates after its own statement.
      await fresh.query(lines[at] ?? '');
      await expect(fresh.query(lines[at + 1] ?? '')).rejects.toThrow('one transaction');
      const { rows } = await fresh.query<{ n: number }>('select count(*)::int as n from tenant');
      expect(rows[0]?.n).toBe(0);
    } finally {
      await fresh.end();
    }
  });

  it('renders for a hosted database only when APP_ENV says staging', async () => {
    const { renderSeedSql } = await import('../../db/seed/render');
    const before = process.env.APP_ENV;
    try {
      process.env.APP_ENV = 'development';
      await expect(renderSeedSql(data, KEYS, { target: 'hosted' })).rejects.toThrow(
        'APP_ENV=staging',
      );
      process.env.APP_ENV = 'staging';
      expect((await renderSeedSql(data, KEYS, { target: 'hosted' })).split('\n')[0]).toContain(
        'for a hosted database (APP_ENV=staging)',
      );
    } finally {
      process.env.APP_ENV = before;
    }
  });
});
