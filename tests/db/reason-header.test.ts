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
 * A reason in any language saves, and the trail keeps the words as typed
 * (app/api/_middleware/reason.ts, app/shell/auth/reasonHeader.ts).
 *
 * A browser cannot put a curly apostrophe, an em dash, an emoji or Arabic in
 * a header, so the console sends such a reason percent-encoded and marked
 * `X-Reason-Encoding: uri`. Proved here through the API the server builds, on
 * a real route (`PATCH /api/practice`, which refuses a save with no reason)
 * and down to `audit_log.reason`.
 */

const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const ISSUER = 'http://localhost:54321/auth/v1';
const KEY = new TextEncoder().encode(SECRET);
const data = generateSeed();

let owner: pg.Client;
let pool: pg.Pool;
let api: ReturnType<typeof createApi>;
let sequence = 0;

function ownerAuthId(): string {
  const user = data.users[0];
  if (!user) throw new Error('No seeded owner.');
  return user.authId;
}

async function mint(): Promise<string> {
  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience('authenticated')
    .setSubject(ownerAuthId())
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(KEY);
}

/** The practice form as it stands, with a licence number that differs each save. */
async function changedForm(): Promise<Record<string, unknown>> {
  const res = await api.request('/api/practice', {
    headers: { authorization: `Bearer ${await mint()}` },
  });
  const practice = ((await res.json()) as PracticeResponse).practice;
  sequence += 1;
  return {
    legalName: practice.legalName,
    legalNameAr: practice.legalNameAr ?? '',
    taxRegistrationNumber: practice.taxRegistrationNumber ?? '',
    licenceNumber: `SYN-${String(700 + sequence).padStart(6, '0')}`,
    licensingAuthority: practice.licensingAuthority ?? '',
    licenceExpiresOn: practice.licenceExpiresOn,
    vatRegistered: practice.vatRegistered,
    vatTrn: practice.vatTrn ?? '',
    whatsappNumber: practice.whatsappNumber ?? '',
    address: practice.address,
  };
}

/** One save, with the reason headers given as they are, and its request id. */
async function save(reasonHeaders: Record<string, string>): Promise<{
  res: Response;
  requestId: string;
}> {
  const requestId = `00000000-0000-4000-8000-${String(sequence + 1).padStart(12, '0')}`;
  const res = await api.request('/api/practice', {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${await mint()}`,
      'content-type': 'application/json',
      'x-request-id': requestId,
      ...reasonHeaders,
    },
    body: JSON.stringify(await changedForm()),
  });
  return { res, requestId };
}

/** What the trail kept for that save's change to the practice. */
async function trailReason(requestId: string): Promise<string | null | undefined> {
  const { rows } = await owner.query<{ reason: string | null }>(
    "select reason from audit_log where request_id = $1 and entity_type = 'tenant' " +
      "and action = 'update'",
    [requestId],
  );
  expect(rows).toHaveLength(1);
  return rows[0]?.reason;
}

const encoded = (text: string) => ({
  'x-reason': encodeURIComponent(text),
  'x-reason-encoding': 'uri',
});

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

describe('a reason in any characters', () => {
  it.each([
    ['a curly apostrophe', 'The practice’s licence was renewed.'],
    ['an em dash', 'Licence renewed — new number issued.'],
    ['an emoji', 'Licence renewed 🙂 new number issued.'],
    ['an Arabic sentence', 'تم تجديد الرخصة برقم جديد.'],
  ])('saves a reason with %s and the trail keeps it decoded', async (_kind, typed) => {
    const { res, requestId } = await save(encoded(typed));
    expect(res.status).toBe(200);
    expect(await trailReason(requestId)).toBe(typed);
  });

  it('still saves a plain ASCII reason sent the old way, unencoded', async () => {
    const { res, requestId } = await save({ 'x-reason': 'Licence renewed at 100% on time.' });
    expect(res.status).toBe(200);
    expect(await trailReason(requestId)).toBe('Licence renewed at 100% on time.');
  });

  it('saves a plain ASCII reason sent encoded, and keeps it decoded', async () => {
    const { res, requestId } = await save(encoded('Licence renewed at 100% on time.'));
    expect(res.status).toBe(200);
    expect(await trailReason(requestId)).toBe('Licence renewed at 100% on time.');
  });

  it('refuses a malformed encoding with a 400 and changes nothing', async () => {
    const before = await owner.query<{ n: string }>('select count(*) as n from audit_log');
    const { res, requestId } = await save({ 'x-reason': '%E2%80', 'x-reason-encoding': 'uri' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'bad_request',
      code: 'reason_unreadable',
      requestId,
    });
    const after = await owner.query<{ n: string }>('select count(*) as n from audit_log');
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  it.each([
    ['zero-width spaces', '\u200b'.repeat(12)],
    ['a NUL', '\u0000'],
    ['bidirectional marks', '\u202e\u2066\u2069'],
  ])('refuses a reason of nothing but %s, which cleans to nothing', async (_kind, typed) => {
    const { res } = await save(encoded(typed));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'reason_required' });
  });

  it('judges the decoded text, so an encoded run of spaces is no reason at all', async () => {
    const { res } = await save(encoded('   '));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'reason_required' });
  });
});
