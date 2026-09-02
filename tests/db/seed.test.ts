import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applySeed, isSeeded, type SeedCounts } from '../../db/seed/apply';
import {
  generateSeed,
  SEED_OWNER_USER_ID,
  SEED_REASON,
  SEED_TENANT_ID,
} from '../../db/seed/generate';
import { deriveIdentityKeys, normaliseEmiratesId, openEmiratesId } from '../../domain/shared';
import { asApiRole, freshDatabase, rolledBack } from './helpers';

// A test key that unlocks nothing outside this file.
const KEYS = deriveIdentityKeys(Buffer.alloc(32, 7));
const data = generateSeed();

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
        'group by action, actor_id',
      [SEED_REASON],
    );
    const inserted = Object.values(counts).reduce((sum, n) => sum + n, 0);
    const insertRows = rows.filter((r) => r.action === 'insert');
    expect(insertRows.reduce((sum, r) => sum + r.n, 0)).toBe(inserted);
    // The tenant and the owner are written as the system; everything else as the owner.
    expect(insertRows.find((r) => r.actor_id === null)?.n).toBe(2);
    expect(insertRows.find((r) => r.actor_id === SEED_OWNER_USER_ID)?.n).toBe(inserted - 2);
    expect(rows.find((r) => r.action === 'update')?.n).toBe(20);
    const { rows: roled } = await owner.query<{ n: number }>(
      'select count(*)::int as n from audit_log where reason = $1 and actor_id = $2 and actor_role = $3',
      [SEED_REASON, SEED_OWNER_USER_ID, 'owner,admin,lead_practitioner,finance'],
    );
    expect(roled[0]?.n).toBe(inserted - 2 + 20);
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

describe('the rendered seed script', () => {
  it('applied as plain SQL, yields exactly the practice applySeed writes', async () => {
    const { renderSeedSql } = await import('../../db/seed/render');
    const sql = await renderSeedSql(data, KEYS);
    expect(sql).not.toMatch(/\$\d/);
    const fresh = await freshDatabase();
    try {
      await fresh.query('begin');
      await fresh.query(sql);
      await fresh.query('commit');
      const { rows } = await fresh.query<{ n: number }>('select count(*)::int as n from client');
      expect(rows[0]?.n).toBe(data.clients.length);
      const { rows: sealed } = await fresh.query<{ n: number }>(
        'select count(*)::int as n from contact where emirates_id_hash is not null',
      );
      expect(sealed[0]?.n).toBe(data.contacts.filter((c) => c.emiratesId !== null).length);
      const { rows: audited } = await fresh.query<{ n: number }>(
        "select count(*)::int as n from audit_log where reason = 'synthetic seed'",
      );
      expect(audited[0]?.n).toBeGreaterThan(0);
    } finally {
      await fresh.end();
    }
  });
});
