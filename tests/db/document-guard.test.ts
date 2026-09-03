import { createHash } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  IDS,
  asApiRole,
  freshDatabase,
  rejectsWith,
  rolledBack,
  seedClient,
  seedTenant,
} from './helpers';

/**
 * The write floor under `document` (migration 903). Row security says which
 * practice's rows an actor may reach; this says what an actor who can reach a
 * row may do to it — who files consent wording, who may say which wording a
 * row is, and that an immutable document is neither changed nor deleted.
 *
 * Every deny case runs as the API role, because that is the only actor a
 * request ever has: the guard deliberately stands aside when no role has been
 * assumed at all (the owner's own maintenance, as app.guard_location_notes()
 * does), so a test against a raw owner connection would prove nothing about a
 * request.
 */

const INSUFFICIENT_PRIVILEGE = '42501';
const UNIQUE_VIOLATION = '23505';

const WORDING = '00000000-0000-4000-8000-0000000000f1'; // approved, immutable: the real shape
const DRAFT = '00000000-0000-4000-8000-0000000000f2'; // a draft nobody has locked yet
const REPORT = '00000000-0000-4000-8000-0000000000f3'; // an ordinary practice document

let client: pg.Client;

/** A document written the way a migration or the seed writes one: no role assumed. */
async function fileDocument(id: string, columns: Record<string, unknown> = {}): Promise<void> {
  const row: Record<string, unknown> = {
    id,
    tenant_id: IDS.tenantA,
    kind: 'consent_text',
    storage_key: `tenant/${IDS.tenantA}/practice/${id}`,
    mime_type: 'text/markdown',
    sha256: createHash('sha256').update(id).digest(),
    is_immutable: false,
    created_by: IDS.ownerA,
    ...columns,
  };
  const names = Object.keys(row);
  await client.query(
    `insert into document (${names.join(', ')}) values ` +
      `(${names.map((_, i) => `$${i + 1}`).join(', ')})`,
    names.map((name) => row[name]),
  );
}

/**
 * The message behind a refusal, inside a savepoint so the transaction stays
 * usable. `rejectsWith` proves the SQLSTATE; this proves which rule spoke,
 * because row security and this trigger both refuse with 42501 and only the
 * sentence tells them apart.
 */
async function refusalMessage(sql: string, params: unknown[] = []): Promise<string> {
  await client.query('savepoint expect_refusal');
  let message = 'the statement was accepted';
  try {
    await client.query(sql, params);
  } catch (error) {
    message = (error as Error).message;
  } finally {
    await client.query('rollback to savepoint expect_refusal');
  }
  return message;
}

beforeAll(async () => {
  client = await freshDatabase();
  await seedTenant(client, IDS.tenantA, IDS.ownerA, 'Synthetic Studio A');
  await seedClient(client, IDS.tenantA, IDS.clientA, IDS.ownerA, 'Alpha');
  await fileDocument(WORDING, {
    purpose: 'participation',
    locale: 'en',
    version: '0.1-draft',
    status: 'approved',
    is_immutable: true,
  });
  await fileDocument(DRAFT, {
    purpose: 'home_visit',
    locale: 'en',
    version: '0.1-draft',
    status: 'draft',
  });
  await fileDocument(REPORT, { kind: 'report', mime_type: 'application/pdf' });
});

afterAll(async () => {
  await client.end();
});

describe('who may file consent wording, and who may say which wording a row is', () => {
  it("refuses a practitioner the practice's own words", async () => {
    await rolledBack(client, async () => {
      await asApiRole(
        client,
        IDS.tenantA,
        async () => {
          const sql =
            'insert into document (tenant_id, kind, storage_key, mime_type, sha256) ' +
            "values ($1, 'consent_text', 'tenant/a/practice/forged', 'text/markdown', " +
            "sha256(convert_to('forged', 'UTF8')))";
          await rejectsWith(client, INSUFFICIENT_PRIVILEGE, sql, [IDS.tenantA]);
          expect(await refusalMessage(sql, [IDS.tenantA])).toContain(
            'only the owner or an admin may file consent wording',
          );
        },
        'practitioner',
      );
    });
  });

  it('refuses a practitioner the five columns, on any kind of document', async () => {
    // The before-row trigger runs ahead of 902's check constraints, so this is
    // the guard's refusal and not document_consent_text_columns_only's.
    await rolledBack(client, async () => {
      await asApiRole(
        client,
        IDS.tenantA,
        async () => {
          await rejectsWith(
            client,
            INSUFFICIENT_PRIVILEGE,
            'insert into document (tenant_id, kind, purpose, locale, version, status, ' +
              'storage_key, mime_type, sha256) values ' +
              "($1, 'report', 'participation', 'en', '1', 'draft', 'tenant/a/practice/r2', " +
              "'application/pdf', sha256(convert_to('r2', 'UTF8')))",
            [IDS.tenantA],
          );
        },
        'practitioner',
      );
    });
  });

  it('refuses a practitioner the approval, and the retirement, of a wording', async () => {
    await rolledBack(client, async () => {
      await asApiRole(
        client,
        IDS.tenantA,
        async () => {
          await rejectsWith(
            client,
            INSUFFICIENT_PRIVILEGE,
            "update document set status = 'approved' where id = $1",
            [DRAFT],
          );
          await rejectsWith(
            client,
            INSUFFICIENT_PRIVILEGE,
            'update document set retired_at = now() where id = $1',
            [DRAFT],
          );
        },
        'practitioner',
      );
    });
  });

  it('leaves a practitioner what is not the wording, so the floor is a floor and not a wall', async () => {
    await rolledBack(client, async () => {
      await asApiRole(
        client,
        IDS.tenantA,
        async () => {
          await client.query("update document set mime_type = 'text/plain' where id = $1", [
            REPORT,
          ]);
        },
        'practitioner',
      );
    });
  });

  it('lets the owner retire a wording and file its replacement, in that order', async () => {
    await rolledBack(client, async () => {
      await asApiRole(client, IDS.tenantA, async () => {
        // Retirement is the one change an immutable row admits (migration
        // 903), and it comes first: document_consent_text_current_idx is an
        // ordinary unique index, checked as each statement finishes, so the
        // replacement cannot be filed while the wording it replaces stands.
        await client.query('update document set retired_at = now() where id = $1', [WORDING]);
        await client.query(
          'insert into document (id, tenant_id, kind, purpose, locale, version, status, ' +
            'storage_key, mime_type, sha256, is_immutable) values ' +
            "($1, $2, 'consent_text', 'participation', 'en', '1.0', 'approved', " +
            "'tenant/a/practice/next', 'text/markdown', sha256(convert_to('next', 'UTF8')), true)",
          ['00000000-0000-4000-8000-0000000000fa', IDS.tenantA],
        );
        const { rows } = await client.query<{ n: string }>(
          "select count(*)::text as n from document where kind = 'consent_text' " +
            "and purpose = 'participation' and locale = 'en' " +
            "and status = 'approved' and retired_at is null",
        );
        expect(rows[0]?.n).toBe('1');
      });
    });
  });

  it('refuses a replacement filed while the wording it replaces is still current', async () => {
    await rolledBack(client, async () => {
      await asApiRole(client, IDS.tenantA, async () => {
        await rejectsWith(
          client,
          UNIQUE_VIOLATION,
          'insert into document (tenant_id, kind, purpose, locale, version, status, ' +
            'storage_key, mime_type, sha256) values ' +
            "($1, 'consent_text', 'participation', 'en', '1.0', 'approved', " +
            "'tenant/a/practice/second', 'text/markdown', sha256(convert_to('second', 'UTF8')))",
          [IDS.tenantA],
        );
      });
    });
  });
});

describe('a document marked immutable', () => {
  it('refuses every change but its retirement, even to the owner', async () => {
    await rolledBack(client, async () => {
      await asApiRole(client, IDS.tenantA, async () => {
        const sql = 'update document set storage_key = $2 where id = $1';
        await rejectsWith(client, INSUFFICIENT_PRIVILEGE, sql, [
          WORDING,
          'tenant/a/practice/swapped',
        ]);
        expect(await refusalMessage(sql, [WORDING, 'tenant/a/practice/swapped'])).toContain(
          'that document is immutable and may not be changed',
        );
        await rejectsWith(
          client,
          INSUFFICIENT_PRIVILEGE,
          "update document set version = '9.9' where id = $1",
          [WORDING],
        );
        // Retirement carries nothing in with it.
        await rejectsWith(
          client,
          INSUFFICIENT_PRIVILEGE,
          "update document set retired_at = now(), status = 'draft' where id = $1",
          [WORDING],
        );
        // And null is not a retirement: the one change admitted is null
        // becoming a time, once.
        await rejectsWith(
          client,
          INSUFFICIENT_PRIVILEGE,
          'update document set retired_at = null where id = $1',
          [WORDING],
        );
      });
    });
  });

  it('refuses to be deleted outside an erasure', async () => {
    // The API role holds no delete grant at all (090), so the guard is proved
    // with the role stamped on the owner's own connection: the same actor
    // app.erase_client runs as, without the erasure mark that excuses it.
    await rolledBack(client, async () => {
      await client.query("select set_config('app.actor_roles', 'owner', true)");
      await rejectsWith(client, INSUFFICIENT_PRIVILEGE, 'delete from document where id = $1', [
        WORDING,
      ]);
    });
  });

  it('lets an erasure remove it: a household asking to be forgotten outranks the rule', async () => {
    await rolledBack(client, async () => {
      await client.query("select set_config('app.actor_roles', 'owner', true)");
      await client.query("select set_config('app.actor_id', $1, true)", [IDS.ownerA]);
      await client.query('select app.begin_erasure()');

      await client.query('delete from document where id = $1', [WORDING]);
      const { rows } = await client.query('select id from document where id = $1', [WORDING]);
      expect(rows).toHaveLength(0);

      await client.query('select app.end_erasure()');
    });
  });

  it('never goes back to being mutable, not even inside an erasure', async () => {
    await rolledBack(client, async () => {
      await client.query("select set_config('app.actor_roles', 'owner', true)");
      await client.query("select set_config('app.actor_id', $1, true)", [IDS.ownerA]);
      await client.query('select app.begin_erasure()');

      const sql = 'update document set is_immutable = false where id = $1';
      await rejectsWith(client, INSUFFICIENT_PRIVILEGE, sql, [WORDING]);
      expect(await refusalMessage(sql, [WORDING])).toContain(
        'is_immutable never goes back to false',
      );

      await client.query('select app.end_erasure()');
    });
  });
});

describe("the guard and the owner's own maintenance", () => {
  it('stands aside when no role has been assumed at all', async () => {
    await rolledBack(client, async () => {
      // No app.actor_roles: a migration, a backfill or the seed's fixtures,
      // never a request, which always stamps one (096_api_role.sql).
      await fileDocument('00000000-0000-4000-8000-0000000000fb', {
        purpose: 'photo_video',
        locale: 'ar',
        version: '0.1-draft',
        status: 'draft',
        is_immutable: true,
      });
      await client.query('delete from document where id = $1', [
        '00000000-0000-4000-8000-0000000000fb',
      ]);
    });
  });
});
