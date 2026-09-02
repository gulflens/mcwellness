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
const INSUFFICIENT_PRIVILEGE = '42501'; // same SQLSTATE, named for what this file uses it to prove

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
      // The real entry point (098_erasure_guard.sql): the owner stands in for
      // app.erase_client, which alone may reach app.begin_erasure().
      await client.query('select app.begin_erasure()');
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

describe('the erasure guard (098_erasure_guard.sql)', () => {
  it("does nothing for a forged flag: 'true' never matches the encoded key, under any role", async () => {
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

  it('withholds every value once app.begin_erasure() has run, as the owner', async () => {
    await rolledBack(client, async () => {
      await setAuditContext(client, IDS.ownerA);
      await seedClient(client, IDS.tenantA, IDS.clientA, IDS.ownerA, 'Alpha');
      await client.query('select app.begin_erasure()');
      await client.query("update client set family_name = 'Erased' where id = $1", [IDS.clientA]);
      const rows = await rowsFor(IDS.clientA);
      expect(rows[1]?.new_values?.family_name).toBe('[withheld: erasure]');
    });
  });

  it('refuses the API role both a read of the key table and the right to call begin_erasure', async () => {
    await rolledBack(client, async () => {
      await asApiRole(client, IDS.tenantA, async () => {
        await rejectsWith(client, INSUFFICIENT_PRIVILEGE, 'select key from app.erasure_key');
        await rejectsWith(client, INSUFFICIENT_PRIVILEGE, 'select app.begin_erasure()');
      });
    });
  });
});

describe('app.audit_redact drops a fixed set of keys outright (audit.md section 8)', () => {
  it('drops checked_in_point alongside the Emirates ID columns, keeping the rest', async () => {
    const { rows } = await client.query<{ redacted: Record<string, unknown> }>(
      'select app.audit_redact(\'{"checked_in_point": "POINT(1 1)", "note": "kept"}\'::jsonb) as redacted',
    );
    expect(rows[0]?.redacted).toEqual({ note: 'kept' });
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

describe('the client behind an audit row, on any table', () => {
  const clientId = '00000008-0000-4000-8000-000000000001';
  const row = (fields: Record<string, unknown>): string => JSON.stringify(fields);
  const resolve = async (
    table: string,
    fields: Record<string, unknown>,
  ): Promise<string | null> => {
    const { rows } = await client.query<{ id: string | null }>(
      'select app.audit_client_id($1, $2::jsonb) as id',
      [table, row(fields)],
    );
    return rows[0]?.id ?? null;
  };

  it('is the row itself for a client, its client for any table carrying client_id, and nothing otherwise', async () => {
    expect(await resolve('client', { id: clientId })).toBe(clientId);
    for (const table of ['contact', 'consent', 'document', 'appointment', 'session', 'goal']) {
      expect(await resolve(table, { id: 'x', client_id: clientId }), table).toBe(clientId);
    }
    expect(await resolve('document', { id: 'x', client_id: null })).toBeNull();
    expect(await resolve('location', { owner_type: 'client', owner_id: clientId })).toBe(clientId);
    expect(await resolve('location', { owner_type: 'tenant', owner_id: clientId })).toBeNull();
    // A location names its client through its owner, never through a client_id key.
    expect(
      await resolve('location', { owner_type: 'tenant', owner_id: clientId, client_id: clientId }),
    ).toBeNull();
    expect(await resolve('service_type', { id: 'x', code: 'nf-session' })).toBeNull();
  });
});

describe('a client_id that is not a client', () => {
  it('yields nothing rather than aborting the write', async () => {
    const { rows } = await client.query<{ id: string | null }>(
      'select app.audit_client_id(\'integration_thing\', \'{"client_id": "zoho-4411"}\'::jsonb) as id',
    );
    expect(rows[0]?.id).toBeNull();
  });
});

describe('every audited table is classified', () => {
  // The trunk's own tables are classified directly: either they carry a uuid
  // client_id the audit trail attributes, or they deliberately have none. A
  // stream's own audited table is neither: it declares itself instead, with a
  // `comment on table` in its own migration (audit.md section 14 item 13,
  // .claude/rules/data-model.md), so parallel streams never fight over this list.
  const WITH_CLIENT = ['contact', 'consent', 'document'];
  const NAMES_ITSELF = ['client'];
  const WITHOUT_CLIENT = [
    'tenant',
    'app_user',
    'user_role',
    'practitioner',
    'credential',
    'service_type',
    'location',
  ];

  type AuditedTableRow = { table: string; client_id_type: string | null; comment: string | null };

  async function auditedTables(): Promise<AuditedTableRow[]> {
    const { rows } = await client.query<AuditedTableRow>(
      `select c.relname as table,
              (select a.atttypid::regtype::text from pg_attribute a
                where a.attrelid = c.oid and a.attname = 'client_id' and not a.attisdropped) as client_id_type,
              obj_description(c.oid, 'pg_class') as comment
         from pg_trigger t join pg_class c on c.oid = t.tgrelid
        where t.tgname = 'audit_row' and not t.tgisinternal and c.relnamespace = 'public'::regnamespace
        order by c.relname`,
    );
    return rows;
  }

  /** Throws, naming the table and the comment to add, when neither classification applies. */
  function classify(r: AuditedTableRow): void {
    if (WITH_CLIENT.includes(r.table)) {
      expect(r.client_id_type, r.table).toBe('uuid');
      return;
    }
    if (NAMES_ITSELF.includes(r.table) || WITHOUT_CLIENT.includes(r.table)) {
      expect(r.client_id_type, r.table).toBeNull();
      return;
    }
    if (r.comment?.startsWith('audited: client')) {
      expect(r.client_id_type, r.table).toBe('uuid');
      return;
    }
    if (r.comment?.startsWith('audited: no client')) {
      expect(r.client_id_type, r.table).toBeNull();
      return;
    }
    throw new Error(
      `"${r.table}" carries the audit trigger but is neither one of the trunk's classified ` +
        "tables nor carries a classification comment. In the stream's own migration, add " +
        `comment on table public.${r.table} is 'audited: client - ...' (if it carries a uuid ` +
        `client_id) or comment on table public.${r.table} is 'audited: no client - ...' ` +
        '(if it deliberately has none).',
    );
  }

  it('carries a uuid client_id, or deliberately none, per the trunk list or a stream comment', async () => {
    const rows = await auditedTables();
    const audited = rows.map((r) => r.table);
    // Containment, not equality: a stream's migration may add its own audited
    // table alongside the trunk's (tests/db/schema.test.ts does the same).
    for (const table of [...WITH_CLIENT, ...NAMES_ITSELF, ...WITHOUT_CLIENT]) {
      expect(audited, table).toContain(table);
    }
    for (const r of rows) {
      classify(r);
    }
  });

  it("classifies a stream's own audited table by its comment, and refuses one with none", async () => {
    await rolledBack(client, async () => {
      const withComment = 'zz_test_stream_with_client';
      const noClientComment = 'zz_test_stream_no_client';
      const uncommented = 'zz_test_stream_uncommented';

      await client.query(
        `create table ${withComment} (id uuid primary key, tenant_id uuid not null, client_id uuid)`,
      );
      await client.query(
        `create table ${noClientComment} (id uuid primary key, tenant_id uuid not null)`,
      );
      await client.query(
        `create table ${uncommented} (id uuid primary key, tenant_id uuid not null)`,
      );
      for (const table of [withComment, noClientComment, uncommented]) {
        await client.query(
          `create trigger audit_row after insert or update or delete on ${table} ` +
            'for each row execute function app.audit_row()',
        );
      }
      await client.query(
        `comment on table ${withComment} is 'audited: client - proves the test reads a stream comment'`,
      );
      await client.query(
        `comment on table ${noClientComment} is 'audited: no client - proves the test reads a stream comment'`,
      );
      // uncommented gets no comment at all: it must fail, naming itself.

      const byName = new Map((await auditedTables()).map((r) => [r.table, r]));
      expect(() => classify(byName.get(withComment)!)).not.toThrow();
      expect(() => classify(byName.get(noClientComment)!)).not.toThrow();
      expect(() => classify(byName.get(uncommented)!)).toThrow(uncommented);
      // The transaction this all ran in is rolled back by the caller: nothing
      // of these three tables, their triggers or their comments survives.
    });
  });
});
