import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  IDS,
  asApiRole,
  freshDatabase,
  rejectsWith,
  rolledBack,
  seedClient,
  seedContact,
  seedLocation,
  seedTenant,
  setAuditContext,
} from './helpers';

const APPEND_ONLY = '42501';

type AuditRow = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  client_id: string | null;
  tenant_id: string | null;
  actor_id: string | null;
  actor_type: string;
  request_id: string | null;
  reason: string | null;
  changed_fields: string[] | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  prev_hash: Buffer | null;
  row_hash: Buffer;
  hash_ok: boolean;
};

let client: pg.Client;

beforeAll(async () => {
  client = await freshDatabase();
  await seedTenant(client, IDS.tenantA, IDS.ownerA, 'Synthetic Studio A');
});

afterAll(async () => {
  await client.end();
});

async function rowsFor(entityId: string): Promise<AuditRow[]> {
  const { rows } = await client.query<AuditRow>(
    'select id::text, action, entity_type, entity_id, client_id, tenant_id, actor_id, actor_type, ' +
      'request_id, reason, changed_fields, old_values, new_values, prev_hash, row_hash, ' +
      'row_hash = app.audit_row_hash(prev_hash, id, occurred_at, actor_id, action, entity_type, ' +
      'entity_id, old_values, new_values) as hash_ok ' +
      'from audit_log where entity_id = $1 order by id',
    [entityId],
  );
  return rows;
}

async function verify(fromId?: number): Promise<number | null> {
  const { rows } = await client.query<{ broken: string | null }>(
    fromId === undefined
      ? 'select app.verify_audit_chain()::text as broken'
      : 'select app.verify_audit_chain($1)::text as broken',
    fromId === undefined ? [] : [fromId],
  );
  const value = rows[0]?.broken;
  return value === null || value === undefined ? null : Number(value);
}

describe('the audit trail', () => {
  it('records an insert as a chained row carrying the client, actor, request and reason', async () => {
    await rolledBack(client, async () => {
      await setAuditContext(client, IDS.ownerA, 'intake');
      await seedClient(client, IDS.tenantA, IDS.clientA, IDS.ownerA, 'Alpha');

      const rows = await rowsFor(IDS.clientA);
      expect(rows).toHaveLength(1);
      const [row] = rows;
      expect(row).toMatchObject({
        action: 'insert',
        entity_type: 'client',
        entity_id: IDS.clientA,
        client_id: IDS.clientA,
        tenant_id: IDS.tenantA,
        actor_id: IDS.ownerA,
        actor_type: 'user',
        request_id: IDS.request,
        reason: 'intake',
        old_values: null,
        changed_fields: null,
        hash_ok: true,
      });
      expect(row?.new_values).toMatchObject({ family_name: 'Alpha' });
      expect(row?.new_values).not.toHaveProperty('emirates_id_hash');
      expect(row?.new_values).not.toHaveProperty('emirates_id_encrypted');
    });
  });

  it('records an update with the changed fields and links it to the previous row', async () => {
    await rolledBack(client, async () => {
      await setAuditContext(client, IDS.ownerA);
      await seedClient(client, IDS.tenantA, IDS.clientA, IDS.ownerA, 'Alpha');
      await client.query("update client set family_name = 'Changed' where id = $1", [IDS.clientA]);

      const rows = await rowsFor(IDS.clientA);
      expect(rows).toHaveLength(2);
      const [first, second] = rows;
      expect(second).toMatchObject({ action: 'update', hash_ok: true });
      // Only family_name: updated_at is now(), which is fixed for the whole transaction.
      expect(second?.changed_fields).toEqual(['family_name']);
      expect(second?.old_values).toMatchObject({ family_name: 'Alpha' });
      expect(second?.new_values).toMatchObject({ family_name: 'Changed' });
      expect(second?.prev_hash?.equals(first?.row_hash ?? Buffer.alloc(0))).toBe(true);
      expect(Number(second?.id)).toBe(Number(first?.id) + 1);
    });
  });

  it('redacts long free text but still names the field that changed', async () => {
    await rolledBack(client, async () => {
      await setAuditContext(client, IDS.ownerA);
      await seedClient(client, IDS.tenantA, IDS.clientA, IDS.ownerA, 'Alpha');
      await client.query('update client set referral_source = repeat($2, 250) where id = $1', [
        IDS.clientA,
        'x',
      ]);

      const rows = await rowsFor(IDS.clientA);
      const update = rows[1];
      expect(update?.changed_fields).toContain('referral_source');
      expect(update?.new_values?.referral_source).toBe('[redacted: 250 chars]');
    });
  });

  it('denormalises the client onto a location the client owns', async () => {
    await rolledBack(client, async () => {
      await setAuditContext(client, IDS.ownerA);
      await seedClient(client, IDS.tenantA, IDS.clientA, IDS.ownerA, 'Alpha');
      await seedLocation(client, IDS.tenantA, IDS.locationA, IDS.clientA, IDS.ownerA);

      const [row] = await rowsFor(IDS.locationA);
      expect(row).toMatchObject({ entity_type: 'location', client_id: IDS.clientA, hash_ok: true });
    });
  });

  it('logs a write without an actor as a system action', async () => {
    await rolledBack(client, async () => {
      await seedClient(client, IDS.tenantA, IDS.clientA, IDS.ownerA, 'Alpha');
      const [row] = await rowsFor(IDS.clientA);
      expect(row).toMatchObject({ actor_id: null, actor_type: 'system' });
    });
  });

  it('refuses update, delete and truncate, from the owner and from the API role', async () => {
    await rolledBack(client, async () => {
      await setAuditContext(client, IDS.ownerA);
      await seedClient(client, IDS.tenantA, IDS.clientA, IDS.ownerA, 'Alpha');
      const [row] = await rowsFor(IDS.clientA);

      await rejectsWith(client, APPEND_ONLY, "update audit_log set reason = 'x' where id = $1", [
        row?.id,
      ]);
      await rejectsWith(client, APPEND_ONLY, 'delete from audit_log where id = $1', [row?.id]);
      await rejectsWith(client, APPEND_ONLY, 'truncate audit_log');
      await asApiRole(client, IDS.tenantA, async () => {
        await rejectsWith(client, APPEND_ONLY, "update audit_log set reason = 'x' where id = $1", [
          row?.id,
        ]);
      });
    });
  });

  it('verifies an intact chain and names the first row a hostile owner forges', async () => {
    await rolledBack(client, async () => {
      await setAuditContext(client, IDS.ownerA);
      await seedClient(client, IDS.tenantA, IDS.clientA, IDS.ownerA, 'Alpha');
      await client.query("update client set family_name = 'Changed' where id = $1", [IDS.clientA]);
      const [first, second] = await rowsFor(IDS.clientA);
      const firstId = Number(first?.id);
      const secondId = Number(second?.id);

      expect(await verify()).toBeNull();
      expect(await verify(firstId)).toBeNull();

      // A hostile owner switches the guard off and rewrites history.
      await client.query('alter table audit_log disable trigger audit_no_update');
      await client.query(
        `update audit_log set new_values = new_values || '{"family_name": "Forged"}' where id = $1`,
        [firstId],
      );
      await client.query('alter table audit_log enable always trigger audit_no_update');

      expect(await verify()).toBe(firstId);
      expect(await verify(secondId)).toBeNull();

      // Then removes the last row: the anchor still counts it.
      await client.query('alter table audit_log disable trigger audit_no_delete');
      await client.query('delete from audit_log where id = $1', [secondId]);
      await client.query('alter table audit_log enable always trigger audit_no_delete');

      expect(await verify(secondId)).toBe(secondId);
    });
  });

  it('chains rows written by the API role too, and shows it only its own tenant', async () => {
    await rolledBack(client, async () => {
      await seedTenant(client, IDS.tenantB, IDS.ownerB, 'Synthetic Studio B');
      await setAuditContext(client, IDS.ownerA);
      await seedClient(client, IDS.tenantA, IDS.clientA, IDS.ownerA, 'Alpha');
      await seedClient(client, IDS.tenantB, IDS.clientB, IDS.ownerB, 'Beta');

      await asApiRole(client, IDS.tenantA, async () => {
        const { rows } = await client.query<{ tenant_id: string }>(
          'select distinct tenant_id from audit_log',
        );
        expect(rows).toEqual([{ tenant_id: IDS.tenantA }]);
        await client.query("update client set referral_source = 'school' where id = $1", [
          IDS.clientA,
        ]);
        const own = await client.query<{ n: string }>(
          "select count(*)::text as n from audit_log where entity_id = $1 and action = 'update'",
          [IDS.clientA],
        );
        expect(own.rows[0]?.n).toBe('1');
      });
      expect(await verify()).toBeNull();
    });
  });
});

describe('erasure mode', () => {
  it('withholds every value, so an erasure never re-records the identity it removes', async () => {
    await rolledBack(client, async () => {
      await setAuditContext(client, IDS.ownerA, 'erasure request');
      await seedClient(client, IDS.tenantA, IDS.clientA, IDS.ownerA, 'Alpha');
      await client.query("select set_config('app.erasure', 'true', true)");
      await client.query(
        "update client set given_name = 'Erased', family_name = 'Erased', status = 'erased' where id = $1",
        [IDS.clientA],
      );
      const rows = await rowsFor(IDS.clientA);
      const erasure = rows[1];
      expect(erasure?.changed_fields).toEqual(['family_name', 'given_name', 'status']);
      expect(erasure?.old_values?.family_name).toBe('[withheld: erasure]');
      expect(erasure?.new_values?.family_name).toBe('[withheld: erasure]');
      expect(JSON.stringify(erasure?.old_values)).not.toContain('Alpha');
      expect(erasure?.hash_ok).toBe(true);
    });
  });
});

describe('identity columns', () => {
  it("strips the Emirates ID columns from a contact's audit row", async () => {
    await rolledBack(client, async () => {
      await setAuditContext(client, IDS.ownerA);
      await seedClient(client, IDS.tenantA, IDS.clientA, IDS.ownerA, 'Alpha');
      await seedContact(client, IDS.tenantA, IDS.contactA, IDS.clientA, 'identity-one');
      const [row] = await rowsFor(IDS.contactA);
      expect(row).toMatchObject({ entity_type: 'contact', client_id: IDS.clientA, hash_ok: true });
      expect(row?.new_values).toHaveProperty('phone');
      expect(row?.new_values).not.toHaveProperty('emirates_id_hash');
      expect(row?.new_values).not.toHaveProperty('emirates_id_encrypted');
    });
  });

  it('ignores erasure mode when the API role is in effect', async () => {
    await rolledBack(client, async () => {
      await setAuditContext(client, IDS.ownerA);
      await seedClient(client, IDS.tenantA, IDS.clientA, IDS.ownerA, 'Alpha');
      await asApiRole(client, IDS.tenantA, async () => {
        await client.query("select set_config('app.erasure', 'true', true)");
        await client.query("update client set family_name = 'Hidden' where id = $1", [IDS.clientA]);
        const rows = await rowsFor(IDS.clientA);
        expect(rows[1]?.new_values?.family_name).toBe('Hidden');
      });
    });
  });
});
