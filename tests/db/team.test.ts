import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { IDS, seedUser } from './helpers';
import { AuthAdminUnavailableError, EmailInUseError } from '../../app/api/portal/auth-admin';
import { PORTAL, startPortalHarness, type PortalHarness } from '../portal/db/support';

/**
 * `/api/team` against a real database, through the API the server builds,
 * with the fake sign-in provider the harness carries (trunk round 39,
 * 2026-09-10; rewritten for round 58, 2026-09-21).
 *
 * **Who acts, and why it changed.** Everything but the list is the owner's now
 * (the operator's decision of 21 September, design section 5), so every case
 * that adds a colleague, switches a role, suspends a sign-in or mints a
 * password acts as the owner, and each has a twin proving that an admin is
 * answered 403 and that nothing moved. The twins matter more than they look:
 * beneath the routes an admin's forbidden UPDATE is now silence rather than an
 * error — row security matches no row and raises nothing — so a route that
 * forgot its guard would answer cheerfully and change nothing, and only a test
 * that reads the row back can tell the difference.
 *
 * Names from db/seed/names.ts; addresses at example.com; telephone numbers in
 * the hand-written +971 50 000 00xx block (.claude/rules/testing.md).
 */

/** The sign-in the portal harness gives the practice's owner (tests/portal/db/support.ts). */
const OWNER_AUTH = '00000001-0000-4000-8000-000000000010';

/**
 * The practice's second owner. Ownership is written as a row by an audited
 * data step and never by a screen (design section 3), so this person is
 * seeded, and every case that asks what one owner may do to the other asks
 * about them.
 */
const SECOND_OWNER = '00000001-0000-4000-8000-0000000000e1';
const SECOND_OWNER_AUTH = '00000001-0000-4000-8000-0000000000e2';

/** An id in the reserved shape that names nobody at all. */
const NOBODY = '00000001-0000-4000-8000-0000000000ef';

type TeamRow = {
  id: string;
  displayName: string;
  roles: string[];
  isYou: boolean;
  locked: boolean;
  jobTitle: string | null;
};

type ProfileRow = TeamRow & {
  email: string | null;
  status: string;
  phone: string | null;
  preferredLocale: string;
  startedOn: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  privateNotes: string | null;
  editable: boolean;
};

let h: PortalHarness;

beforeAll(async () => {
  h = await startPortalHarness();
  await seedUser(h.owner, {
    id: SECOND_OWNER,
    tenantId: IDS.tenantA,
    authId: SECOND_OWNER_AUTH,
    displayName: 'Hazel Lagoon',
    roles: ['owner'],
  });
});

afterAll(async () => {
  await h.close();
});

/** A colleague, added the way the screen adds one: by the owner. */
async function addColleague(
  displayName: string,
  email: string,
  roles: readonly string[],
): Promise<{ userId: string; authId: string }> {
  const res = await h.callAs('POST', '/api/team', OWNER_AUTH, { displayName, email, roles });
  expect(res.status).toBe(201);
  const { userId } = (await res.json()) as { userId: string };
  const { rows } = await h.owner.query<{ auth_id: string }>(
    'select auth_id from app_user where id = $1',
    [userId],
  );
  return { userId, authId: rows[0]?.auth_id ?? '' };
}

/** A whole profile body: every field is sent on every save, as the drawer sends it. */
function profileBody(
  displayName: string,
  email: string,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    displayName,
    email,
    phone: null,
    preferredLocale: 'en',
    jobTitle: null,
    startedOn: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    privateNotes: null,
    ...over,
  };
}

async function rolesOf(userId: string): Promise<string | null> {
  const { rows } = await h.owner.query<{ roles: string | null }>(
    "select string_agg(role::text, '+' order by role::text) as roles from user_role where user_id = $1",
    [userId],
  );
  return rows[0]?.roles ?? null;
}

describe('who works at the practice', () => {
  it('lists the staff and not the household contacts, for the owner and an admin only', async () => {
    const res = await h.callAs('GET', '/api/team', PORTAL.adminAuth);
    expect(res.status).toBe(200);
    const { members } = (await res.json()) as { members: TeamRow[] };
    expect(members.length).toBeGreaterThanOrEqual(2);
    for (const member of members) {
      expect(member.roles).not.toEqual(['client_contact']);
    }
    expect(members.find((m) => m.id === PORTAL.admin)?.isYou).toBe(true);
    expect((await h.callAs('GET', '/api/team', PORTAL.leadAuth)).status).toBe(403);
    expect((await h.callAs('GET', '/api/team', PORTAL.practitionerAuth)).status).toBe(403);
    expect((await h.callAs('GET', '/api/team', PORTAL.financeAuth)).status).toBe(403);
  });

  it('carries the lock on an owner, and a job title for an owner and never for an admin', async () => {
    const { userId } = await addColleague('Fern Bay', 'fern.bay@example.com', ['practitioner']);
    await h.owner.query(
      'insert into staff_profile (tenant_id, user_id, job_title, created_by) ' +
        "values ($1, $2, 'Coordinator', $3)",
      [IDS.tenantA, userId, IDS.ownerA],
    );

    const owned = (await (await h.callAs('GET', '/api/team', OWNER_AUTH)).json()) as {
      members: TeamRow[];
    };
    expect(owned.members.find((m) => m.id === IDS.ownerA)?.locked).toBe(true);
    expect(owned.members.find((m) => m.id === SECOND_OWNER)?.locked).toBe(true);
    expect(owned.members.find((m) => m.id === PORTAL.admin)?.locked).toBe(false);
    expect(owned.members.find((m) => m.id === userId)?.jobTitle).toBe('Coordinator');

    const asAdmin = await h.callAs('GET', '/api/team', PORTAL.adminAuth);
    expect(asAdmin.status).toBe(200);
    const seen = (await asAdmin.json()) as { members: TeamRow[] };
    expect(seen.members.find((m) => m.id === IDS.ownerA)?.locked).toBe(true);
    expect(seen.members.find((m) => m.id === userId)).toBeDefined();
    for (const member of seen.members) {
      expect(member.jobTitle).toBeNull();
    }
  });

  it('creates a colleague with a temporary password who can then sign in, and refuses the address twice', async () => {
    const res = await h.callAs('POST', '/api/team', OWNER_AUTH, {
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
      [IDS.ownerA, userId],
    );
    expect(Number(trail.rows[0]?.n)).toBeGreaterThanOrEqual(1);

    const again = await h.callAs('POST', '/api/team', OWNER_AUTH, {
      displayName: 'Rowan Meadow',
      email: 'rowan@example.com',
      roles: ['finance'],
    });
    expect(again.status).toBe(409);
  });

  it('refuses an admin who tries to add a colleague, and mints no sign-in for them', async () => {
    const before = await h.owner.query<{ n: string }>('select count(*)::text as n from app_user');
    const createUser = vi.spyOn(h.authAdmin, 'createUser');
    try {
      const res = await h.callAs('POST', '/api/team', PORTAL.adminAuth, {
        displayName: 'Clover Bay',
        email: 'clover.bay@example.com',
        roles: ['practitioner'],
      });
      expect(res.status).toBe(403);
      // Refused before the sign-in service is reached, so no address is taken
      // by a request that changed nothing.
      expect(createUser).not.toHaveBeenCalled();
    } finally {
      createUser.mockRestore();
    }
    const after = await h.owner.query<{ n: string }>('select count(*)::text as n from app_user');
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  it("records a person's own password change as an act under their id, and nothing else", async () => {
    const res = await h.callAs('POST', '/api/me/password-changed', PORTAL.practitionerAuth);
    expect(res.status).toBe(200);
    const trail = await h.owner.query<{ n: string; values: string | null }>(
      'select count(*)::text as n, max(new_values::text) as values from audit_log ' +
        "where action = 'password_changed' and entity_type = 'app_user' and entity_id = $1 and actor_id = $1",
      [PORTAL.practitioner],
    );
    expect(trail.rows[0]?.n).toBe('1');
    expect(trail.rows[0]?.values ?? '{}').toBe('{}');
  });

  it('never offers ownership, and refuses a body without a working role', async () => {
    for (const roles of [['owner'], ['client_contact'], []]) {
      const res = await h.callAs('POST', '/api/team', OWNER_AUTH, {
        displayName: 'Basil Valley',
        email: 'basil@example.com',
        roles,
      });
      expect(res.status).toBe(400);
    }
  });

  it('suspends a colleague so the fence refuses them, reactivates them, refuses to suspend yourself, and replaces a lost password', async () => {
    const { userId, authId } = await addColleague('Iris Creek', 'iris.creek@example.com', [
      'practitioner',
    ]);

    // Nobody shuts their own door: the practice's owner locking themselves out
    // is an outage, not a decision.
    expect(
      (
        await h.callAs('POST', `/api/team/${IDS.ownerA}/status`, OWNER_AUTH, {
          status: 'suspended',
        })
      ).status,
    ).toBe(400);

    expect(
      (await h.callAs('POST', `/api/team/${userId}/status`, OWNER_AUTH, { status: 'suspended' }))
        .status,
    ).toBe(200);
    expect((await h.callAs('GET', '/api/me', authId)).status).not.toBe(200);

    expect(
      (await h.callAs('POST', `/api/team/${userId}/status`, OWNER_AUTH, { status: 'active' }))
        .status,
    ).toBe(200);
    expect((await h.callAs('GET', '/api/me', authId)).status).toBe(200);

    // A lost temporary password is replaced, the act is in the trail, the
    // password is not.
    const reset = await h.callAs('POST', `/api/team/${userId}/password`, OWNER_AUTH);
    expect(reset.status).toBe(200);
    const fresh = (await reset.json()) as { temporaryPassword: string };
    expect(fresh.temporaryPassword.length).toBeGreaterThanOrEqual(12);
    const resetTrail = await h.owner.query<{ n: string; leaked: string }>(
      "select count(*)::text as n, count(*) filter (where new_values::text like '%' || $3 || '%')::text as leaked " +
        "from audit_log where action = 'password_reset' and entity_id = $1 and actor_id = $2",
      [userId, IDS.ownerA, fresh.temporaryPassword],
    );
    expect(resetTrail.rows[0]).toEqual({ n: '1', leaked: '0' });
    expect((await h.callAs('GET', '/api/me', authId)).status).toBe(200);

    // A practitioner may do none of it, and an id that names nobody is not found.
    expect(
      (
        await h.callAs('POST', `/api/team/${userId}/status`, PORTAL.practitionerAuth, {
          status: 'suspended',
        })
      ).status,
    ).toBe(403);
    expect((await h.callAs('PUT', '/api/team/not-an-id/roles/finance', OWNER_AUTH)).status).toBe(
      404,
    );
  });

  it('refuses an admin every act on a colleague but the list, and the colleague is exactly as they were', async () => {
    const { userId } = await addColleague('Laurel Valley', 'laurel.valley@example.com', [
      'practitioner',
    ]);
    const attempts: (() => Promise<Response>)[] = [
      () => h.callAs('GET', `/api/team/${userId}`, PORTAL.adminAuth),
      () =>
        h.callAs(
          'PATCH',
          `/api/team/${userId}`,
          PORTAL.adminAuth,
          profileBody('Laurel Summit', 'laurel.summit@example.com'),
        ),
      () => h.callAs('PUT', `/api/team/${userId}/roles/finance`, PORTAL.adminAuth),
      () => h.callAs('DELETE', `/api/team/${userId}/roles/practitioner`, PORTAL.adminAuth),
      () =>
        h.callAs('POST', `/api/team/${userId}/status`, PORTAL.adminAuth, { status: 'suspended' }),
    ];
    for (const attempt of attempts) {
      const res = await attempt();
      expect(res.status, await res.clone().text()).toBe(403);
    }

    // Every one of those is a write an admin's row security would now answer
    // with silence rather than an error, so the row is read back in full.
    const { rows } = await h.owner.query<{
      display_name: string;
      email: string | null;
      status: string;
    }>('select display_name, email, status::text as status from app_user where id = $1', [userId]);
    expect(rows[0]).toEqual({
      display_name: 'Laurel Valley',
      email: 'laurel.valley@example.com',
      status: 'active',
    });
    expect(await rolesOf(userId)).toBe('practitioner');
  });

  // Trunk round 57, 2026-09-21. Suspending the owner is refused by row
  // security; a password is set at the sign-in service, past row security, so
  // the route is the only thing that can refuse it.
  it("never lets an admin mint a password for the owner's sign-in", async () => {
    const setPassword = vi.spyOn(h.authAdmin, 'setPassword');
    try {
      const res = await h.callAs('POST', `/api/team/${IDS.ownerA}/password`, PORTAL.adminAuth);
      expect(res.status).toBe(403);
      expect(JSON.stringify(await res.json())).not.toContain('temporaryPassword');
      expect(setPassword).not.toHaveBeenCalled();
    } finally {
      setPassword.mockRestore();
    }
    const trail = await h.owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'password_reset' and entity_id = $1",
      [IDS.ownerA],
    );
    expect(trail.rows[0]?.n).toBe('0');
    // The screen offers no such button, so this request was made by hand and
    // aimed at the owner: the one refusal here worth a row of its own.
    const refused = await h.owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'password_reset_refused' and entity_id = $1 and actor_id = $2",
      [IDS.ownerA, PORTAL.admin],
    );
    expect(refused.rows[0]?.n).toBe('1');
  });

  it('never lets an admin mint a password for a colleague who holds finance either', async () => {
    const setPassword = vi.spyOn(h.authAdmin, 'setPassword');
    try {
      const res = await h.callAs('POST', `/api/team/${PORTAL.finance}/password`, PORTAL.adminAuth);
      // The guard on this route is deliberately the wider one, so that an
      // attempt made by hand reaches canResetPassword and is written down; a
      // 403 at the first guard would leave no row at all (design section 5).
      expect(res.status).toBe(403);
      expect(JSON.stringify(await res.json())).not.toContain('temporaryPassword');
      expect(setPassword).not.toHaveBeenCalled();
    } finally {
      setPassword.mockRestore();
    }
    const refused = await h.owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'password_reset_refused' and entity_id = $1 and actor_id = $2",
      [PORTAL.finance, PORTAL.admin],
    );
    expect(refused.rows[0]?.n).toBe('1');
  });

  it('lets one owner mint a password for another, which is how a locked-out owner gets back in', async () => {
    const res = await h.callAs('POST', `/api/team/${SECOND_OWNER}/password`, OWNER_AUTH);
    expect(res.status).toBe(200);
    const trail = await h.owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'password_reset' and entity_id = $1 and actor_id = $2",
      [SECOND_OWNER, IDS.ownerA],
    );
    expect(trail.rows[0]?.n).toBe('1');
  });

  it("opens a colleague's profile for an owner, writes one read to the trail, and finds nobody else", async () => {
    const { userId } = await addColleague('Olive Creek', 'olive.creek@example.com', ['finance']);
    const res = await h.callAs('GET', `/api/team/${userId}`, OWNER_AUTH);
    expect(res.status).toBe(200);
    const profile = (await res.json()) as ProfileRow;
    expect(profile).toMatchObject({
      id: userId,
      displayName: 'Olive Creek',
      email: 'olive.creek@example.com',
      status: 'active',
      roles: ['finance'],
      isYou: false,
      locked: false,
      editable: true,
      phone: null,
      preferredLocale: 'en',
      jobTitle: null,
      startedOn: null,
      emergencyContactName: null,
      emergencyContactPhone: null,
      privateNotes: null,
    });

    // Opening a profile is a read of a person, and the trail says so once.
    const trail = await h.owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'read' and entity_type = 'app_user' " +
        'and entity_id = $1 and actor_id = $2',
      [userId, IDS.ownerA],
    );
    expect(trail.rows[0]?.n).toBe('1');

    expect((await h.callAs('GET', `/api/team/${userId}`, PORTAL.adminAuth)).status).toBe(403);
    expect((await h.callAs('GET', `/api/team/${NOBODY}`, OWNER_AUTH)).status).toBe(404);
    // A household's contact is not staff and is not found here.
    expect((await h.callAs('GET', `/api/team/${PORTAL.motherUser}`, OWNER_AUTH)).status).toBe(404);
  });

  it('saves the name, the phone and all five profile fields, empties a note to null, and keeps the note out of the trail', async () => {
    const { userId } = await addColleague('Sage Ridge', 'sage.ridge@example.com', ['practitioner']);
    const full = profileBody('Sage Quarry', 'sage.ridge@example.com', {
      phone: '+971500000051',
      preferredLocale: 'ar',
      jobTitle: 'Lead coordinator',
      startedOn: '2026-03-01',
      emergencyContactName: 'Amber Orchard',
      emergencyContactPhone: '+971500000052',
      privateNotes: 'Probation ends at the quarter.',
    });
    const saved = await h.callAs('PATCH', `/api/team/${userId}`, OWNER_AUTH, full);
    expect(saved.status, await saved.clone().text()).toBe(200);

    const back = (await (
      await h.callAs('GET', `/api/team/${userId}`, OWNER_AUTH)
    ).json()) as ProfileRow;
    expect(back).toMatchObject({
      displayName: 'Sage Quarry',
      phone: '+971500000051',
      preferredLocale: 'ar',
      jobTitle: 'Lead coordinator',
      startedOn: '2026-03-01',
      emergencyContactName: 'Amber Orchard',
      emergencyContactPhone: '+971500000052',
      privateNotes: 'Probation ends at the quarter.',
    });

    // The same save with the note cleared: an empty box is nothing recorded.
    const emptied = await h.callAs('PATCH', `/api/team/${userId}`, OWNER_AUTH, {
      ...full,
      privateNotes: '',
      emergencyContactName: '',
    });
    expect(emptied.status).toBe(200);
    const { rows } = await h.owner.query<{
      private_notes: string | null;
      emergency_contact_name: string | null;
      job_title: string | null;
    }>(
      'select private_notes, emergency_contact_name, job_title from staff_profile where user_id = $1',
      [userId],
    );
    expect(rows[0]).toEqual({
      private_notes: null,
      emergency_contact_name: null,
      job_title: 'Lead coordinator',
    });

    // app.audit_row writes the whole row into the trail on every insert and
    // update, and the trail is append-only and kept five years: migration 967
    // is what keeps these three columns out of it for good. `kept` is what
    // makes this a test rather than a search that finds nothing everywhere —
    // the job title is in the trail, read by the same expression, so a zero
    // beside it is redaction and not a typo.
    const trail = await h.owner.query<{ n: string; leaked: string; kept: string }>(
      "select count(*)::text as n, count(*) filter (where coalesce(new_values::text, '') || " +
        "coalesce(old_values::text, '') ~ $1)::text as leaked, " +
        "count(*) filter (where coalesce(new_values::text, '') || " +
        "coalesce(old_values::text, '') ~ $2)::text as kept " +
        "from audit_log where entity_type = 'staff_profile'",
      ['Probation|Amber Orchard|\\+971500000052', 'Lead coordinator'],
    );
    expect(Number(trail.rows[0]?.n)).toBeGreaterThanOrEqual(2);
    expect(Number(trail.rows[0]?.kept)).toBeGreaterThanOrEqual(1);
    expect(trail.rows[0]?.leaked).toBe('0');
  });

  it('moves a changed address at the sign-in service first and in the row second', async () => {
    const { userId, authId } = await addColleague('Reed Bay', 'reed.bay@example.com', [
      'practitioner',
    ]);
    const setEmail = vi.spyOn(h.authAdmin, 'setEmail');
    try {
      const res = await h.callAs(
        'PATCH',
        `/api/team/${userId}`,
        OWNER_AUTH,
        profileBody('Reed Bay', 'reed.orchard@example.com'),
      );
      expect(res.status, await res.clone().text()).toBe(200);
      expect(setEmail).toHaveBeenCalledTimes(1);
      expect(setEmail).toHaveBeenCalledWith(authId, 'reed.orchard@example.com');
    } finally {
      setEmail.mockRestore();
    }
    const { rows } = await h.owner.query<{ email: string | null }>(
      'select email from app_user where id = $1',
      [userId],
    );
    expect(rows[0]?.email).toBe('reed.orchard@example.com');
  });

  it('answers email_in_use when the address already has a sign-in, and the row does not move', async () => {
    const { userId } = await addColleague('Jasper Cliff', 'jasper.cliff@example.com', ['finance']);
    const setEmail = vi.spyOn(h.authAdmin, 'setEmail').mockRejectedValueOnce(new EmailInUseError());
    try {
      const res = await h.callAs(
        'PATCH',
        `/api/team/${userId}`,
        OWNER_AUTH,
        profileBody('Jasper Cliff', 'taken.already@example.com'),
      );
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: 'email_in_use' });
    } finally {
      setEmail.mockRestore();
    }
    const { rows } = await h.owner.query<{ email: string | null }>(
      'select email from app_user where id = $1',
      [userId],
    );
    expect(rows[0]?.email).toBe('jasper.cliff@example.com');
  });

  it('puts the address back at the sign-in service when the row cannot be written', async () => {
    const { userId, authId } = await addColleague('Maple Dune', 'maple.dune@example.com', [
      'practitioner',
    ]);
    // A constraint that exists for this one case, added and dropped by the
    // superuser around the call. The failure has to be the DATABASE refusing a
    // write that reached it, after the address has already moved — not a body
    // the route could have refused itself, which is what ruling R6 of round
    // 58's review took out of this test.
    await h.owner.query(
      'alter table staff_profile add constraint zz_test_refuses ' +
        "check (job_title is distinct from 'Refuse this title')",
    );
    const setEmail = vi.spyOn(h.authAdmin, 'setEmail');
    try {
      const res = await h.callAs(
        'PATCH',
        `/api/team/${userId}`,
        OWNER_AUTH,
        profileBody('Maple Dune', 'maple.orchard@example.com', { jobTitle: 'Refuse this title' }),
      );
      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(setEmail.mock.calls).toEqual([
        [authId, 'maple.orchard@example.com'],
        [authId, 'maple.dune@example.com'],
      ]);
    } finally {
      setEmail.mockRestore();
      await h.owner.query('alter table staff_profile drop constraint zz_test_refuses');
    }
    // The request's transaction rolled back, so the row never moved either.
    const { rows } = await h.owner.query<{ email: string | null }>(
      'select email from app_user where id = $1',
      [userId],
    );
    expect(rows[0]?.email).toBe('maple.dune@example.com');
  });

  it('refuses a start date the calendar does not have, and never reaches the sign-in service', async () => {
    const { userId } = await addColleague('Amber Ridge', 'amber.ridge@example.com', [
      'practitioner',
    ]);
    const setEmail = vi.spyOn(h.authAdmin, 'setEmail');
    try {
      for (const startedOn of ['2026-02-31', '2026-13-01', '2025-02-29']) {
        const res = await h.callAs(
          'PATCH',
          `/api/team/${userId}`,
          OWNER_AUTH,
          profileBody('Amber Quarry', 'amber.quarry@example.com', { startedOn }),
        );
        expect(res.status, startedOn).toBe(400);
      }
      // 2024 is a leap year, so that day exists and is saved. The address is
      // unchanged here, which is why the spy stays silent for the whole case.
      const leap = await h.callAs(
        'PATCH',
        `/api/team/${userId}`,
        OWNER_AUTH,
        profileBody('Amber Ridge', 'amber.ridge@example.com', { startedOn: '2024-02-29' }),
      );
      expect(leap.status, await leap.clone().text()).toBe(200);
      expect(setEmail).not.toHaveBeenCalled();
    } finally {
      setEmail.mockRestore();
    }
    const { rows } = await h.owner.query<{ display_name: string; email: string | null }>(
      'select display_name, email from app_user where id = $1',
      [userId],
    );
    expect(rows[0]).toEqual({
      display_name: 'Amber Ridge',
      email: 'amber.ridge@example.com',
    });
    const held = await h.owner.query<{ started_on: string | null }>(
      'select started_on::text as started_on from staff_profile where user_id = $1',
      [userId],
    );
    expect(held.rows[0]?.started_on).toBe('2024-02-29');
  });

  it('refuses a body the profile cannot hold, and writes nothing at all', async () => {
    const { userId } = await addColleague('Clover Quarry', 'clover.quarry@example.com', [
      'practitioner',
    ]);
    const setEmail = vi.spyOn(h.authAdmin, 'setEmail');
    try {
      const bad: [string, Record<string, unknown>][] = [
        ['a telephone number that is not E.164', { phone: '0500000053' }],
        ["an emergency contact's number that is not E.164", { emergencyContactPhone: '971' }],
        ['a note longer than the column holds', { privateNotes: 'x'.repeat(4001) }],
        ['an address that is not one', { email: 'not an address' }],
        ['no name at all', { displayName: '   ' }],
      ];
      for (const [what, over] of bad) {
        const res = await h.callAs(
          'PATCH',
          `/api/team/${userId}`,
          OWNER_AUTH,
          profileBody('Clover Summit', 'clover.summit@example.com', over),
        );
        expect(res.status, what).toBe(400);
      }
      // Refused before the sign-in service is reached, every time.
      expect(setEmail).not.toHaveBeenCalled();
    } finally {
      setEmail.mockRestore();
    }
    const { rows } = await h.owner.query<{ display_name: string; email: string | null }>(
      'select display_name, email from app_user where id = $1',
      [userId],
    );
    expect(rows[0]).toEqual({
      display_name: 'Clover Quarry',
      email: 'clover.quarry@example.com',
    });
    const held = await h.owner.query('select 1 from staff_profile where user_id = $1', [userId]);
    expect(held.rowCount).toBe(0);
  });

  it('answers sign_ins_unavailable when the sign-in service cannot be reached, and the row does not move', async () => {
    const { userId } = await addColleague('Pearl Orchard', 'pearl.orchard@example.com', [
      'finance',
    ]);
    const setEmail = vi
      .spyOn(h.authAdmin, 'setEmail')
      .mockRejectedValueOnce(
        new AuthAdminUnavailableError('The sign-in service could not be reached.'),
      );
    try {
      const res = await h.callAs(
        'PATCH',
        `/api/team/${userId}`,
        OWNER_AUTH,
        profileBody('Pearl Orchard', 'pearl.summit@example.com', { jobTitle: 'Coordinator' }),
      );
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ error: 'sign_ins_unavailable' });
    } finally {
      setEmail.mockRestore();
    }
    // An outage refuses before the row is touched, so nothing half-moved.
    const { rows } = await h.owner.query<{ display_name: string; email: string | null }>(
      'select display_name, email from app_user where id = $1',
      [userId],
    );
    expect(rows[0]).toEqual({
      display_name: 'Pearl Orchard',
      email: 'pearl.orchard@example.com',
    });
    const held = await h.owner.query('select 1 from staff_profile where user_id = $1', [userId]);
    expect(held.rowCount).toBe(0);
  });

  it("refuses one owner the other owner's profile, and lets that owner edit their own", async () => {
    const locked = await h.callAs(
      'PATCH',
      `/api/team/${SECOND_OWNER}`,
      OWNER_AUTH,
      profileBody('Hazel Summit', 'hazel.summit@example.com'),
    );
    expect(locked.status).toBe(409);
    expect(await locked.json()).toMatchObject({ error: 'locked' });
    const untouched = await h.owner.query<{ display_name: string; email: string | null }>(
      'select display_name, email from app_user where id = $1',
      [SECOND_OWNER],
    );
    expect(untouched.rows[0]).toEqual({ display_name: 'Hazel Lagoon', email: null });

    const own = await h.callAs(
      'PATCH',
      `/api/team/${SECOND_OWNER}`,
      SECOND_OWNER_AUTH,
      profileBody('Hazel Lagoon', 'hazel.lagoon@example.com', { jobTitle: 'Founder' }),
    );
    expect(own.status, await own.clone().text()).toBe(200);
    const moved = await h.owner.query<{ email: string | null }>(
      'select email from app_user where id = $1',
      [SECOND_OWNER],
    );
    expect(moved.rows[0]?.email).toBe('hazel.lagoon@example.com');
  });

  it('switches a role on, twice without complaint, and refuses ownership, yourself, an owner and an admin', async () => {
    const { userId } = await addColleague('Juniper Dune', 'juniper.dune@example.com', ['finance']);
    expect(
      (await h.callAs('PUT', `/api/team/${userId}/roles/practitioner`, OWNER_AUTH)).status,
    ).toBe(200);
    // Idempotent: the same role again is not an error.
    expect(
      (await h.callAs('PUT', `/api/team/${userId}/roles/practitioner`, OWNER_AUTH)).status,
    ).toBe(200);
    expect(await rolesOf(userId)).toBe('finance+practitioner');

    const ownership = await h.callAs('PUT', `/api/team/${userId}/roles/owner`, OWNER_AUTH);
    expect(ownership.status).toBe(400);
    expect(await ownership.json()).toMatchObject({ error: 'not_a_working_role' });

    const yourself = await h.callAs('PUT', `/api/team/${IDS.ownerA}/roles/admin`, OWNER_AUTH);
    expect(yourself.status).toBe(400);
    expect(await yourself.json()).toMatchObject({ error: 'not_yourself' });

    const other = await h.callAs('PUT', `/api/team/${SECOND_OWNER}/roles/admin`, OWNER_AUTH);
    expect(other.status).toBe(409);
    expect(await other.json()).toMatchObject({ error: 'locked' });

    expect(
      (await h.callAs('PUT', `/api/team/${userId}/roles/admin`, PORTAL.adminAuth)).status,
    ).toBe(403);
    expect(await rolesOf(userId)).toBe('finance+practitioner');
    expect(await rolesOf(SECOND_OWNER)).toBe('owner');
  });

  it('switches a role off so the fence sees it gone on the very next request, and keeps the last one', async () => {
    const { userId, authId } = await addColleague('Willow Summit', 'willow.summit@example.com', [
      'finance',
      'practitioner',
    ]);
    const before = (await (await h.callAs('GET', '/api/me', authId)).json()) as { roles: string[] };
    expect([...before.roles].sort()).toEqual(['finance', 'practitioner']);

    const off = await h.callAs('DELETE', `/api/team/${userId}/roles/practitioner`, OWNER_AUTH);
    expect(off.status, await off.clone().text()).toBe(200);
    expect(await rolesOf(userId)).toBe('finance');
    const after = (await (await h.callAs('GET', '/api/me', authId)).json()) as { roles: string[] };
    expect(after.roles).toEqual(['finance']);

    // A role they do not hold: there is nothing to take away and nothing changes.
    expect(
      (await h.callAs('DELETE', `/api/team/${userId}/roles/practitioner`, OWNER_AUTH)).status,
    ).toBe(200);
    expect(await rolesOf(userId)).toBe('finance');

    // The last working role stays: with none they fall out of the list and
    // could never be found again to be given one back.
    const last = await h.callAs('DELETE', `/api/team/${userId}/roles/finance`, OWNER_AUTH);
    expect(last.status).toBe(409);
    expect(await last.json()).toMatchObject({ error: 'last_role' });

    const owner = await h.callAs('DELETE', `/api/team/${SECOND_OWNER}/roles/finance`, OWNER_AUTH);
    expect(owner.status).toBe(409);
    expect(await owner.json()).toMatchObject({ error: 'locked' });

    expect(
      (await h.callAs('DELETE', `/api/team/${userId}/roles/finance`, PORTAL.adminAuth)).status,
    ).toBe(403);
    expect(await rolesOf(userId)).toBe('finance');
    expect(await rolesOf(SECOND_OWNER)).toBe('owner');
  });

  it("answers locked when one owner suspends the other, and that owner's row does not move", async () => {
    const res = await h.callAs('POST', `/api/team/${SECOND_OWNER}/status`, OWNER_AUTH, {
      status: 'suspended',
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'locked' });
    const { rows } = await h.owner.query<{ status: string }>(
      'select status::text as status from app_user where id = $1',
      [SECOND_OWNER],
    );
    expect(rows[0]?.status).toBe('active');
  });
});
