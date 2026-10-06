import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IDS, seedUser } from './helpers';
import {
  PORTAL,
  seedAppointment,
  startPortalHarness,
  type PortalHarness,
} from '../portal/db/support';

/**
 * `POST /api/team/:id/archive` and `/restore` against a real database, through
 * the API the server builds (migration 977, app/api/team/archive.ts). The
 * practice asked to be able to remove a person; removing is archiving.
 *
 * Every refusal is read back from the row as well as from the status code,
 * because beneath the routes a forbidden update is silence rather than an
 * error (tests/db/team.test.ts says why that matters).
 *
 * Names from db/seed/names.ts; ids in this file's own 977x block.
 */

/** The sign-in the portal harness gives the practice's owner (tests/portal/db/support.ts). */
const OWNER_AUTH = '00000001-0000-4000-8000-000000000010';
const SECOND_OWNER = '00000001-0000-4000-8000-000000009771';
const NOBODY = '00000001-0000-4000-8000-0000000097ef';
const VISIT = '00000001-0000-4000-8000-000000009772';
const REASON = { 'x-reason': 'Left the practice at the end of the month' };

let h: PortalHarness;

beforeAll(async () => {
  h = await startPortalHarness();
  await seedUser(h.owner, {
    id: SECOND_OWNER,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Hazel Lagoon',
    roles: ['owner'],
  });
});

afterAll(async () => {
  await h.close();
});

async function statusOf(userId: string): Promise<string | undefined> {
  const { rows } = await h.owner.query<{ status: string }>(
    'select status::text as status from app_user where id = $1',
    [userId],
  );
  return rows[0]?.status;
}

const archive = (id: string, auth = OWNER_AUTH, headers: Record<string, string> = REASON) =>
  h.callAs('POST', `/api/team/${id}/archive`, auth, {}, headers);
const restore = (id: string, auth = OWNER_AUTH) =>
  h.callAs('POST', `/api/team/${id}/restore`, auth, {});

describe('archiving a colleague', () => {
  it('is refused to an admin and to a lead practitioner, and nothing moves', async () => {
    expect((await archive(PORTAL.finance, PORTAL.adminAuth)).status).toBe(403);
    expect((await archive(PORTAL.finance, PORTAL.leadAuth)).status).toBe(403);
    expect(await statusOf(PORTAL.finance)).toBe('active');
  });

  it('asks for a reason before anything else, and refuses yourself and an owner', async () => {
    const bare = await archive(PORTAL.finance, OWNER_AUTH, {});
    expect(bare.status).toBe(400);
    expect(await bare.json()).toMatchObject({ error: 'reason_required' });
    expect(await statusOf(PORTAL.finance)).toBe('active');

    const self = await archive(IDS.ownerA);
    expect(self.status).toBe(400);
    expect(await self.json()).toMatchObject({ error: 'not_yourself' });

    const other = await archive(SECOND_OWNER);
    expect(other.status).toBe(409);
    expect(await other.json()).toMatchObject({ error: 'locked' });
    expect(await statusOf(SECOND_OWNER)).toBe('active');

    expect((await archive(NOBODY)).status).toBe(404);
    expect((await archive('not-an-id')).status).toBe(404);
    // A household contact is not a colleague.
    expect((await archive(PORTAL.motherUser)).status).toBe(404);
  });

  it('refuses a practitioner with a visit ahead, and says which, until it is reassigned', async () => {
    await seedAppointment(h.owner, {
      id: VISIT,
      clientId: PORTAL.childA,
      inDays: 3,
      hour: 10,
      status: 'confirmed',
    });
    const blocked = await archive(PORTAL.practitioner);
    expect(blocked.status).toBe(409);
    const body = (await blocked.json()) as {
      error: string;
      visits: { appointmentId: string; windowStart: string }[];
    };
    expect(body.error).toBe('future_visits');
    expect(body.visits.map((v) => v.appointmentId)).toContain(VISIT);
    expect(await statusOf(PORTAL.practitioner)).toBe('active');

    // Cancelled, it holds nothing up — nor does any other visit in the past.
    await h.owner.query("update appointment set status = 'cancelled' where id = $1", [VISIT]);
    await h.owner.query(
      "update appointment set status = 'cancelled' where practitioner_id = $1 " +
        "and status in ('proposed', 'confirmed', 'checked_in') and window_end > now()",
      [PORTAL.practitionerRow],
    );

    const done = await archive(PORTAL.practitioner);
    expect(done.status).toBe(200);
    expect(await statusOf(PORTAL.practitioner)).toBe('archived');

    // Their sign-in is refused at the door, exactly as a suspended one is.
    expect((await h.callAs('GET', '/api/me', PORTAL.practitionerAuth)).status).toBe(403);

    // They are gone from the practitioners booking reads, and still on the
    // team list, as Archived, for the owner to restore.
    const pickers = await h.callAs('GET', '/api/practitioners', OWNER_AUTH);
    expect(pickers.status).toBe(200);
    expect(JSON.stringify(await pickers.json())).not.toContain(PORTAL.practitionerRow);
    const team = (await (await h.callAs('GET', '/api/team', OWNER_AUTH)).json()) as {
      members: { id: string; status: string }[];
    };
    expect(team.members.find((m) => m.id === PORTAL.practitioner)?.status).toBe('archived');

    // Suspend's route does not touch an archived person either way.
    expect(
      (
        await h.callAs('POST', `/api/team/${PORTAL.practitioner}/status`, OWNER_AUTH, {
          status: 'active',
        })
      ).status,
    ).toBe(404);
    // And archiving again says so.
    const again = await archive(PORTAL.practitioner);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: 'already_archived' });

    // The act is in the trail under the owner, with the reason.
    const trail = await h.owner.query<{ actor_id: string; reason: string }>(
      "select actor_id, reason from audit_log where action = 'staff_archived' and entity_id = $1",
      [PORTAL.practitioner],
    );
    expect(trail.rows).toEqual([
      { actor_id: IDS.ownerA, reason: 'Left the practice at the end of the month' },
    ]);
  });
});

describe('restoring a colleague', () => {
  it('is the owner’s alone, brings the sign-in and the practitioner back, and only once', async () => {
    expect(await statusOf(PORTAL.practitioner)).toBe('archived');
    expect((await restore(PORTAL.practitioner, PORTAL.adminAuth)).status).toBe(403);
    expect(await statusOf(PORTAL.practitioner)).toBe('archived');

    const restored = await restore(PORTAL.practitioner);
    expect(restored.status).toBe(200);
    // The status the person is back at, so the screen shows it without guessing.
    expect(await restored.json()).toEqual({ ok: true, status: 'active' });
    expect(await statusOf(PORTAL.practitioner)).toBe('active');
    expect((await h.callAs('GET', '/api/me', PORTAL.practitionerAuth)).status).toBe(200);
    const pickers = await h.callAs('GET', '/api/practitioners', OWNER_AUTH);
    expect(JSON.stringify(await pickers.json())).toContain(PORTAL.practitionerRow);

    const again = await restore(PORTAL.practitioner);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: 'not_archived' });
    const self = await restore(IDS.ownerA);
    expect(self.status).toBe(400);
    expect((await restore(NOBODY)).status).toBe(404);
  });
});
