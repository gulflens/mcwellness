import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STAFF_LOCATION_NOTICE_VERSION } from '@domain/scheduling';
import type { LocationMeResponse, SharedPositionsResponse } from '@app/api/location/schema';
import { IDS } from '../../db/helpers';
import { PORTAL, startPortalHarness, type PortalHarness } from '../../portal/db/support';

/**
 * Notice version 1.2 (round 76, approved 6 October 2026; migration 214): a
 * standing consent to 1.1 is a consent to the old words, so sharing pauses —
 * the route refuses positions, the database refuses them beneath the route,
 * and the board shows nothing — until the person reads and accepts 1.2. For a
 * practitioner and a helper alike. Ids in this file's own 7axx block; names
 * from db/seed/names.ts; addresses at example.com.
 */

const OWNER_AUTH = '00000001-0000-4000-8000-000000000010';
const APPOINTMENT = '00000000-0000-4000-8000-0000000007a1';
const NOW = new Date('2026-09-04T10:30:00+04:00');
const A_FIX = { latitude: 25.2101, longitude: 55.2702, accuracyMetres: 12 };

let h: PortalHarness;
let helper: { userId: string; authId: string };

async function me(authId: string): Promise<LocationMeResponse> {
  return (await (await h.callAs('GET', '/api/location/me', authId)).json()) as LocationMeResponse;
}

async function board(): Promise<SharedPositionsResponse> {
  return (await (
    await h.callAs('GET', '/api/location/positions', OWNER_AUTH)
  ).json()) as SharedPositionsResponse;
}

/** A consent to 1.1 and the switch on, as somebody who agreed before 1.2 would have. */
async function agreedToOldNotice(userId: string): Promise<void> {
  await h.owner.query(
    'insert into staff_consent (tenant_id, user_id, purpose, notice_version, created_by) ' +
      "values ($1, $2, 'location_sharing', '1.1', $2)",
    [IDS.tenantA, userId],
  );
  await h.owner.query(
    'insert into location_sharing (tenant_id, user_id, sharing_on, created_by) values ($1, $2, true, $2)',
    [IDS.tenantA, userId],
  );
}

/** Whether the database itself would take a position from this person now. */
async function databaseTakes(userId: string, column: 'practitioner_id' | 'user_id', id: string) {
  await h.owner.query('begin');
  try {
    await h.owner.query('set local role app_role');
    await h.owner.query(
      "select set_config('app.tenant_id', $1, true), set_config('app.actor_id', $2, true), " +
        "set_config('app.actor_roles', $3, true)",
      [IDS.tenantA, userId, column === 'user_id' ? 'helper' : 'practitioner'],
    );
    await h.owner.query(
      `insert into practitioner_position (tenant_id, ${column}, latitude, longitude, accuracy_metres) ` +
        'values ($1, $2, 25.2, 55.27, 10)',
      [IDS.tenantA, id],
    );
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === '42501') return false;
    throw error;
  } finally {
    await h.owner.query('rollback');
  }
}

beforeAll(async () => {
  h = await startPortalHarness(() => NOW);
  const start = new Date('2026-09-04T10:00:00+04:00');
  await h.owner.query(
    'insert into appointment (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
      'location_id, delivery_mode, window_start, window_end, status, created_by) ' +
      "values ($1, $2, $3, $4, $5, $6, 'home', $7, $8, 'confirmed', $9)",
    [
      APPOINTMENT,
      IDS.tenantA,
      PORTAL.childA,
      PORTAL.practitionerRow,
      PORTAL.serviceType,
      PORTAL.homeChildA,
      start,
      new Date(start.getTime() + 45 * 60_000),
      IDS.ownerA,
    ],
  );
  const res = await h.callAs('POST', '/api/team/helpers', OWNER_AUTH, {
    displayName: 'Juniper Vale',
    email: 'juniper.vale@example.com',
    practitionerId: PORTAL.practitionerRow,
  });
  expect(res.status).toBe(201);
  const { userId } = (await res.json()) as { userId: string };
  const { rows } = await h.owner.query<{ auth_id: string }>(
    'select auth_id from app_user where id = $1',
    [userId],
  );
  helper = { userId, authId: rows[0]?.auth_id ?? '' };
  await agreedToOldNotice(PORTAL.practitioner);
  await agreedToOldNotice(helper.userId);
});

afterAll(async () => {
  await h.close();
});

describe('a standing consent to 1.1, now that 1.2 is in force', () => {
  it('is the version in force on both sides: the domain and the database', async () => {
    expect(STAFF_LOCATION_NOTICE_VERSION).toBe('1.2');
    const { rows } = await h.owner.query<{ v: string }>(
      'select app.staff_location_notice_version() as v',
    );
    expect(rows).toEqual([{ v: '1.2' }]);
  });

  it('is shown to the person as an older notice than the one in force', async () => {
    for (const auth of [PORTAL.practitionerAuth, helper.authId]) {
      const status = await me(auth);
      expect(status.consent?.noticeVersion, auth).toBe('1.1');
      expect(status.noticeVersion, auth).toBe('1.2');
      expect(status.sharingOn, auth).toBe(true);
    }
  });

  it('pauses sharing: the route refuses positions as notice_changed', async () => {
    for (const auth of [PORTAL.practitionerAuth, helper.authId]) {
      const res = await h.callAs('POST', '/api/location/positions', auth, A_FIX);
      expect(res.status, auth).toBe(409);
      expect(await res.json(), auth).toMatchObject({ code: 'notice_changed' });
    }
  });

  it('pauses sharing beneath the route too: the database takes no position', async () => {
    expect(
      await databaseTakes(PORTAL.practitioner, 'practitioner_id', PORTAL.practitionerRow),
    ).toBe(false);
    expect(await databaseTakes(helper.userId, 'user_id', helper.userId)).toBe(false);
  });

  it('shows nothing on the board, even a position written before the notice moved on', async () => {
    await h.owner.query(
      'insert into practitioner_position (tenant_id, practitioner_id, latitude, longitude, accuracy_metres) ' +
        'values ($1, $2, 25.2, 55.27, 10)',
      [IDS.tenantA, PORTAL.practitionerRow],
    );
    await h.owner.query(
      'insert into practitioner_position (tenant_id, user_id, latitude, longitude, accuracy_metres) ' +
        'values ($1, $2, 25.21, 55.28, 9)',
      [IDS.tenantA, helper.userId],
    );
    expect(await board()).toEqual({ positions: [], helpers: [] });
  });

  it('refuses a consent to the old words', async () => {
    const res = await h.callAs('POST', '/api/location/consent', helper.authId, {
      noticeVersion: '1.1',
    });
    expect(res.status).toBe(409);
  });
});

describe('accepting 1.2', () => {
  it('replaces the old consent with one to 1.2, keeping the old one as withdrawn', async () => {
    for (const auth of [PORTAL.practitionerAuth, helper.authId]) {
      const res = await h.callAs('POST', '/api/location/consent', auth, { noticeVersion: '1.2' });
      expect(res.status, auth).toBe(204);
      expect((await me(auth)).consent?.noticeVersion, auth).toBe('1.2');
    }
    const { rows } = await h.owner.query<{ notice_version: string; withdrawn: boolean }>(
      'select notice_version, withdrawn_at is not null as withdrawn from staff_consent ' +
        'where user_id = $1 order by given_at, notice_version',
      [helper.userId],
    );
    expect(rows).toEqual([
      { notice_version: '1.1', withdrawn: true },
      { notice_version: '1.2', withdrawn: false },
    ]);
  });

  it('resumes sharing: positions are taken, by the route and the database, and shown', async () => {
    expect(
      await databaseTakes(PORTAL.practitioner, 'practitioner_id', PORTAL.practitionerRow),
    ).toBe(true);
    expect(await databaseTakes(helper.userId, 'user_id', helper.userId)).toBe(true);
    for (const auth of [PORTAL.practitionerAuth, helper.authId]) {
      expect((await h.callAs('POST', '/api/location/positions', auth, A_FIX)).status, auth).toBe(
        204,
      );
    }
    const answer = await board();
    expect(answer.positions).toHaveLength(1);
    expect(answer.helpers).toHaveLength(1);
  });
});
