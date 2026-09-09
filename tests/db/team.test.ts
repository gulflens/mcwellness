import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IDS } from './helpers';
import { PORTAL, startPortalHarness, type PortalHarness } from '../portal/db/support';

/**
 * `/api/team` against a real database, through the API the server builds,
 * with the fake sign-in provider the harness carries (trunk round 39,
 * 2026-09-10). Names from db/seed/names.ts; addresses at example.com.
 */

let h: PortalHarness;

beforeAll(async () => {
  h = await startPortalHarness();
});

afterAll(async () => {
  await h.close();
});

describe('who works at the practice', () => {
  it('lists the staff and not the household contacts, for the owner and an admin only', async () => {
    const res = await h.callAs('GET', '/api/team', PORTAL.adminAuth);
    expect(res.status).toBe(200);
    const { members } = (await res.json()) as {
      members: { id: string; roles: string[]; isYou: boolean }[];
    };
    expect(members.length).toBeGreaterThanOrEqual(2);
    for (const member of members) {
      expect(member.roles).not.toEqual(['client_contact']);
    }
    expect(members.find((m) => m.id === PORTAL.admin)?.isYou).toBe(true);
    expect((await h.callAs('GET', '/api/team', PORTAL.leadAuth)).status).toBe(403);
    expect((await h.callAs('GET', '/api/team', PORTAL.practitionerAuth)).status).toBe(403);
    expect((await h.callAs('GET', '/api/team', PORTAL.financeAuth)).status).toBe(403);
  });

  it('creates a colleague with a temporary password who can then sign in, and refuses the address twice', async () => {
    const res = await h.callAs('POST', '/api/team', PORTAL.adminAuth, {
      displayName: 'Rowan Meadow',
      email: 'rowan@example.com',
      roles: ['finance', 'practitioner'],
    });
    expect(res.status).toBe(201);
    const { userId, temporaryPassword } = (await res.json()) as {
      userId: string;
      temporaryPassword: string;
    };
    expect(temporaryPassword.length).toBeGreaterThanOrEqual(12);

    // The fake provider hands the sign-in an auth id; the fence resolves it.
    const { rows } = await h.owner.query<{ auth_id: string; status: string }>(
      'select auth_id, status::text as status from app_user where id = $1',
      [userId],
    );
    expect(rows[0]?.status).toBe('active');
    const me = await h.callAs('GET', '/api/me', rows[0]?.auth_id ?? '');
    expect(me.status).toBe(200);
    const body = (await me.json()) as { roles: string[] };
    expect([...body.roles].sort()).toEqual(['finance', 'practitioner']);

    // Both rows are in the trail, under the person who pressed the button.
    const trail = await h.owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where actor_id = $1 and entity_type in ('app_user', 'user_role') and entity_id = $2",
      [PORTAL.admin, userId],
    );
    expect(Number(trail.rows[0]?.n)).toBeGreaterThanOrEqual(1);

    const again = await h.callAs('POST', '/api/team', PORTAL.adminAuth, {
      displayName: 'Rowan Meadow',
      email: 'rowan@example.com',
      roles: ['finance'],
    });
    expect(again.status).toBe(409);
  });

  it('never offers ownership, and refuses a body without a working role', async () => {
    for (const roles of [['owner'], ['client_contact'], []]) {
      const res = await h.callAs('POST', '/api/team', PORTAL.adminAuth, {
        displayName: 'Basil Valley',
        email: 'basil@example.com',
        roles,
      });
      expect(res.status).toBe(400);
    }
  });

  it('grants one more role, suspends a colleague so the fence refuses them, and refuses to suspend yourself', async () => {
    const made = await h.callAs('POST', '/api/team', PORTAL.adminAuth, {
      displayName: 'Iris Creek',
      email: 'iris.creek@example.com',
      roles: ['practitioner'],
    });
    expect(made.status).toBe(201);
    const { userId } = (await made.json()) as { userId: string };
    const { rows } = await h.owner.query<{ auth_id: string }>(
      'select auth_id from app_user where id = $1',
      [userId],
    );
    const authId = rows[0]?.auth_id ?? '';

    // Nobody widens their own access.
    expect(
      (
        await h.callAs('POST', `/api/team/${PORTAL.admin}/roles`, PORTAL.adminAuth, {
          role: 'finance',
        })
      ).status,
    ).toBe(400);
    expect(
      (await h.callAs('POST', `/api/team/${userId}/roles`, PORTAL.adminAuth, { role: 'finance' }))
        .status,
    ).toBe(200);
    // Idempotent: the same role again is not an error.
    expect(
      (await h.callAs('POST', `/api/team/${userId}/roles`, PORTAL.adminAuth, { role: 'finance' }))
        .status,
    ).toBe(200);
    const roles = await h.owner.query<{ roles: string }>(
      "select string_agg(role::text, '+' order by role::text) as roles from user_role where user_id = $1",
      [userId],
    );
    expect(roles.rows[0]?.roles).toBe('finance+practitioner');

    expect(
      (
        await h.callAs('POST', `/api/team/${PORTAL.admin}/status`, PORTAL.adminAuth, {
          status: 'suspended',
        })
      ).status,
    ).toBe(400);

    expect(
      (
        await h.callAs('POST', `/api/team/${userId}/status`, PORTAL.adminAuth, {
          status: 'suspended',
        })
      ).status,
    ).toBe(200);
    expect((await h.callAs('GET', '/api/me', authId)).status).not.toBe(200);

    expect(
      (await h.callAs('POST', `/api/team/${userId}/status`, PORTAL.adminAuth, { status: 'active' }))
        .status,
    ).toBe(200);
    expect((await h.callAs('GET', '/api/me', authId)).status).toBe(200);

    // An admin cannot touch the owner's row: row security keeps it the owner's
    // (role_guard.sql), which answers here as nothing to update.
    expect(
      (
        await h.callAs('POST', `/api/team/${IDS.ownerA}/status`, PORTAL.adminAuth, {
          status: 'suspended',
        })
      ).status,
    ).toBe(404);
    const ownerStatus = await h.owner.query<{ status: string }>(
      'select status::text as status from app_user where id = $1',
      [IDS.ownerA],
    );
    expect(ownerStatus.rows[0]?.status).toBe('active');

    // A lost temporary password is replaced, the act is in the trail, the
    // password is not.
    const reset = await h.callAs('POST', `/api/team/${userId}/password`, PORTAL.adminAuth);
    expect(reset.status).toBe(200);
    const fresh = (await reset.json()) as { temporaryPassword: string };
    expect(fresh.temporaryPassword.length).toBeGreaterThanOrEqual(12);
    const resetTrail = await h.owner.query<{ n: string; leaked: string }>(
      "select count(*)::text as n, count(*) filter (where new_values::text like '%' || $3 || '%')::text as leaked " +
        "from audit_log where action = 'password_reset' and entity_id = $1 and actor_id = $2",
      [userId, PORTAL.admin, fresh.temporaryPassword],
    );
    expect(resetTrail.rows[0]).toEqual({ n: '1', leaked: '0' });
    expect((await h.callAs('GET', '/api/me', authId)).status).toBe(200);

    // A practitioner may do none of it.
    expect(
      (
        await h.callAs('POST', `/api/team/${userId}/status`, PORTAL.practitionerAuth, {
          status: 'suspended',
        })
      ).status,
    ).toBe(403);
    expect(
      (await h.callAs('POST', '/api/team/not-an-id/roles', PORTAL.adminAuth, { role: 'finance' }))
        .status,
    ).toBe(404);
  });
});
