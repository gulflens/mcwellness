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
import { freshDatabase, seedUser } from './helpers';

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
    expect(person?.base?.point).toEqual({ lat: 25.19, lng: 55.26 });
    expect(JSON.stringify(person)).not.toContain('Synthetic Tower');
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
