import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  IDS,
  PHONES,
  freshDatabase,
  rejectsWith,
  rolledBack,
  seedClient,
  seedContact,
  seedTenant,
} from './helpers';

const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const INVALID_ENUM = '22P02';

let client: pg.Client;

beforeAll(async () => {
  client = await freshDatabase();
  await seedTenant(client, IDS.tenantA, IDS.ownerA, 'Synthetic Studio A');
  await seedTenant(client, IDS.tenantB, IDS.ownerB, 'Synthetic Studio B');
  await seedClient(client, IDS.tenantA, IDS.clientA, IDS.ownerA, 'Alpha');
  await seedClient(client, IDS.tenantB, IDS.clientB, IDS.ownerB, 'Beta');
  await seedContact(client, IDS.tenantA, IDS.contactA, IDS.clientA, 'identity-one');
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
  it("requires an adult contact's Emirates ID hash to be 32 bytes and to travel with the ciphertext", async () => {
    await rolledBack(client, async () => {
      await rejectsWith(
        client,
        CHECK_VIOLATION,
        "insert into contact (tenant_id, client_id, relationship, emirates_id_encrypted) values ($1, $2, 'father', 'ciphertext'::bytea)",
        [IDS.tenantA, IDS.clientA],
      );
      await rejectsWith(
        client,
        CHECK_VIOLATION,
        "insert into contact (tenant_id, client_id, relationship, emirates_id_encrypted, emirates_id_hash) values ($1, $2, 'father', 'ciphertext'::bytea, 'short'::bytea)",
        [IDS.tenantA, IDS.clientA],
      );
    });
  });

  it("keeps a contact's Emirates ID hash unique within a tenant but not across tenants", async () => {
    await rolledBack(client, async () => {
      const sameHash =
        'insert into contact (tenant_id, client_id, relationship, emirates_id_encrypted, emirates_id_hash) ' +
        "values ($1, $2, 'father', 'ciphertext'::bytea, sha256(('identity-one')::bytea))";
      await rejectsWith(client, UNIQUE_VIOLATION, sameHash, [IDS.tenantA, IDS.clientA]);
      await client.query(sameHash, [IDS.tenantB, IDS.clientB]);
    });
  });

  it('keeps the record number unique within a tenant', async () => {
    await rolledBack(client, async () => {
      await rejectsWith(
        client,
        UNIQUE_VIOLATION,
        "insert into client (tenant_id, mrn, given_name, family_name) values ($1, $2, 'Synthetic', 'Delta')",
        [IDS.tenantA, `MW-${IDS.clientA.slice(-6)}`],
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
        "insert into service_type (tenant_id, code, name, duration_minutes, delivery_modes) values ($1, 'nf-session', 'Session', 40, '{}')",
        [IDS.tenantA],
      );
      await rejectsWith(
        client,
        CHECK_VIOLATION,
        "insert into service_type (tenant_id, code, name, duration_minutes, delivery_modes) values ($1, 'nf-session', 'Session', 0, '{home}')",
        [IDS.tenantA],
      );
    });
  });

  it('requires a credential to expire after it starts', async () => {
    await rolledBack(client, async () => {
      const { rows } = await client.query<{ id: string }>(
        "insert into service_type (tenant_id, code, name, duration_minutes, delivery_modes) values ($1, 'nf-session', 'Session', 40, '{home}') returning id",
        [IDS.tenantA],
      );
      const practitioner = await client.query<{ id: string }>(
        'insert into practitioner (tenant_id, user_id) values ($1, $2) returning id',
        [IDS.tenantA, IDS.ownerA],
      );
      await rejectsWith(
        client,
        CHECK_VIOLATION,
        "insert into credential (tenant_id, practitioner_id, service_type_id, certification, valid_from, valid_to) values ($1, $2, $3, 'bcia_bcn', '2026-01-01', '2026-01-01')",
        [IDS.tenantA, practitioner.rows[0]?.id, rows[0]?.id],
      );
    });
  });
});
