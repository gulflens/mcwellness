import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../app/api/_middleware/db';
import { createTokenVerifier } from '../../app/api/_middleware/token-verifier';
import { createApi } from '../../app/api/create-api';
import type {
  PractitionerBaseResponse,
  PractitionerListResponse,
  PractitionerRow,
} from '../../app/api/practitioners/schema';
import { applySeed } from '../../db/seed/apply';
import { generateSeed } from '../../db/seed/generate';
import { deriveIdentityKeys } from '../../domain/shared/identity';
import {
  asApiRole,
  freshDatabase,
  rejectsWith,
  rolledBack,
  seedUser,
  setAuditContext,
} from './helpers';

/**
 * `GET /api/practitioners` and `PUT /api/practitioners/:id/base` against a
 * real database, through the API the server actually builds
 * (docs/SPEC/route-planning.md section 5.4, migration 913).
 *
 * **No coordinate is written in this file.** Every point used here is read
 * back off `generateSeed()`'s own synthetic lattice — an emirate centre plus
 * whole grid steps, which is where every location in this repository comes
 * from (CLAUDE.md rule 2, .claude/rules/testing.md). A home base is a real
 * person's home, so a plausible one has no business in a test either.
 */

const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const ISSUER = 'http://localhost:54321/auth/v1';
const KEY = new TextEncoder().encode(SECRET);
const data = generateSeed();

/** A bookkeeper, so "finance is refused" is proved by finance and not by an owner. */
const FINANCE_USER = '00000000-0000-4000-8000-0000000000a6';
const FINANCE_AUTH = '00000000-0000-4000-8000-0000000000b6';

/**
 * Two points and their emirates, taken from the seeded households rather than
 * invented: the first two client homes, which sit in different emirates
 * because the generator cycles through the list.
 */
const homes = data.locations.filter((location) => location.ownerType === 'client');
const FIRST = homes[0];
const SECOND = homes[1];
if (!FIRST || !SECOND) throw new Error('The seed has no client homes to borrow a lattice from.');

/** The practice's own address, which the seed gives every practitioner as their base. */
const STUDIO = data.locations.find((location) => location.ownerType === 'tenant');
if (!STUDIO) throw new Error('The seed has no studio.');

let owner: pg.Client;
let pool: pg.Pool;
let api: ReturnType<typeof createApi>;

/** The seeded people: 0 holds every office role, 1 and 2 only treat, 3 is an admin. */
function authIdOf(index: number): string {
  const user = data.users[index];
  if (!user) throw new Error(`No seeded user ${index}.`);
  return user.authId;
}

/** The seeded practitioner rows, in the order the generator makes them. */
function practitionerId(index: number): string {
  const person = data.practitioners[index];
  if (!person) throw new Error(`No seeded practitioner ${index}.`);
  return person.id;
}

async function mint(sub: string): Promise<string> {
  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience('authenticated')
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(KEY);
}

async function list(sub: string): Promise<Response> {
  return api.request('/api/practitioners', {
    headers: { authorization: `Bearer ${await mint(sub)}` },
  });
}

async function listed(sub: string): Promise<PractitionerListResponse> {
  const res = await list(sub);
  expect(res.status).toBe(200);
  return (await res.json()) as PractitionerListResponse;
}

async function setBase(
  sub: string,
  id: string,
  point: { lat: number; lng: number },
  emirate: string,
  reason: string | null = 'moved house',
): Promise<Response> {
  const headers: Record<string, string> = {
    authorization: `Bearer ${await mint(sub)}`,
    'content-type': 'application/json',
  };
  if (reason !== null) headers['x-reason'] = reason;
  return api.request(`/api/practitioners/${id}/base`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ lat: point.lat, lng: point.lng, emirate }),
  });
}

/** The base row as the database holds it, read as the owner so nothing is hidden. */
async function baseRow(id: string): Promise<{
  location_id: string | null;
  owner_type: string | null;
  label: string | null;
  emirate: string | null;
  lat: number | null;
  lng: number | null;
  display_address: string | null;
  access_notes: string | null;
  makani_number: string | null;
} | null> {
  const { rows } = await owner.query(
    'select l.id as location_id, l.owner_type::text, l.label::text, l.emirate::text, ' +
      'extensions.st_y(l.entrance_point::extensions.geometry) as lat, ' +
      'extensions.st_x(l.entrance_point::extensions.geometry) as lng, ' +
      'l.display_address, l.access_notes, l.makani_number ' +
      'from practitioner p left join location l on l.id = p.home_base_location_id ' +
      'where p.id = $1',
    [id],
  );
  return (rows[0] as never) ?? null;
}

async function ownedLocationCount(practitionerRowId: string): Promise<number> {
  const { rows } = await owner.query<{ n: string }>(
    "select count(*)::text as n from location where owner_type = 'practitioner' and owner_id = $1",
    [practitionerRowId],
  );
  return Number(rows[0]?.n ?? 0);
}

function rowFor(response: PractitionerListResponse, id: string): PractitionerRow | undefined {
  return response.practitioners.find((person) => person.id === id);
}

beforeAll(async () => {
  owner = await freshDatabase();
  await applySeed(owner, data, deriveIdentityKeys(Buffer.alloc(32, 7)));
  await seedUser(owner, {
    id: FINANCE_USER,
    tenantId: data.tenant.id,
    authId: FINANCE_AUTH,
    displayName: 'Synthetic Bookkeeper',
    roles: ['finance'],
  });
  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  pool = createPool(apiUrl);
  api = createApi({ pool, verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }) });
});

afterAll(async () => {
  await pool.end();
  await owner.end();
});

describe('GET /api/practitioners', () => {
  it('shows the office every practitioner, and marks the one who is asking', async () => {
    const answer = await listed(authIdOf(0));
    expect(answer.practitioners).toHaveLength(data.practitioners.length);
    expect(answer.scope).toBeNull();
    expect(rowFor(answer, practitionerId(0))?.isYou).toBe(true);
    expect(rowFor(answer, practitionerId(1))?.isYou).toBe(false);
  });

  it('shows a practitioner one row, their own, and says so', async () => {
    const answer = await listed(authIdOf(1));
    expect(answer.practitioners).toHaveLength(1);
    expect(answer.practitioners[0]?.id).toBe(practitionerId(1));
    expect(answer.practitioners[0]?.isYou).toBe(true);
    expect(answer.scope).toBe('own');
  });

  it('gives a name and a coordinate, and never an address', async () => {
    const answer = await listed(authIdOf(0));
    const person = rowFor(answer, practitionerId(0));
    expect(person?.displayName).toBe(data.users[0]?.displayName);
    // The seed points every practitioner at the studio, so a base is recorded.
    expect(person?.base?.point).toEqual({ lat: STUDIO.entrance.lat, lng: STUDIO.entrance.lng });
    // Which has a display address on it, and the answer still carries none.
    expect(JSON.stringify(person)).not.toContain(STUDIO.displayAddress);
    expect(Object.keys(person?.base ?? {})).toEqual(['locationId', 'point', 'emirate']);
  });

  it('refuses finance', async () => {
    expect((await list(FINANCE_AUTH)).status).toBe(403);
  });

  it('records one list row per practitioner shown, and no household', async () => {
    const before = await owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where entity_type = 'practitioner' and action = 'list'",
    );
    await listed(authIdOf(1));
    const after = await owner.query<{ n: string; client_id: string | null }>(
      'select count(*)::text as n, max(client_id::text) as client_id from audit_log ' +
        "where entity_type = 'practitioner' and action = 'list'",
    );
    expect(Number(after.rows[0]?.n)).toBe(Number(before.rows[0]?.n) + 1);
    expect(after.rows[0]?.client_id).toBeNull();
  });
});

describe('PUT /api/practitioners/:id/base', () => {
  it('lets a practitioner set their own, and leaves the studio where it is', async () => {
    const studioBefore = await owner.query<{ lat: number; lng: number }>(
      'select extensions.st_y(entrance_point::extensions.geometry) as lat, ' +
        'extensions.st_x(entrance_point::extensions.geometry) as lng ' +
        'from location where id = (select location_id from tenant where id = $1)',
      [data.tenant.id],
    );
    const res = await setBase(authIdOf(1), practitionerId(1), FIRST.entrance, FIRST.emirate);
    expect(res.status).toBe(200);
    const saved = ((await res.json()) as PractitionerBaseResponse).practitioner;
    expect(saved.base?.point).toEqual({ lat: FIRST.entrance.lat, lng: FIRST.entrance.lng });
    expect(saved.base?.emirate).toBe(FIRST.emirate);

    const row = await baseRow(practitionerId(1));
    expect(row?.owner_type).toBe('practitioner');
    expect(row?.label).toBe('base');
    // A person's home: the coordinate and nothing else.
    expect(row?.display_address).toBeNull();
    expect(row?.access_notes).toBeNull();
    expect(row?.makani_number).toBeNull();

    // The base it replaced was the practice's own address, which must not have
    // been dragged to somebody's house with it.
    const studioAfter = await owner.query<{ lat: number; lng: number }>(
      'select extensions.st_y(entrance_point::extensions.geometry) as lat, ' +
        'extensions.st_x(entrance_point::extensions.geometry) as lng ' +
        'from location where id = (select location_id from tenant where id = $1)',
      [data.tenant.id],
    );
    expect(studioAfter.rows[0]).toEqual(studioBefore.rows[0]);
  });

  it('moves the existing row on a second set rather than leaving an orphan', async () => {
    const first = await baseRow(practitionerId(1));
    const res = await setBase(authIdOf(1), practitionerId(1), SECOND.entrance, SECOND.emirate);
    expect(res.status).toBe(200);
    const second = await baseRow(practitionerId(1));
    expect(second?.location_id).toBe(first?.location_id);
    expect(second?.lat).toBe(SECOND.entrance.lat);
    expect(second?.emirate).toBe(SECOND.emirate);
    expect(await ownedLocationCount(practitionerId(1))).toBe(1);
  });

  it('refuses a practitioner another practitioner’s base, and changes nothing', async () => {
    const before = await baseRow(practitionerId(2));
    const res = await setBase(authIdOf(1), practitionerId(2), FIRST.entrance, FIRST.emirate);
    expect(res.status).toBe(403);
    expect(await baseRow(practitionerId(2))).toEqual(before);
  });

  it('lets an admin set anybody’s', async () => {
    const res = await setBase(authIdOf(3), practitionerId(2), FIRST.entrance, FIRST.emirate);
    expect(res.status).toBe(200);
    expect((await baseRow(practitionerId(2)))?.owner_type).toBe('practitioner');
  });

  it('refuses finance', async () => {
    const before = await baseRow(practitionerId(0));
    expect(
      (await setBase(FINANCE_AUTH, practitionerId(0), FIRST.entrance, FIRST.emirate)).status,
    ).toBe(403);
    expect(await baseRow(practitionerId(0))).toEqual(before);
  });

  it('refuses a save with no reason, before anything moves', async () => {
    const before = await baseRow(practitionerId(1));
    const res = await setBase(authIdOf(1), practitionerId(1), FIRST.entrance, FIRST.emirate, null);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'reason_required' });
    expect(await baseRow(practitionerId(1))).toEqual(before);
  });

  it('refuses a coordinate that is not one', async () => {
    const res = await api.request(`/api/practitioners/${practitionerId(1)}/base`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${await mint(authIdOf(1))}`,
        'content-type': 'application/json',
        'x-reason': 'typed it wrong',
      },
      body: JSON.stringify({ lat: 'north', lng: null, emirate: 'DXB' }),
    });
    expect(res.status).toBe(400);
  });

  it('answers 404 for a practitioner this practice does not have', async () => {
    const res = await setBase(
      authIdOf(3),
      '00000005-0000-4000-8000-000000000999',
      FIRST.entrance,
      FIRST.emirate,
    );
    expect(res.status).toBe(404);
  });

  it('puts the reason on the trail with the change', async () => {
    const reason = 'the practitioner moved to a new home';
    const res = await setBase(
      authIdOf(2),
      practitionerId(2),
      SECOND.entrance,
      SECOND.emirate,
      reason,
    );
    expect(res.status).toBe(200);
    const { rows } = await owner.query<{ action: string; reason: string | null }>(
      "select action::text, reason from audit_log where entity_type = 'location' " +
        'and entity_id = (select home_base_location_id from practitioner where id = $1) ' +
        'order by id desc limit 1',
      [practitionerId(2)],
    );
    expect(rows[0]?.reason).toBe(reason);
  });
});

/**
 * The floor beneath the function: `db/policies/core/practitioner_base.sql`,
 * driven as `app_role` directly rather than through a route.
 *
 * Everything above this point goes through `api.request(...)`, and the route
 * refuses what the policies refuse — so the whole of this file went on passing
 * with the policy file deleted from the tree, and nothing would have noticed
 * if it disappeared (the review of pull request 126, finding B2). `db/policies/**`
 * is re-applied by the runner on every migrate, one of the neighbouring files
 * belongs to another stream, and the round's central argument is that a
 * security definer function's own checks are the only checks there are. The
 * other half of that boundary is proved here.
 *
 * Two shapes of refusal, and they are not the same thing. A restrictive
 * `using` clause on `update` **filters**: the row is not visible to the
 * statement, so nothing is written and nothing is raised — the silent nothing
 * migration 913's own header calls worse than a refusal. A `with check` clause
 * raises 42501. Both arms here carry the same expression, so a refused update
 * writes no row and says nothing, and that is what is asserted: the count, and
 * then the row itself, read back as the owner.
 */
describe('db/policies/core/practitioner_base.sql — the row rules themselves', () => {
  /** The seeded studio, which is `owner_type = 'tenant'` and narrowed by nothing. */
  let studioId: string;
  /** A base row of practitioner 1's own, and one of practitioner 2's. */
  let baseOfOne: string;
  let baseOfTwo: string;

  /**
   * Gives a practitioner a base row of their own if the tests above have not
   * already, so this block does not depend on the order they ran in. Written
   * as the owner, from the seed's own lattice: no coordinate is invented here
   * any more than it is anywhere else in this file.
   */
  async function ownBase(
    practitionerRowId: string,
    point: { lat: number; lng: number },
    emirate: string,
  ): Promise<string> {
    const existing = await owner.query<{ id: string }>(
      "select id from location where owner_type = 'practitioner' and owner_id = $1 limit 1",
      [practitionerRowId],
    );
    const found = existing.rows[0]?.id;
    if (found) return found;
    const { rows } = await owner.query<{ id: string }>(
      'insert into location (tenant_id, owner_type, owner_id, label, emirate, entrance_point, is_primary) ' +
        "values ($1, 'practitioner', $2, 'base', $3, " +
        'extensions.st_setsrid(extensions.st_makepoint($4, $5), 4326)::extensions.geography, true) ' +
        'returning id',
      [data.tenant.id, practitionerRowId, emirate, point.lng, point.lat],
    );
    const id = rows[0]?.id;
    if (!id) throw new Error('No base row was written.');
    await owner.query('update practitioner set home_base_location_id = $1 where id = $2', [
      id,
      practitionerRowId,
    ]);
    return id;
  }

  /** As `app_role`, with a tenant, a set of roles and an actor, inside a transaction. */
  async function as<T>(roles: string, actorId: string | null, fn: () => Promise<T>): Promise<T> {
    return rolledBack(owner, () =>
      asApiRole(
        owner,
        data.tenant.id,
        async () => {
          if (actorId) await setAuditContext(owner, actorId, 'a database test');
          return fn();
        },
        roles,
      ),
    );
  }

  function userId(index: number): string {
    const user = data.users[index];
    if (!user) throw new Error(`No seeded user ${index}.`);
    return user.id;
  }

  /** How many `location` rows this caller can see with the given id. */
  async function visible(id: string): Promise<number> {
    const { rows } = await owner.query<{ n: string }>(
      'select count(*)::text as n from location where id = $1',
      [id],
    );
    return Number(rows[0]?.n ?? 0);
  }

  beforeAll(async () => {
    const studio = await owner.query<{ id: string }>(
      'select location_id as id from tenant where id = $1',
      [data.tenant.id],
    );
    const found = studio.rows[0]?.id;
    if (!found) throw new Error('The seeded practice has no studio.');
    studioId = found;
    baseOfOne = await ownBase(practitionerId(1), FIRST.entrance, FIRST.emirate);
    baseOfTwo = await ownBase(practitionerId(2), SECOND.entrance, SECOND.emirate);

    // One visit on practitioner 1's own schedule, so the day sheet's read of a
    // household's location is exercised by a practitioner-only account and not
    // by an office role that could read it either way. The seed's own five
    // visits all belong to practitioner 0, whose user holds every office role.
    await owner.query(
      'insert into appointment (tenant_id, client_id, practitioner_id, service_type_id, ' +
        "location_id, delivery_mode, window_start, window_end, status) values ($1, $2, $3, $4, $5, 'home', " +
        "$6::timestamptz, $6::timestamptz + interval '45 minutes', 'confirmed')",
      [
        data.tenant.id,
        FIRST.ownerId,
        practitionerId(1),
        data.serviceTypes[0]?.id,
        FIRST.id,
        `${data.planningDay}T17:00:00+04:00`,
      ],
    );
  });

  describe('practitioner_row_update_writers', () => {
    async function tryUpdate(roles: string, actorId: string | null): Promise<number> {
      return as(roles, actorId, async () => {
        const res = await owner.query(
          'update practitioner set home_base_location_id = $1 where id = $2',
          [studioId, practitionerId(1)],
        );
        return res.rowCount ?? 0;
      });
    }

    it('writes nothing for finance, the hole migration 913 calls the worst of four', async () => {
      expect(await tryUpdate('finance', FINANCE_USER)).toBe(0);
      expect((await baseRow(practitionerId(1)))?.location_id).toBe(baseOfOne);
    });

    it('writes nothing for a client contact either', async () => {
      expect(await tryUpdate('client_contact', null)).toBe(0);
      expect((await baseRow(practitionerId(1)))?.location_id).toBe(baseOfOne);
    });

    it('writes nothing for a practitioner, not even their own row', async () => {
      // Narrowed in the fix round of 2026-09-08 (finding 3): an `update`
      // policy cannot say "this column", so an arm admitting a practitioner to
      // their own row would have handed them `status` and `vehicle` with it.
      expect(await tryUpdate('practitioner', userId(1))).toBe(0);
      expect((await baseRow(practitionerId(1)))?.location_id).toBe(baseOfOne);
    });

    it('lets the office write one, as it always could', async () => {
      expect(await tryUpdate('admin', userId(3))).toBe(1);
    });

    it('refuses a practitioner an insert of a practitioner row outright', async () => {
      // Creating a practitioner is the office's act. The row is written for the
      // seeded admin, who has no `practitioner` row of their own, so nothing but
      // the policy stands between this statement and a new practitioner: with
      // the file removed it succeeds, and `with check` is what raises here.
      await rolledBack(owner, () =>
        asApiRole(
          owner,
          data.tenant.id,
          async () => {
            await setAuditContext(owner, userId(1), 'a database test');
            await rejectsWith(
              owner,
              '42501',
              'insert into practitioner (tenant_id, user_id) values ($1, $2)',
              [data.tenant.id, userId(3)],
            );
          },
          'practitioner',
        ),
      );
    });

    it('still lets the definer function set a practitioner’s own base', async () => {
      // The narrowing above must not have closed the one path that is meant to
      // work: app.set_practitioner_base is security definer and passes over
      // this policy entirely, which is the point of it.
      const moved = await as('practitioner', userId(1), async () => {
        const { rows } = await owner.query<{ id: string }>(
          'select app.set_practitioner_base($1, $2, $3, $4::emirate) as id',
          [practitionerId(1), SECOND.entrance.lng, SECOND.entrance.lat, SECOND.emirate],
        );
        return rows[0]?.id;
      });
      expect(moved).toBe(baseOfOne);
    });
  });

  describe('practitioner_base_is_private', () => {
    it('hides a colleague’s base from a practitioner, and keeps their own', async () => {
      await as('practitioner', userId(1), async () => {
        expect(await visible(baseOfTwo)).toBe(0);
        expect(await visible(baseOfOne)).toBe(1);
      });
    });

    it('hides it the other way round too, so it is the row and not the reader', async () => {
      await as('practitioner', userId(2), async () => {
        expect(await visible(baseOfOne)).toBe(0);
        expect(await visible(baseOfTwo)).toBe(1);
      });
    });

    it('shows the office every base, which is what the day map draws from', async () => {
      for (const [roles, actor] of [
        ['owner', userId(0)],
        ['admin', userId(3)],
        ['lead_practitioner', userId(0)],
      ] as const) {
        await as(roles, actor, async () => {
          expect(await visible(baseOfOne), roles).toBe(1);
          expect(await visible(baseOfTwo), roles).toBe(1);
        });
      }
    });

    it('shows finance no base, as client_record_readers already said', async () => {
      await as('finance', FINANCE_USER, async () => {
        expect(await visible(baseOfOne)).toBe(0);
      });
    });

    it('leaves the studio exactly where it was: one owner type is narrowed, not two', async () => {
      // The address every invoice is issued from, and the base the seed gives
      // every practitioner. A policy that reached it would take the practice's
      // own address off the day map.
      for (const [roles, actor] of [
        ['practitioner', userId(1)],
        ['owner', userId(0)],
        ['admin', userId(3)],
        ['lead_practitioner', userId(0)],
      ] as const) {
        await as(roles, actor, async () => {
          expect(await visible(studioId), roles).toBe(1);
        });
      }
    });

    it('leaves a household’s home to the day sheet’s own reader', async () => {
      // app/api/routing/day.ts reads the locations of the caller's own visits.
      // A practitioner reads a client's home through client_record_readers and
      // app.client_visible_to_practitioner, and this policy answers true for
      // every owner type that is not 'practitioner', so that read is untouched.
      await as('practitioner', userId(1), async () => {
        expect(await visible(FIRST.id)).toBe(1);
      });
      await as('owner', userId(0), async () => {
        expect(await visible(FIRST.id)).toBe(1);
      });
    });
  });
});
