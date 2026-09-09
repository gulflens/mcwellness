import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runJob } from '../../app/api/scheduler';
import { startPortalHarness, type PortalHarness } from '../portal/db/support';

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
    expect(lines[1]).toMatch(/^Scheduler: practice 1, /);
    for (const line of lines) {
      expect(line).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    }
  });
});
