import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../../app/api/_middleware/db';
import { createTokenVerifier } from '../../../app/api/_middleware/token-verifier';
import { createApi } from '../../../app/api/create-api';
import type { ClientListResponse } from '../../../app/api/clients/schema';
import type {
  ClientRecordResponse,
  CreateClientResponse,
  GoalCategoryListResponse,
} from '../../../app/api/clients/record-schema';
import { luhnCheckDigit } from '../../../db/seed/generate';
import { deriveIdentityKeys } from '../../../domain/shared/identity';
import { IDS, AUTH, freshDatabase, seedTenant, seedUser } from '../../db/helpers';

/**
 * The third pull request's own database coverage (task brief item 3 and
 * item 5): capturing an Emirates ID on a contact seals and hashes it rather
 * than storing it in the clear, the list route finds a client by that
 * fingerprint, and the goal-categories reference route answers.
 */

const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const ISSUER = 'http://localhost:54321/auth/v1';
const KEY = new TextEncoder().encode(SECRET);
const PRACTITIONER_ID = '00000000-0000-4000-8000-000000000ba1';
const PRACTITIONER_AUTH = '00000000-0000-4000-8000-000000000ba2';
const FINANCE_ID = '00000000-0000-4000-8000-000000000ba3';
const FINANCE_AUTH = '00000000-0000-4000-8000-000000000ba4';

let owner: pg.Client;
let pool: pg.Pool;
let api: ReturnType<typeof createApi>;
let apiWithoutKeys: ReturnType<typeof createApi>;

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

async function request(
  target: typeof api,
  sub: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${await mint(sub)}`);
  if (init.body) headers.set('content-type', 'application/json');
  return target.request(path, { ...init, headers });
}

/** The lookup route: the identity number travels in the body, never in the URL. */
async function lookup(
  target: typeof api,
  sub: string,
  emiratesId: string,
  requestId?: string,
): Promise<Response> {
  return request(target, sub, '/api/clients/lookup', {
    method: 'POST',
    body: JSON.stringify({ emiratesId }),
    ...(requestId ? { headers: { 'x-request-id': requestId } } : {}),
  });
}

/** 784-1900-NNNNNNN-C, the reserved synthetic range, with a real Luhn check digit. */
function emiratesId(seq: number): string {
  const digits = `7841900${String(seq).padStart(7, '0')}`;
  return `784-1900-${digits.slice(7)}-${luhnCheckDigit(digits)}`;
}

beforeAll(async () => {
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Synthetic Studio');
  await owner.query('update app_user set auth_id = $1 where id = $2', [AUTH.ownerA, IDS.ownerA]);
  await seedUser(owner, {
    id: PRACTITIONER_ID,
    tenantId: IDS.tenantA,
    authId: PRACTITIONER_AUTH,
    displayName: 'Synthetic Practitioner',
    roles: ['practitioner'],
  });
  await seedUser(owner, {
    id: FINANCE_ID,
    tenantId: IDS.tenantA,
    authId: FINANCE_AUTH,
    displayName: 'Synthetic Finance',
    roles: ['finance'],
  });

  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  pool = createPool(apiUrl);
  const verifier = createTokenVerifier({ issuer: ISSUER, secret: SECRET });
  // createApi mounts the list, the lookup and the record routes itself (PR 31).
  api = createApi({ pool, verifier, identityKeys: deriveIdentityKeys(Buffer.alloc(32, 9)) });
  apiWithoutKeys = createApi({ pool, verifier });
});

afterAll(async () => {
  await pool.end();
  await owner.end();
});

describe('capturing an Emirates ID on create', () => {
  it('seals and hashes it, never stores it in the clear, and it is findable by search', async () => {
    const identity = emiratesId(1);
    const created = (await (
      await request(api, AUTH.ownerA, '/api/clients', {
        method: 'POST',
        body: JSON.stringify({
          givenName: 'Juniper',
          familyName: 'Quarry',
          contact: { relationship: 'self', phone: '+971500000050', emiratesId: identity },
        }),
      })
    ).json()) as CreateClientResponse;

    const { rows } = await owner.query<{
      emirates_id_encrypted: Buffer | null;
      emirates_id_hash: Buffer | null;
    }>('select emirates_id_encrypted, emirates_id_hash from contact where client_id = $1', [
      created.id,
    ]);
    const row = rows[0];
    expect(row?.emirates_id_hash).not.toBeNull();
    // Never the digits, sealed or not, in the clear anywhere in the column.
    const digits = identity.replace(/\D/g, '');
    expect(row?.emirates_id_encrypted?.toString('latin1')).not.toContain(digits);

    const detail = (await (
      await request(api, AUTH.ownerA, `/api/clients/${created.id}`)
    ).json()) as ClientRecordResponse;
    expect(detail.contacts[0]?.hasEmiratesId).toBe(true);
    expect(JSON.stringify(detail)).not.toContain(digits);

    const found = (await (await lookup(api, AUTH.ownerA, identity)).json()) as ClientListResponse;
    expect(found.clients.map((c) => c.id)).toEqual([created.id]);

    // Hyphens or none, the same fingerprint.
    const foundBare = (await (await lookup(api, AUTH.ownerA, digits)).json()) as ClientListResponse;
    expect(foundBare.clients.map((c) => c.id)).toEqual([created.id]);

    const noMatch = (await (
      await lookup(api, AUTH.ownerA, emiratesId(2))
    ).json()) as ClientListResponse;
    expect(noMatch.clients).toHaveLength(0);

    // The ordinary search refuses an identity number outright rather than searching
    // it, whole or half-typed: one never travels in a query string
    // (.claude/rules/ui.md), and the route is the floor under the browser's own rule.
    for (const term of [digits, digits.slice(0, 14), '784', '78']) {
      const asText = await request(api, AUTH.ownerA, `/api/clients?q=${encodeURIComponent(term)}`);
      expect(asText.status).toBe(400);
      expect(((await asText.json()) as { code?: string }).code).toBe('use_lookup');
    }
    // A record number is not mistaken for one.
    const byMrn = await request(api, AUTH.ownerA, '/api/clients?q=MW-0');
    expect(byMrn.status).toBe(200);
  });

  it('refuses a checksum that fails, and a duplicate on a second contact', async () => {
    const bad = await request(api, AUTH.ownerA, '/api/clients', {
      method: 'POST',
      body: JSON.stringify({
        givenName: 'Rowan',
        familyName: 'Lagoon',
        contact: { relationship: 'self', phone: '+971500000051', emiratesId: '784-1900-0000000-0' },
      }),
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { code?: string }).code).toBe('invalid_emirates_id');

    const shared = emiratesId(3);
    const first = (await (
      await request(api, AUTH.ownerA, '/api/clients', {
        method: 'POST',
        body: JSON.stringify({
          givenName: 'Hazel',
          familyName: 'Summit',
          contact: { relationship: 'self', phone: '+971500000052', emiratesId: shared },
        }),
      })
    ).json()) as CreateClientResponse;
    expect(first.id).toBeTruthy();

    const second = await request(api, AUTH.ownerA, '/api/clients', {
      method: 'POST',
      body: JSON.stringify({
        givenName: 'Basil',
        familyName: 'Summit',
        contact: { relationship: 'self', phone: '+971500000053', emiratesId: shared },
      }),
    });
    expect(second.status).toBe(409);
    expect(((await second.json()) as { code?: string }).code).toBe('emirates_id_in_use');
  });

  it('records seeing the client it found, the same as listing one does', async () => {
    const identity = emiratesId(8);
    const created = (await (
      await request(api, AUTH.ownerA, '/api/clients', {
        method: 'POST',
        body: JSON.stringify({
          givenName: 'Clover',
          familyName: 'Harbour',
          contact: { relationship: 'self', phone: '+971500000057', emiratesId: identity },
        }),
      })
    ).json()) as CreateClientResponse;

    const requestId = '00000000-0000-4000-8000-0000000000f1';
    const found = (await (
      await lookup(api, AUTH.ownerA, identity, requestId)
    ).json()) as ClientListResponse;
    expect(found.clients.map((c) => c.id)).toEqual([created.id]);

    const { rows } = await owner.query<{ n: number }>(
      "select count(*)::int as n from audit_log where action = 'list' and entity_type = 'client' " +
        'and request_id = $1 and actor_id = $2 and client_id = entity_id and entity_id = $3',
      [requestId, IDS.ownerA, created.id],
    );
    expect(rows[0]?.n).toBe(1);

    // And the number itself is nowhere in what the trail kept.
    const { rows: payloads } = await owner.query<{ n: number }>(
      'select count(*)::int as n from audit_log ' +
        'where request_id = $1 and (new_values::text like $2 or old_values::text like $2)',
      [requestId, `%${identity.replace(/\D/g, '')}%`],
    );
    expect(payloads[0]?.n).toBe(0);
  });

  it('records a search that found nobody, not only one that found someone', async () => {
    const requestId = '00000000-0000-4000-8000-0000000000f2';
    const empty = (await (
      await lookup(api, AUTH.ownerA, emiratesId(9), requestId)
    ).json()) as ClientListResponse;
    expect(empty.clients).toHaveLength(0);

    const { rows } = await owner.query<{ n: number }>(
      "select count(*)::int as n from audit_log where action = 'list' and entity_type = 'client' " +
        'and request_id = $1 and actor_id = $2',
      [requestId, IDS.ownerA],
    );
    expect(rows[0]?.n).toBe(1);
  });

  it('says so, rather than answering an empty list, when the identity keys are missing', async () => {
    const res = await request(apiWithoutKeys, AUTH.ownerA, '/api/clients/lookup', {
      method: 'POST',
      body: JSON.stringify({ emiratesId: emiratesId(7) }),
    });
    expect(res.status).toBe(503);
  });

  it('refuses cleanly, not a crash, when the identity keys are not configured', async () => {
    const res = await request(apiWithoutKeys, AUTH.ownerA, '/api/clients', {
      method: 'POST',
      body: JSON.stringify({
        givenName: 'Willow',
        familyName: 'Ridge',
        contact: { relationship: 'self', phone: '+971500000054', emiratesId: emiratesId(4) },
      }),
    });
    expect(res.status).toBe(503);
    const { rows } = await owner.query<{ n: string }>(
      "select count(*)::text as n from client where family_name = 'Ridge'",
    );
    // Refused before the client row was ever allocated an MRN (record.ts's own ordering).
    expect(rows[0]?.n).toBe('0');
  });
});

describe('capturing an Emirates ID on a contact add or edit', () => {
  it('seals and hashes it on POST, replaces it on PATCH, and clears it with null', async () => {
    const created = (await (
      await request(api, AUTH.ownerA, '/api/clients', {
        method: 'POST',
        body: JSON.stringify({
          givenName: 'Saffron',
          familyName: 'Orchard',
          contact: { relationship: 'self', phone: '+971500000055' },
        }),
      })
    ).json()) as CreateClientResponse;

    const firstId = emiratesId(5);
    const addContact = (await (
      await request(api, AUTH.ownerA, `/api/clients/${created.id}/contacts`, {
        method: 'POST',
        body: JSON.stringify({
          relationship: 'mother',
          phone: '+971500000056',
          emiratesId: firstId,
        }),
      })
    ).json()) as { id: string };
    const afterAdd = (await (
      await request(api, AUTH.ownerA, `/api/clients/${created.id}`)
    ).json()) as ClientRecordResponse;
    const added = afterAdd.contacts.find((c) => c.id === addContact.id);
    expect(added?.hasEmiratesId).toBe(true);

    const secondId = emiratesId(6);
    const edited = await request(
      api,
      AUTH.ownerA,
      `/api/clients/${created.id}/contacts/${addContact.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ emiratesId: secondId }),
      },
    );
    expect(edited.status).toBe(200);
    const { rows: afterEdit } = await owner.query<{ emirates_id_hash: Buffer }>(
      'select emirates_id_hash from contact where id = $1',
      [addContact.id],
    );
    // The old identity number no longer finds this client; the new one does.
    const staleSearch = (await (
      await lookup(api, AUTH.ownerA, firstId)
    ).json()) as ClientListResponse;
    expect(staleSearch.clients).toHaveLength(0);
    const freshSearch = (await (
      await lookup(api, AUTH.ownerA, secondId)
    ).json()) as ClientListResponse;
    expect(freshSearch.clients.map((c) => c.id)).toEqual([created.id]);
    expect(afterEdit[0]?.emirates_id_hash).not.toBeNull();

    const cleared = await request(
      api,
      AUTH.ownerA,
      `/api/clients/${created.id}/contacts/${addContact.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ emiratesId: null }),
      },
    );
    expect(cleared.status).toBe(200);
    const { rows: afterClear } = await owner.query<{
      emirates_id_hash: Buffer | null;
      emirates_id_encrypted: Buffer | null;
    }>('select emirates_id_hash, emirates_id_encrypted from contact where id = $1', [
      addContact.id,
    ]);
    expect(afterClear[0]?.emirates_id_hash).toBeNull();
    expect(afterClear[0]?.emirates_id_encrypted).toBeNull();
  });
});

describe('who may search by identity number', () => {
  it('refuses finance the lookup, and still lets it list by name', async () => {
    // Finance reads demographics and contacts (client-record.md section 2), but the
    // stated need for holding an identity number at all is verifying the adult who
    // consents for a minor or who is refunded — and finance does neither. A role that
    // may not ask is told nothing about whether the number is on file.
    const res = (await (
      await lookup(api, FINANCE_AUTH, emiratesId(1))
    ).json()) as ClientListResponse;
    expect(res.clients).toHaveLength(0);
    expect(res.note).toBe('schedule');

    // The table itself is unchanged for finance.
    const byName = await request(api, FINANCE_AUTH, '/api/clients?q=Juniper');
    expect(byName.status).toBe(200);
    expect(((await byName.json()) as ClientListResponse).clients.length).toBeGreaterThan(0);
  });

  it('records the refusal, so a search finance may not make still leaves a trace', async () => {
    const requestId = '00000000-0000-4000-8000-0000000000f3';
    await lookup(api, FINANCE_AUTH, emiratesId(1), requestId);
    const { rows } = await owner.query<{ n: number }>(
      "select count(*)::int as n from audit_log where action = 'list' and entity_type = 'client' " +
        'and request_id = $1 and actor_id = $2 and client_id is null',
      [requestId, FINANCE_ID],
    );
    expect(rows[0]?.n).toBe(1);
  });
});

describe('a date of birth is in the past', () => {
  it('refuses one in the future on create and on edit, naming the field', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const created = await request(api, AUTH.ownerA, '/api/clients', {
      method: 'POST',
      body: JSON.stringify({
        givenName: 'Iris',
        familyName: 'Dune',
        dateOfBirth: future,
        contact: { relationship: 'self', phone: '+971500000059' },
      }),
    });
    expect(created.status).toBe(400);
    // Named by field, so the screen can say which one (design review of pull request 35).
    expect(((await created.json()) as { fields?: string[] }).fields).toContain('dateOfBirth');

    const real = (await (
      await request(api, AUTH.ownerA, '/api/clients', {
        method: 'POST',
        body: JSON.stringify({
          givenName: 'Iris',
          familyName: 'Dune',
          contact: { relationship: 'self', phone: '+971500000060' },
        }),
      })
    ).json()) as CreateClientResponse;
    const patched = await request(api, AUTH.ownerA, `/api/clients/${real.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ dateOfBirth: future }),
    });
    expect(patched.status).toBe(400);
    // Today is fine: a client born today is not refused for the server's own clock.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date());
    const ok = await request(api, AUTH.ownerA, `/api/clients/${real.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ dateOfBirth: today }),
    });
    expect(ok.status).toBe(200);
  });
});

describe('GET /api/clients/goal-categories', () => {
  it('answers the six seeded categories for staff roles, and refuses finance', async () => {
    const res = (await (
      await request(api, AUTH.ownerA, '/api/clients/goal-categories')
    ).json()) as GoalCategoryListResponse;
    expect(res.categories.map((c) => c.code).sort()).toEqual(
      ['behaviour', 'calm', 'focus', 'mood', 'performance', 'sleep'].sort(),
    );

    const asPractitioner = await request(api, PRACTITIONER_AUTH, '/api/clients/goal-categories');
    expect(asPractitioner.status).toBe(200);

    // Finance reads demographics and contacts only, never goals (client-record.md section 2).
    const asFinance = await request(api, FINANCE_AUTH, '/api/clients/goal-categories');
    expect(asFinance.status).toBe(403);
  });
});
