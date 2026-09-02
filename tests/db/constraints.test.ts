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
const FOREIGN_KEY_VIOLATION = '23503';

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

describe('tenant-scoped keys (099_tenant_scoped_keys.sql)', () => {
  it('gives every tenant-scoped public table a unique (tenant_id, id) key, tenant and audit_log excepted', async () => {
    // Coverage comes from the schema itself, not a hardcoded table list, so a
    // core table that gains a tenant_id column later and forgets this key
    // fails here by name rather than silently passing. `tenant` carries no
    // tenant_id of its own (.claude/rules/data-model.md) and so never appears
    // in this query. `audit_log` (and its month partitions, audit_log_2026_09
    // and the like) does carry tenant_id but is structurally exempt: it is
    // partitioned by occurred_at, Postgres refuses any unique key on a
    // partitioned table that omits the partition column, so a bare
    // (tenant_id, id) key can never exist on it - and nothing ever holds a
    // composite foreign key into an audit row (docs/SPEC/audit.md).
    const { rows: tables } = await client.query<{ table_name: string }>(
      'select table_name from information_schema.columns ' +
        "where table_schema = 'public' and column_name = 'tenant_id' " +
        "and table_name <> 'tenant' and table_name <> 'audit_log' " +
        "and table_name not like 'audit_log_%' " +
        'order by table_name',
    );
    // A canary for the query itself: if this ever comes back empty, the
    // assertion below would vacuously pass without checking anything.
    expect(tables.length).toBeGreaterThanOrEqual(10);

    for (const { table_name: table } of tables) {
      const { rows: keyed } = await client.query<{ conname: string }>(
        'select c.conname from pg_constraint c ' +
          'where c.conrelid = $1::regclass ' +
          "and c.contype = 'u' " +
          'and (' +
          '  select array_agg(a.attname::text order by a.attname) ' +
          '    from pg_attribute a ' +
          '   where a.attrelid = c.conrelid and a.attnum = any(c.conkey)' +
          ") = array['id', 'tenant_id']",
        [table],
      );
      expect(keyed.length, `${table} unique (tenant_id, id)`).toBeGreaterThan(0);
    }
  });

  it("refuses a composite foreign key row naming another tenant's client, and accepts its own", async () => {
    await rolledBack(client, async () => {
      // A stream's own migration would write this against its own table, in
      // its own numeric range; here it is a throwaway table demonstrating the
      // shape 099 makes possible: (tenant_id, client_id) references
      // client (tenant_id, id). A temporary table cannot carry a foreign key
      // to a permanent one, so this is a plain table instead - harmless
      // inside a transaction the rollback always undoes, creation included.
      await client.query(
        'create table stream_client_ref (' +
          'id uuid primary key default gen_random_uuid(), ' +
          'tenant_id uuid not null, ' +
          'client_id uuid not null, ' +
          'foreign key (tenant_id, client_id) references client (tenant_id, id)' +
          ')',
      );

      // Tenant A naming its own client is accepted: the pairing matches.
      await client.query('insert into stream_client_ref (tenant_id, client_id) values ($1, $2)', [
        IDS.tenantA,
        IDS.clientA,
      ]);

      // Tenant A naming tenant B's client is refused, even though clientB is a
      // real row - the composite key demands the tenant_id agree too, which a
      // plain foreign key on client_id alone would never have caught.
      await rejectsWith(
        client,
        FOREIGN_KEY_VIOLATION,
        'insert into stream_client_ref (tenant_id, client_id) values ($1, $2)',
        [IDS.tenantA, IDS.clientB],
      );
    });
  });
});
