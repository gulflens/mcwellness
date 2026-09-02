import { Hono } from 'hono';
import { SignJWT } from 'jose';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { logRead } from '@app/api/_middleware/audit';
import { createPool } from '@app/api/_middleware/db';
import { withRequestContext, type ApiEnv } from '@app/api/_middleware/request-context';
import { createTokenVerifier } from '@app/api/_middleware/token-verifier';
import { createApi } from '@app/api/create-api';
import {
  AUTH,
  IDS,
  MORE_IDS,
  freshDatabase,
  seedClient,
  seedCredential,
  seedPractitioner,
  seedServiceType,
  seedTenant,
  seedUser,
} from './helpers';

const ISSUER = 'http://localhost:54321/auth/v1';
const SECRET = 'test-secret-not-real-0123456789abcdef';
const key = new TextEncoder().encode(SECRET);

function mint(sub: string, expiresIn: string | number = '5m'): Promise<string> {
  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience('authenticated')
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key);
}

type Json = Record<string, unknown>;

let owner: pg.Client;
let pool: pg.Pool;
let api: ReturnType<typeof createApi>;
let probe: Hono<ApiEnv>;
let tokens: {
  owner: string;
  admin: string;
  practitioner: string;
  contact: string;
  suspended: string;
  unknown: string;
};

beforeAll(async () => {
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio A');
  await owner.query('update app_user set auth_id = $1 where id = $2', [AUTH.ownerA, IDS.ownerA]);
  await seedUser(owner, {
    id: MORE_IDS.practitionerUserA,
    tenantId: IDS.tenantA,
    authId: AUTH.practitionerA,
    displayName: 'Synthetic Practitioner',
    roles: ['practitioner'],
  });
  await seedUser(owner, {
    id: MORE_IDS.adminUserA,
    tenantId: IDS.tenantA,
    authId: AUTH.adminA,
    displayName: 'Synthetic Admin',
    roles: ['admin'],
  });
  await seedUser(owner, {
    id: MORE_IDS.contactUserA,
    tenantId: IDS.tenantA,
    authId: AUTH.contactA,
    displayName: 'Synthetic Parent',
    roles: ['client_contact'],
  });
  await seedUser(owner, {
    id: MORE_IDS.suspendedUserA,
    tenantId: IDS.tenantA,
    authId: AUTH.suspendedA,
    displayName: 'Synthetic Suspended',
    status: 'suspended',
    roles: ['practitioner'],
  });
  await seedServiceType(owner, IDS.tenantA, MORE_IDS.serviceTypeA, 'nf-session');
  await seedPractitioner(owner, IDS.tenantA, MORE_IDS.practitionerA, MORE_IDS.practitionerUserA);
  await seedCredential(owner, {
    tenantId: IDS.tenantA,
    practitionerId: MORE_IDS.practitionerA,
    serviceTypeId: MORE_IDS.serviceTypeA,
    certification: 'bcia_bcn',
    validFrom: '2026-01-01',
    validTo: null,
    canExecuteSession: true,
  });
  await seedCredential(owner, {
    tenantId: IDS.tenantA,
    practitionerId: MORE_IDS.practitionerA,
    serviceTypeId: MORE_IDS.serviceTypeA,
    certification: 'vendor_qeeg',
    validFrom: '2020-01-01',
    validTo: '2021-01-01',
    canSignReport: true,
  });
  await seedClient(owner, IDS.tenantA, IDS.clientA, IDS.ownerA, 'Alpha');

  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) {
    throw new Error('API_DATABASE_URL is not set; copy .env.example to .env.');
  }
  pool = createPool(apiUrl);
  const verifier = createTokenVerifier({ issuer: ISSUER, secret: SECRET });
  api = createApi({ pool, verifier });
  probe = new Hono<ApiEnv>()
    .onError((_error, c) => c.json({ error: 'internal' }, 500))
    .use('*', withRequestContext({ pool, verifier }))
    .post('/probe/contact', async (c) => {
      await c
        .get('db')
        .query(
          "insert into contact (tenant_id, client_id, relationship) values (app.current_tenant_id(), $1, 'father')",
          [IDS.clientA],
        );
      return c.json({ ok: true });
    })
    .get('/probe/client/:id', async (c) => {
      const id = c.req.param('id');
      await logRead(c.get('db'), 'client', id, id);
      return c.json({ ok: true });
    })
    .post('/probe/grant/:role', async (c) => {
      // An expected refusal is handled with a savepoint so the transaction stays
      // healthy; without one the middleware would answer 500, by design.
      const db = c.get('db');
      await db.query('savepoint grant_probe');
      try {
        await db.query(
          'insert into user_role (tenant_id, user_id, role) values (app.current_tenant_id(), $1, $2::role_kind)',
          [c.get('actor').userId, c.req.param('role')],
        );
        return c.json({ ok: true });
      } catch (error) {
        await db.query('rollback to savepoint grant_probe');
        return c.json({ code: (error as { code?: string }).code }, 409);
      }
    })
    .post('/probe/escalate', async (c) => {
      // The two ways an admin might reach ownership through an update.
      const db = c.get('db');
      const me = c.get('actor').userId;
      await db.query('savepoint escalate');
      let promote: string | undefined;
      try {
        await db.query(
          "update user_role set role = 'owner' where user_id = $1 and role = 'admin'",
          [me],
        );
      } catch (error) {
        promote = (error as { code?: string }).code;
        await db.query('rollback to savepoint escalate');
      }
      const takeover = await db.query("update user_role set user_id = $1 where role = 'owner'", [
        me,
      ]);
      return c.json({ promote, takeover: takeover.rowCount });
    })
    .post('/probe/swallow', async (c) => {
      // A route that hides a database error must not be told it committed.
      try {
        await c
          .get('db')
          .query(
            'insert into user_role (tenant_id, user_id, role) values (app.current_tenant_id(), $1, $2::role_kind)',
            [c.get('actor').userId, 'nonsense'],
          );
      } catch {
        // swallowed on purpose
      }
      return c.json({ ok: true });
    })
    .patch('/probe/auth-id', async (c) => {
      // Row level security hides rows a person may not update, so a refused
      // update touches nothing rather than raising: the count is the proof.
      const result = await c
        .get('db')
        .query('update app_user set auth_id = $1 where id = $2', [AUTH.unknown, IDS.ownerA]);
      return c.json({ updated: result.rowCount ?? 0 });
    })
    .get('/probe/context', async (c) => {
      const { rows } = await c
        .get('db')
        .query<Json>(
          "select current_setting('app.tenant_id', true) as tenant, " +
            "current_setting('app.actor_id', true) as actor, " +
            "current_setting('app.actor_roles', true) as roles, " +
            "current_setting('app.request_id', true) as request, " +
            "current_setting('app.reason', true) as reason, current_user::text as role",
        );
      return c.json(rows[0] ?? {});
    });

  tokens = {
    owner: await mint(AUTH.ownerA),
    admin: await mint(AUTH.adminA),
    practitioner: await mint(AUTH.practitionerA),
    contact: await mint(AUTH.contactA),
    suspended: await mint(AUTH.suspendedA),
    unknown: await mint(AUTH.unknown),
  };
});

afterAll(async () => {
  await pool?.end();
  await owner?.end();
});

function bearer(
  token: string,
  extra: Record<string, string> = {},
): { headers: Record<string, string> } {
  return { headers: { authorization: `Bearer ${token}`, ...extra } };
}

describe('sign-in through the API', () => {
  it('refuses a missing, malformed or expired token with 401', async () => {
    expect((await api.request('/api/me')).status).toBe(401);
    expect((await api.request('/api/me', bearer('garbage'))).status).toBe(401);
    const expired = await mint(AUTH.ownerA, Math.floor(Date.now() / 1000) - 120);
    expect((await api.request('/api/me', bearer(expired))).status).toBe(401);
  });

  it('refuses a valid token for an unknown or suspended person with 403', async () => {
    expect((await api.request('/api/me', bearer(tokens.unknown))).status).toBe(403);
    expect((await api.request('/api/me', bearer(tokens.suspended))).status).toBe(403);
  });

  it('answers the owner with their roles and no capabilities', async () => {
    const res = await api.request('/api/me', bearer(tokens.owner));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      userId: IDS.ownerA,
      tenantId: IDS.tenantA,
      roles: ['owner'],
      capabilities: [],
    });
  });

  it('answers a practitioner with every credential and its dates, valid or not', async () => {
    const res = await api.request('/api/me', bearer(tokens.practitioner));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { roles: string[]; capabilities: Json[] };
    expect(body.roles).toEqual(['practitioner']);
    expect(body.capabilities).toHaveLength(2);
    expect(body.capabilities).toContainEqual({
      serviceTypeId: MORE_IDS.serviceTypeA,
      canExecuteSession: true,
      canAuthorProtocol: false,
      canSignReport: false,
      validFrom: '2026-01-01',
      validTo: null,
    });
    expect(body.capabilities).toContainEqual(
      expect.objectContaining({
        canSignReport: true,
        validFrom: '2020-01-01',
        validTo: '2021-01-01',
      }),
    );
  });
});

describe('the request context', () => {
  it('runs as the API role fenced to app_role with every setting stamped', async () => {
    const res = await probe.request(
      '/probe/context',
      bearer(tokens.practitioner, {
        'x-request-id': '00000000-0000-4000-8000-0000000000e1',
        'x-reason': 'first request',
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      tenant: IDS.tenantA,
      actor: MORE_IDS.practitionerUserA,
      roles: 'practitioner',
      request: '00000000-0000-4000-8000-0000000000e1',
      reason: 'first request',
      role: 'app_role',
    });
  });

  it('never leaks a previous request’s reason or actor on a pooled connection', async () => {
    const res = await probe.request('/probe/context', bearer(tokens.owner));
    const body = (await res.json()) as Json;
    expect(body.actor).toBe(IDS.ownerA);
    expect(body.roles).toBe('owner');
    expect(body.reason).toBe('');
  });

  it('stamps a write with the actor, their role, the request id and the reason', async () => {
    const requestId = '00000000-0000-4000-8000-0000000000e2';
    const res = await probe.request('/probe/contact', {
      method: 'POST',
      ...bearer(tokens.owner, { 'x-request-id': requestId, 'x-reason': 'adding a parent' }),
    });
    expect(res.status).toBe(200);
    const { rows } = await owner.query<Json>(
      "select actor_id, actor_role, reason, entity_type, client_id from audit_log where request_id = $1 and action = 'insert'",
      [requestId],
    );
    expect(rows).toEqual([
      {
        actor_id: IDS.ownerA,
        actor_role: 'owner',
        reason: 'adding a parent',
        entity_type: 'contact',
        client_id: IDS.clientA,
      },
    ]);
  });

  it('records a read as a chained audit row that only the same practice can see', async () => {
    const requestId = '00000000-0000-4000-8000-0000000000e3';
    const res = await probe.request(
      `/probe/client/${IDS.clientA}`,
      bearer(tokens.owner, { 'x-request-id': requestId }),
    );
    expect(res.status).toBe(200);
    const { rows } = await owner.query<Json>(
      'select action, entity_type, client_id, actor_id, actor_role, actor_type, row_hash is not null as chained from audit_log where request_id = $1',
      [requestId],
    );
    expect(rows).toEqual([
      {
        action: 'read',
        entity_type: 'client',
        client_id: IDS.clientA,
        actor_id: IDS.ownerA,
        actor_role: 'owner',
        actor_type: 'user',
        chained: true,
      },
    ]);
    const { rows: chain } = await owner.query<{ broken: string | null }>(
      'select app.verify_audit_chain()::text as broken',
    );
    expect(chain[0]?.broken).toBeNull();
  });

  it('lets the owner grant a role and refuses a practitioner who tries to grant themselves one', async () => {
    const asPractitioner = await probe.request('/probe/grant/admin', {
      method: 'POST',
      ...bearer(tokens.practitioner),
    });
    expect(asPractitioner.status).toBe(409);
    expect(await asPractitioner.json()).toEqual({ code: '42501' });

    const asOwner = await probe.request('/probe/grant/admin', {
      method: 'POST',
      ...bearer(tokens.owner),
    });
    expect(asOwner.status).toBe(200);
  });

  it('lets only the owner hand out ownership: an admin granting owner is refused', async () => {
    const asAdmin = await probe.request('/probe/grant/owner', {
      method: 'POST',
      ...bearer(tokens.admin),
    });
    expect(asAdmin.status).toBe(409);
    expect(await asAdmin.json()).toEqual({ code: '42501' });
    const asAdminOther = await probe.request('/probe/grant/finance', {
      method: 'POST',
      ...bearer(tokens.admin),
    });
    expect(asAdminOther.status).toBe(200);
  });

  it("lets no admin edit their way into ownership or take the owner's row", async () => {
    const before = await owner.query("select user_id from user_role where role = 'owner'");
    const res = await probe.request('/probe/escalate', { method: 'POST', ...bearer(tokens.admin) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ promote: '42501', takeover: 0 });
    const after = await owner.query("select user_id from user_role where role = 'owner'");
    expect(after.rows).toEqual(before.rows);
    expect(after.rows).toHaveLength(1);
  });

  it('answers 500 and saves nothing when a route swallows a database error', async () => {
    const res = await probe.request('/probe/swallow', { method: 'POST', ...bearer(tokens.owner) });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: 'internal',
      requestId: res.headers.get('X-Request-Id'),
    });
  });

  it("lets a practitioner touch no identity link but their own, so the owner's stays put", async () => {
    const res = await probe.request('/probe/auth-id', {
      method: 'PATCH',
      ...bearer(tokens.practitioner),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: 0 });
    const { rows } = await owner.query<{ auth_id: string }>(
      'select auth_id from app_user where id = $1',
      [IDS.ownerA],
    );
    expect(rows[0]?.auth_id).toBe(AUTH.ownerA);
  });

  it('gives the API role nothing outside a request, not even a count', async () => {
    await expect(pool.query('select count(*) from client')).rejects.toMatchObject({
      code: '42501',
    });
    await expect(pool.query('alter table client disable trigger audit_row')).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('resolves only active people, and only by their own auth id', async () => {
    await owner.query('begin');
    try {
      await owner.query('set local role app_role');
      for (const [authId, expected] of [
        [AUTH.unknown, 0],
        [AUTH.suspendedA, 0],
        [AUTH.practitionerA, 1],
      ] as const) {
        const { rows } = await owner.query('select user_id from app.resolve_actor($1)', [authId]);
        expect(rows, authId).toHaveLength(expected);
      }
    } finally {
      await owner.query('rollback');
    }
  });
});
