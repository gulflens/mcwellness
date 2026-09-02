import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  IDS,
  PHONES,
  freshDatabase,
  rejectsWith,
  rolledBack,
  seedClient,
  seedTenant,
} from './helpers';

const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const INVALID_ENUM = '22P02';

let client: pg.Client;

beforeAll(async () => {
  client = await freshDatabase();
  await seedTenant(client, IDS.tenantA, IDS.ownerA, 'Synthetic Clinic A');
  await seedTenant(client, IDS.tenantB, IDS.ownerB, 'Synthetic Clinic B');
  await seedClient(client, IDS.tenantA, IDS.clientA, IDS.ownerA, 'Alpha');
});

afterAll(async () => {
  await client.end();
});

describe('phone numbers', () => {
  it('accepts E.164 and refuses a local format', async () => {
    await rolledBack(client, async () => {
      await client.query(
        "insert into contact (tenant_id, client_id, relationship, phone) values ($1, $2, 'mother', $3)",
        [IDS.tenantA, IDS.clientA, PHONES.second],
      );
      await rejectsWith(
        client,
        CHECK_VIOLATION,
        "insert into contact (tenant_id, client_id, relationship, phone) values ($1, $2, 'mother', '0500000002')",
        [IDS.tenantA, IDS.clientA],
      );
    });
  });
});

describe('locations', () => {
  const insert =
    'insert into location (tenant_id, owner_type, owner_id, label, emirate, makani_number, entrance_point) ' +
    "values ($1, 'client', $2, 'home', $3, $4, extensions.st_geogfromtext('SRID=4326;POINT(55.27 25.20)'))";

  it('accepts a ten-digit Makani number in Dubai', async () => {
    await rolledBack(client, async () => {
      await client.query(insert, [IDS.tenantA, IDS.clientA, 'DXB', '1234567890']);
    });
  });

  it('refuses a Makani number that is not ten digits', async () => {
    await rolledBack(client, async () => {
      await rejectsWith(client, CHECK_VIOLATION, insert, [
        IDS.tenantA,
        IDS.clientA,
        'DXB',
        '123456789',
      ]);
    });
  });

  it('refuses a Makani number outside Dubai', async () => {
    await rolledBack(client, async () => {
      await rejectsWith(client, CHECK_VIOLATION, insert, [
        IDS.tenantA,
        IDS.clientA,
        'AUH',
        '1234567890',
      ]);
    });
  });

  it('requires the verified entrance point', async () => {
    await rolledBack(client, async () => {
      await rejectsWith(
        client,
        '23502',
        "insert into location (tenant_id, owner_type, owner_id, label, emirate) values ($1, 'client', $2, 'home', 'DXB')",
        [IDS.tenantA, IDS.clientA],
      );
    });
  });
});

describe('clients', () => {
  it('requires the Emirates ID hash to be a sha256 and to travel with the ciphertext', async () => {
    await rolledBack(client, async () => {
      await rejectsWith(
        client,
        CHECK_VIOLATION,
        'insert into client (tenant_id, mrn, given_name, family_name, emirates_id_encrypted) ' +
          "values ($1, 'MW-900001', 'Synthetic', 'Beta', 'ciphertext'::bytea)",
        [IDS.tenantA],
      );
      await rejectsWith(
        client,
        CHECK_VIOLATION,
        'insert into client (tenant_id, mrn, given_name, family_name, emirates_id_encrypted, emirates_id_hash) ' +
          "values ($1, 'MW-900002', 'Synthetic', 'Beta', 'ciphertext'::bytea, 'short'::bytea)",
        [IDS.tenantA],
      );
    });
  });

  it('keeps the Emirates ID hash unique within a tenant but not across tenants', async () => {
    await rolledBack(client, async () => {
      const sameHash =
        'insert into client (tenant_id, mrn, given_name, family_name, emirates_id_encrypted, emirates_id_hash) ' +
        "values ($1, $2, 'Synthetic', 'Gamma', 'ciphertext'::bytea, sha256(($3)::bytea))";
      await rejectsWith(client, UNIQUE_VIOLATION, sameHash, [
        IDS.tenantA,
        'MW-900003',
        `identity-${IDS.clientA}`,
      ]);
      await client.query(sameHash, [IDS.tenantB, 'MW-900003', `identity-${IDS.clientA}`]);
    });
  });

  it('keeps the medical record number unique within a tenant', async () => {
    await rolledBack(client, async () => {
      await rejectsWith(
        client,
        UNIQUE_VIOLATION,
        "insert into client (tenant_id, mrn, given_name, family_name) values ($1, $2, 'Synthetic', 'Delta')",
        [IDS.tenantA, `MW-${IDS.clientA.slice(-6)}`],
      );
    });
  });

  it('refuses a nationality that is not an upper-case alpha-3 code', async () => {
    await rolledBack(client, async () => {
      await rejectsWith(
        client,
        CHECK_VIOLATION,
        "insert into client (tenant_id, mrn, given_name, family_name, nationality) values ($1, 'MW-900004', 'Synthetic', 'Epsilon', 'are')",
        [IDS.tenantA],
      );
    });
  });

  it('refuses a status outside the closed set', async () => {
    await rolledBack(client, async () => {
      await rejectsWith(
        client,
        INVALID_ENUM,
        "insert into client (tenant_id, mrn, given_name, family_name, status) values ($1, 'MW-900005', 'Synthetic', 'Zeta', 'deleted')",
        [IDS.tenantA],
      );
    });
  });

  it('moves updated_at on every update', async () => {
    const before = await client.query<{ updated_at: Date }>(
      'select updated_at from client where id = $1',
      [IDS.clientA],
    );
    await client.query("update client set referral_source = 'website' where id = $1", [
      IDS.clientA,
    ]);
    const after = await client.query<{ updated_at: Date }>(
      'select updated_at from client where id = $1',
      [IDS.clientA],
    );
    expect(after.rows[0]?.updated_at.getTime()).toBeGreaterThan(
      before.rows[0]?.updated_at.getTime() ?? Number.POSITIVE_INFINITY,
    );
  });
});

describe('service types and credentials', () => {
  it('requires at least one delivery mode and a positive duration', async () => {
    await rolledBack(client, async () => {
      await rejectsWith(
        client,
        CHECK_VIOLATION,
        "insert into service_type (tenant_id, code, name, duration_minutes, is_clinical, delivery_modes) values ($1, 'nf-session', 'Session', 40, true, '{}')",
        [IDS.tenantA],
      );
      await rejectsWith(
        client,
        CHECK_VIOLATION,
        "insert into service_type (tenant_id, code, name, duration_minutes, is_clinical, delivery_modes) values ($1, 'nf-session', 'Session', 0, true, '{home}')",
        [IDS.tenantA],
      );
    });
  });

  it('requires a credential to expire after it starts', async () => {
    await rolledBack(client, async () => {
      const { rows } = await client.query<{ id: string }>(
        "insert into service_type (tenant_id, code, name, duration_minutes, is_clinical, delivery_modes) values ($1, 'nf-session', 'Session', 40, true, '{home}') returning id",
        [IDS.tenantA],
      );
      const practitioner = await client.query<{ id: string }>(
        'insert into practitioner (tenant_id, user_id) values ($1, $2) returning id',
        [IDS.tenantA, IDS.ownerA],
      );
      await rejectsWith(
        client,
        CHECK_VIOLATION,
        "insert into credential (tenant_id, practitioner_id, jurisdiction, service_type_id, licence_type, valid_from, valid_to) values ($1, $2, 'DHA', $3, 'dha_technician', '2026-01-01', '2026-01-01')",
        [IDS.tenantA, practitioner.rows[0]?.id, rows[0]?.id],
      );
    });
  });
});
