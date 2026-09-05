import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../app/api/_middleware/db';
import { createTokenVerifier } from '../../app/api/_middleware/token-verifier';
import { createApi } from '../../app/api/create-api';
import type { PracticeResponse } from '../../app/api/practice/schema';
import { applySeed } from '../../db/seed/apply';
import { generateSeed } from '../../db/seed/generate';
import { deriveIdentityKeys } from '../../domain/shared/identity';
import { freshDatabase } from './helpers';

/**
 * `GET` and `PATCH /api/practice` against a real database, through the API
 * the server actually builds (migration 905, app/api/practice/routes.ts).
 *
 * Four things: who may open it, that a save without a reason is refused
 * before anything moves, that the VAT switch and its number cannot be
 * recorded by halves, and that a save lands on the row and on the trail.
 */

const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const ISSUER = 'http://localhost:54321/auth/v1';
const KEY = new TextEncoder().encode(SECRET);
const data = generateSeed();
// Fifteen digits in the reserved synthetic shape; never a real registration.
const VAT_TRN = '100000000000003';

let owner: pg.Client;
let pool: pg.Pool;
let api: ReturnType<typeof createApi>;

/** The seeded people: 0 holds every office role, 1 and 2 only treat, 3 is an admin. */
function authIdOf(index: number): string {
  const user = data.users[index];
  if (!user) throw new Error(`No seeded user ${index}.`);
  return user.authId;
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

async function call(
  method: 'GET' | 'PATCH',
  sub: string,
  options: { body?: unknown; reason?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = { authorization: `Bearer ${await mint(sub)}` };
  if (options.reason !== undefined) {
    headers['x-reason'] = options.reason;
  }
  const init: RequestInit = { method, headers };
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  return api.request('/api/practice', init);
}

async function read(sub: string): Promise<PracticeResponse['practice']> {
  const res = await call('GET', sub);
  expect(res.status).toBe(200);
  return ((await res.json()) as PracticeResponse).practice;
}

/** The whole form, as the drawer sends it: a saved change starts from what is there. */
async function form(overrides: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const practice = await read(authIdOf(0));
  return {
    legalName: practice.legalName,
    legalNameAr: practice.legalNameAr ?? '',
    taxRegistrationNumber: practice.taxRegistrationNumber ?? '',
    licenceNumber: practice.licenceNumber ?? '',
    licensingAuthority: practice.licensingAuthority ?? '',
    licenceExpiresOn: practice.licenceExpiresOn,
    vatRegistered: practice.vatRegistered,
    vatTrn: practice.vatTrn ?? '',
    whatsappNumber: practice.whatsappNumber ?? '',
    address: practice.address,
    ...overrides,
  };
}

beforeAll(async () => {
  owner = await freshDatabase();
  await applySeed(owner, data, deriveIdentityKeys(Buffer.alloc(32, 7)));
  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  pool = createPool(apiUrl);
  api = createApi({ pool, verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }) });
});

afterAll(async () => {
  await pool.end();
  await owner.end();
});

describe('GET /api/practice', () => {
  it('answers the owner with the practice, its address and its VAT state', async () => {
    const practice = await read(authIdOf(0));
    expect(practice.legalName).toBe(data.tenant.legalName);
    expect(practice.taxRegistrationNumber).toBe(data.tenant.trn);
    expect(practice.vatRegistered).toBe(false);
    expect(practice.vatTrn).toBeNull();
    expect(practice.address?.displayAddress).toBe('Unit 1, Synthetic Tower, Dubai');
    expect(practice.address?.emirate).toBe('DXB');
  });

  it('answers an admin, and refuses a practitioner', async () => {
    expect((await call('GET', authIdOf(3))).status).toBe(200);
    expect((await call('GET', authIdOf(1))).status).toBe(403);
  });
});

describe('PATCH /api/practice', () => {
  it('refuses a practitioner before it reads a body at all', async () => {
    const res = await call('PATCH', authIdOf(1), {
      body: await form({ legalName: 'Renamed By Somebody Else' }),
      reason: 'trying it on',
    });
    expect(res.status).toBe(403);
    expect((await read(authIdOf(0))).legalName).toBe(data.tenant.legalName);
  });

  it('refuses a save that says nothing about why', async () => {
    const res = await call('PATCH', authIdOf(0), { body: await form() });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'reason_required' });
  });

  it('refuses the VAT switch without the number that would be printed', async () => {
    const res = await call('PATCH', authIdOf(0), {
      body: await form({ vatRegistered: true, vatTrn: '' }),
      reason: 'registering for VAT',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'vat_trn_required' });
    expect((await read(authIdOf(0))).vatRegistered).toBe(false);
  });

  it('refuses a VAT number that is not fifteen digits', async () => {
    const res = await call('PATCH', authIdOf(0), {
      body: await form({ vatRegistered: true, vatTrn: '1234' }),
      reason: 'registering for VAT',
    });
    expect(res.status).toBe(400);
    expect((await read(authIdOf(0))).vatRegistered).toBe(false);
  });

  it('saves the identity, the licence and the registration, and records why', async () => {
    const reason = 'The licence was reissued and the practice registered for VAT.';
    const res = await call('PATCH', authIdOf(3), {
      body: await form({
        legalNameAr: 'استوديو العافية',
        licenceNumber: 'SYN-000123',
        licensingAuthority: 'Synthetic Department of Economy and Tourism',
        licenceExpiresOn: '2028-06-30',
        vatRegistered: true,
        vatTrn: VAT_TRN,
      }),
      reason,
    });
    expect(res.status).toBe(200);
    const saved = ((await res.json()) as PracticeResponse).practice;
    expect(saved).toMatchObject({
      legalNameAr: 'استوديو العافية',
      licenceNumber: 'SYN-000123',
      licenceExpiresOn: '2028-06-30',
      vatRegistered: true,
      vatTrn: VAT_TRN,
    });
    // Read back through a second request, not from the answer to the first.
    expect(await read(authIdOf(0))).toMatchObject({ vatRegistered: true, vatTrn: VAT_TRN });

    // Sensitive, so the trail carries the reason with the row it changed.
    const { rows } = await owner.query<{ reason: string | null }>(
      "select reason from audit_log where entity_type = 'tenant' and action = 'update' " +
        'order by id desc limit 1',
    );
    expect(rows[0]?.reason).toBe(reason);
  });

  it('turns the registration off and takes the number with it', async () => {
    const res = await call('PATCH', authIdOf(0), {
      body: await form({ vatRegistered: false, vatTrn: '' }),
      reason: 'The registration was cancelled by the authority.',
    });
    expect(res.status).toBe(200);
    expect(await read(authIdOf(0))).toMatchObject({ vatRegistered: false, vatTrn: null });
  });

  it("records the practice's own WhatsApp number, and refuses one that is not E.164", async () => {
    // What the client portal's ask-for-a-visit button opens (migration 910,
    // docs/SPEC/client-portal.md section 6.4).
    const refused = await call('PATCH', authIdOf(0), {
      reason: 'The practice number changed.',
      body: await form({ whatsappNumber: '0501234' }),
    });
    expect(refused.status).toBe(400);
    expect((await refused.json()) as { code?: string }).toMatchObject({
      code: 'whatsapp_number_invalid',
    });

    const saved = await call('PATCH', authIdOf(0), {
      reason: 'The practice number changed.',
      body: await form({ whatsappNumber: '+971 50 000 0024' }),
    });
    expect(saved.status).toBe(200);
    expect(await read(authIdOf(0))).toMatchObject({ whatsappNumber: '+971500000024' });

    // And cleared again: a practice that records none shows the portal's
    // sentence without a button.
    await call('PATCH', authIdOf(0), {
      reason: 'The practice has no WhatsApp number for now.',
      body: await form({ whatsappNumber: '' }),
    });
    expect(await read(authIdOf(0))).toMatchObject({ whatsappNumber: null });
  });

  it('saves the registered address onto the practice’s own location row', async () => {
    const res = await call('PATCH', authIdOf(0), {
      body: await form({
        address: {
          displayAddress: 'Unit 2, Synthetic Tower, Dubai',
          emirate: 'DXB',
          latitude: 25.191,
          longitude: 55.261,
        },
      }),
      reason: 'The studio moved a floor up.',
    });
    expect(res.status).toBe(200);
    const saved = ((await res.json()) as PracticeResponse).practice;
    expect(saved.address?.displayAddress).toBe('Unit 2, Synthetic Tower, Dubai');
    expect(saved.address?.latitude).toBeCloseTo(25.191, 5);

    // The same row an invoice's supplier address is stamped from.
    const { rows } = await owner.query<{ display_address: string }>(
      'select l.display_address from tenant t join location l on l.id = t.location_id',
    );
    expect(rows[0]?.display_address).toBe('Unit 2, Synthetic Tower, Dubai');
  });
});
