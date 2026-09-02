import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  IDS,
  asApiRole,
  count,
  freshDatabase,
  rejectsWith,
  seedClient,
  seedLocation,
  seedTenant,
} from './helpers';

const RLS_VIOLATION = '42501';
const TENANT_TABLES = ['app_user', 'user_role', 'client', 'location'];

let client: pg.Client;

beforeAll(async () => {
  client = await freshDatabase();
  await seedTenant(client, IDS.tenantA, IDS.ownerA, 'Synthetic Clinic A');
  await seedTenant(client, IDS.tenantB, IDS.ownerB, 'Synthetic Clinic B');
  await seedClient(client, IDS.tenantA, IDS.clientA, IDS.ownerA, 'Alpha');
  await seedClient(client, IDS.tenantB, IDS.clientB, IDS.ownerB, 'Beta');
  await seedLocation(client, IDS.tenantA, IDS.locationA, IDS.clientA, IDS.ownerA);
  await seedLocation(client, IDS.tenantB, IDS.locationB, IDS.clientB, IDS.ownerB);
  await client.query('begin');
});

afterAll(async () => {
  await client.query('rollback');
  await client.end();
});

describe('tenant isolation', () => {
  it('shows the owner every tenant', async () => {
    expect(await count(client, 'tenant')).toBe(2);
    expect(await count(client, 'client')).toBe(2);
  });

  it('shows the API role only the rows of the tenant it acts for', async () => {
    await asApiRole(client, IDS.tenantA, async () => {
      expect(await count(client, 'tenant')).toBe(1);
      for (const table of TENANT_TABLES) {
        const { rows } = await client.query<{ tenant_id: string }>(
          `select distinct tenant_id from ${table}`,
        );
        expect(rows, table).toEqual([{ tenant_id: IDS.tenantA }]);
      }
    });
    await asApiRole(client, IDS.tenantB, async () => {
      const { rows } = await client.query<{ id: string }>('select id from client');
      expect(rows).toEqual([{ id: IDS.clientB }]);
    });
  });

  it('shows the API role nothing when no tenant is set', async () => {
    await asApiRole(client, null, async () => {
      expect(await count(client, 'tenant')).toBe(0);
      for (const table of TENANT_TABLES) {
        expect(await count(client, table), table).toBe(0);
      }
      expect(await count(client, 'audit_log')).toBe(0);
    });
  });

  it('refuses a row written for another tenant', async () => {
    await asApiRole(client, IDS.tenantA, async () => {
      await rejectsWith(
        client,
        RLS_VIOLATION,
        "insert into client (tenant_id, mrn, given_name, family_name) values ($1, 'MW-900010', 'Synthetic', 'Intruder')",
        [IDS.tenantB],
      );
      await rejectsWith(client, RLS_VIOLATION, 'update client set tenant_id = $1 where id = $2', [
        IDS.tenantB,
        IDS.clientA,
      ]);
    });
  });

  it('lets the API role write within its own tenant and audits it', async () => {
    await asApiRole(client, IDS.tenantA, async () => {
      await client.query(
        "insert into contact (tenant_id, client_id, relationship, can_consent) values ($1, $2, 'mother', true)",
        [IDS.tenantA, IDS.clientA],
      );
      expect(await count(client, 'contact')).toBe(1);
      const { rows } = await client.query<{ n: string }>(
        "select count(*)::text as n from audit_log where entity_type = 'contact' and client_id = $1",
        [IDS.clientA],
      );
      expect(rows[0]?.n).toBe('1');
    });
  });

  it('never lets the API role delete', async () => {
    await asApiRole(client, IDS.tenantA, async () => {
      await rejectsWith(client, '42501', 'delete from client where id = $1', [IDS.clientA]);
    });
  });

  it('scopes the audit log by tenant for the API role', async () => {
    await asApiRole(client, IDS.tenantB, async () => {
      const { rows } = await client.query<{ tenant_id: string }>(
        'select distinct tenant_id from audit_log',
      );
      expect(rows).toEqual([{ tenant_id: IDS.tenantB }]);
    });
  });
});
