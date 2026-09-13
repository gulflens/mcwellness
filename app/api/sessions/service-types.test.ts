import { Hono } from 'hono';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import type { Actor } from '@domain/shared';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { ServiceTypesResponse } from './schema';
import { mountServiceTypes } from './service-types';

/**
 * GET /api/sessions/service-types also carries `tenant.record_readings`
 * (migration 918) alongside the practitioner's own service types — how the
 * switch on Settings › Practice (PracticeDrawer.tsx) reaches the session
 * runner, which cannot read `/api/practice` at all (that route gates on
 * `practice.settings.write`, the owner and an admin, and a practitioner is
 * neither).
 *
 * `tests/session/db/service_types.test.ts` covers the credential filtering
 * end to end, against a real database; this file is the one place the flag
 * itself is proven, against a fake `Db`, because the behaviour under test is
 * entirely in how one column is read and passed through, not in row security
 * or credential resolution.
 */

const ACTOR: Actor = {
  userId: '00000000-0000-4000-8000-000000000001',
  tenantId: '00000000-0000-4000-8000-000000000000',
  roles: ['practitioner'],
  // Empty on purpose: with no credentialed service type the route's own
  // service-type query never runs (service-types.ts's `serviceTypeIds.length
  // === 0` branch), so the only statement the fake database has to answer is
  // the new one this test is about.
  capabilities: [],
};

type Answer = { rows: Record<string, unknown>[] };

/** A database that always answers the same way, regardless of what it is asked. */
function fakeDb(answer: Answer): Db {
  return {
    query: async () => answer as unknown as pg.QueryResult,
  };
}

function api(db: Db): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  app.use('*', async (c, next) => {
    c.set('requestId', '00000000-0000-4000-8000-000000000099');
    c.set('actor', ACTOR);
    c.set('db', db);
    await next();
  });
  mountServiceTypes(app);
  return app;
}

describe("GET /api/sessions/service-types — the practice's readings switch", () => {
  it('carries the flag off, when the practice has not turned it on', async () => {
    const res = await api(fakeDb({ rows: [{ record_readings: false }] })).request(
      '/api/sessions/service-types',
    );
    expect(res.status).toBe(200);
    expect(ServiceTypesResponse.parse(await res.json()).recordReadings).toBe(false);
  });

  it('reflects the stored value, not a constant, once the practice turns it on', async () => {
    const res = await api(fakeDb({ rows: [{ record_readings: true }] })).request(
      '/api/sessions/service-types',
    );
    expect(res.status).toBe(200);
    expect(ServiceTypesResponse.parse(await res.json()).recordReadings).toBe(true);
  });
});
