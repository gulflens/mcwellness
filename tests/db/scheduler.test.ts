import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clientDocumentKey } from '../../domain/shared';
import { runJob } from '../../app/api/scheduler';
import { IDS } from './helpers';
import { PORTAL, startPortalHarness, type PortalHarness } from '../portal/db/support';

/**
 * The scheduler against a real database (trunk round 39, migration 917): the
 * API role can list the practices through the definer and nothing else about
 * them, and both jobs run to completion as the API role with a request's
 * context, so the trail attributes their work as it attributes a request's.
 */

let h: PortalHarness;

beforeAll(async () => {
  h = await startPortalHarness();
});

afterAll(async () => {
  await h.close();
});

describe('the scheduler', () => {
  it('lets the API role list the practices through the definer, and not read the table', async () => {
    const client = await h.pool.connect();
    try {
      await client.query('begin');
      await client.query('set local role app_role');
      const listed = await client.query('select id from app.scheduled_tenants() as t(id)');
      expect(listed.rowCount).toBe(1);
      // With no practice context set, the table itself answers nothing.
      const direct = await client.query('select id from tenant');
      expect(direct.rowCount).toBe(0);
      await client.query('rollback');
    } finally {
      client.release();
    }
  });

  it("sweeps an erasure's pending file as the API role, past the guard from 105 (migration 962)", async () => {
    // A performed erasure with one key still pending, as app.erase_client leaves
    // it when the store refused at the time. Nothing is in the store under it,
    // so the sweep strikes it off without deleting.
    const key = clientDocumentKey(
      IDS.tenantA,
      PORTAL.childA,
      '0000000d-0000-4000-8000-000000000962',
    );
    const inserted = await h.owner.query<{ id: string }>(
      'insert into erasure_request (tenant_id, client_id, reason, performed_at, storage_keys_pending, requested_by_phone) ' +
        "values ($1, $2, 'the household asked', now(), $3::jsonb, '+971500000062') returning id",
      [
        IDS.tenantA,
        PORTAL.childA,
        JSON.stringify([{ id: '0000000d-0000-4000-8000-000000000962', storageKey: key }]),
      ],
    );
    const id = inserted.rows[0]?.id;
    const lines: string[] = [];
    await runJob('erasure-files', {
      pool: h.pool,
      storage: h.storage,
      log: (line) => lines.push(line),
    });
    expect(lines[0]).toMatch(
      /^Scheduler: practice 1, 1 erasure request swept: 1 file now gone, 0 still in the store/,
    );
    const after = await h.owner.query<{ pending: unknown; cleared: Date | null }>(
      'select storage_keys_pending as pending, files_cleared_at as cleared from erasure_request where id = $1',
      [id],
    );
    expect(after.rows[0]?.pending).toEqual([]);
    expect(after.rows[0]?.cleared).not.toBeNull();
  });

  it('runs both jobs to completion as the API role, and says what it did without an id', async () => {
    const lines: string[] = [];
    await runJob('post-books', {
      pool: h.pool,
      storage: h.storage,
      log: (line) => lines.push(line),
    });
    await runJob('erasure-files', {
      pool: h.pool,
      storage: h.storage,
      log: (line) => lines.push(line),
    });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^Scheduler: practice 1, posted \d+, unknown \d+\.$/);
    expect(lines[1]).toMatch(
      /^Scheduler: practice 1, (No erasure has files left|\d+ erasure requests? swept)/,
    );
    for (const line of lines) {
      expect(line).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    }
  });
});
