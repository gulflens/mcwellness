import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../app/api/_middleware/db';
import { localDiskStorage } from '../../app/api/_middleware/storage';
import type { ServerStorageProvider } from '../../app/api/_middleware/storage';
import { createTokenVerifier } from '../../app/api/_middleware/token-verifier';
import { createApi } from '../../app/api/create-api';
import type { PracticeLogoResponse } from '../../app/api/practice/schema';
import { applySeed } from '../../db/seed/apply';
import { generateSeed } from '../../db/seed/generate';
import { deriveIdentityKeys } from '../../domain/shared/identity';
import { asApiRole, freshDatabase, IDS, rejectsWith, rolledBack, seedTenant } from './helpers';

/**
 * The practice's logo, end to end against a real database and a real store
 * (migration 909, app/api/practice/logo.ts,
 * docs/CHANGE-REQUESTS/billing-04.md request 5).
 *
 * What is worth proving here is what a later reader will doubt: that the
 * bytes and the row arrive together, that replacing one leaves exactly one
 * behind, that the file is what it says it is, that removing one takes the
 * bytes with it, and that a practitioner cannot touch any of it.
 */

const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const ISSUER = 'http://localhost:54321/auth/v1';
const KEY = new TextEncoder().encode(SECRET);
const data = generateSeed();

/**
 * The smallest honest PNG and JPEG: the signature bytes the route checks,
 * followed by nothing in particular. Nothing renders them and nothing needs
 * to — what is under test is the signature check, not an image decoder.
 */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(64, 2)]);
/** A PDF's own leading bytes, offered as a PNG: the claim the route disbelieves. */
const NOT_AN_IMAGE = Buffer.from('%PDF-1.7\nnot an image at all', 'utf8');

let owner: pg.Client;
let pool: pg.Pool;
let api: ReturnType<typeof createApi>;
let storage: ServerStorageProvider;
let dir: string;

/** The seeded people: 0 holds every office role, 1 and 2 only treat. */
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
  method: 'GET' | 'POST' | 'DELETE',
  sub: string,
  body?: unknown,
): Promise<Response> {
  const headers: Record<string, string> = { authorization: `Bearer ${await mint(sub)}` };
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return api.request('/api/practice/logo', init);
}

async function upload(sub: string, bytes: Buffer, mimeType: string): Promise<Response> {
  return call('POST', sub, { mimeType, bytesBase64: bytes.toString('base64') });
}

/** Every logo row this practice holds, whatever the route thinks. */
async function logoRows(): Promise<{ id: string; storage_key: string; mime_type: string }[]> {
  const { rows } = await owner.query<{ id: string; storage_key: string; mime_type: string }>(
    "select id, storage_key, mime_type from document where kind = 'practice_logo' order by id",
  );
  return rows;
}

beforeAll(async () => {
  owner = await freshDatabase();
  await applySeed(owner, data, deriveIdentityKeys(Buffer.alloc(32, 7)));
  dir = await mkdtemp(join(tmpdir(), 'mcwellness-logo-'));
  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  pool = createPool(apiUrl);
  storage = localDiskStorage({ dir, signingSecret: Buffer.alloc(32, 13) });
  // createApi as the server builds it, so this proves the mount as well as
  // the route (tests/db/route-mounts.test.ts's own point).
  api = createApi({
    pool,
    verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }),
    storage,
  });
}, 120_000);

afterAll(async () => {
  await pool.end();
  await owner.end();
  await rm(dir, { recursive: true, force: true });
});

describe('the practice with no logo', () => {
  it('says so plainly rather than pretending there is one', async () => {
    const res = await call('GET', authIdOf(0));
    expect(res.status).toBe(404);
    expect(await logoRows()).toEqual([]);
  });

  it('has nothing to remove', async () => {
    const res = await call('DELETE', authIdOf(0));
    expect(res.status).toBe(404);
  });
});

describe('uploading one', () => {
  it('puts the bytes in the store and the row that names them, and hands back a link', async () => {
    const res = await upload(authIdOf(0), PNG, 'image/png');
    expect(res.status).toBe(200);
    const { logo } = (await res.json()) as PracticeLogoResponse;
    expect(logo.mimeType).toBe('image/png');
    expect(logo.expiresInSeconds).toBeGreaterThan(0);

    const rows = await logoRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(logo.documentId);
    // Keyed by ids alone, never by a name (domain/shared/storage.ts).
    expect(rows[0]?.storage_key).toBe(`tenant/${data.tenant.id}/practice/${logo.documentId}`);
    expect(await storage.exists(rows[0]?.storage_key ?? '')).toBe(true);
  });

  it('records the read of the link it signed, before signing it', async () => {
    // auditDocumentRead before getSignedUrl, every time: signing is the only
    // moment there is an actor to name (docs/SEAMS.md).
    const [row] = await logoRows();
    const { rows } = await owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'read' and entity_type = 'document' " +
        'and entity_id = $1',
      [row?.id],
    );
    expect(Number(rows[0]?.n ?? '0')).toBeGreaterThan(0);
  });

  it('reads it back with a fresh link', async () => {
    const res = await call('GET', authIdOf(0));
    expect(res.status).toBe(200);
    const { logo } = (await res.json()) as PracticeLogoResponse;
    const [row] = await logoRows();
    expect(logo.documentId).toBe(row?.id);
    expect(logo.url.length).toBeGreaterThan(0);
  });

  it('files it against no client, so no erasure can take it', async () => {
    const { rows } = await owner.query<{ client_id: string | null; is_immutable: boolean }>(
      "select client_id, is_immutable from document where kind = 'practice_logo'",
    );
    expect(rows[0]?.client_id).toBeNull();
    // A mark the practice replaces, not evidence of what anybody was shown.
    expect(rows[0]?.is_immutable).toBe(false);
  });

  it('puts it on no upload clock, so nothing sweeps the mark off the practice', async () => {
    // RETENTION_EXEMPT_KINDS (domain/shared/storage.ts, migration 909). There
    // is one logo at a time and it is replaced rather than expired, so five
    // years from upload would mark the current mark for deletion while every
    // document still carries it.
    const { rows } = await owner.query<{ retention_until: Date | null }>(
      "select retention_until from document where kind = 'practice_logo'",
    );
    expect(rows[0]?.retention_until).toBeNull();
  });
});

describe('replacing one', () => {
  it('leaves exactly one logo, and takes the old bytes with it', async () => {
    const [before] = await logoRows();
    const oldKey = before?.storage_key ?? '';

    const res = await upload(authIdOf(0), JPEG, 'image/jpeg');
    expect(res.status).toBe(200);
    const { logo } = (await res.json()) as PracticeLogoResponse;

    const rows = await logoRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(logo.documentId);
    expect(rows[0]?.mime_type).toBe('image/jpeg');
    expect(rows[0]?.id).not.toBe(before?.id);
    // The bytes go after the commit, never inside it: a delete cannot be
    // rolled back and a transaction can (docs/SEAMS.md).
    expect(await storage.exists(oldKey)).toBe(false);
    expect(await storage.exists(rows[0]?.storage_key ?? '')).toBe(true);
  });
});

describe('what it refuses', () => {
  it('refuses a file that is not what it says it is', async () => {
    const res = await upload(authIdOf(0), NOT_AN_IMAGE, 'image/png');
    expect(res.status).toBe(400);
    expect((await res.json()) as { code: string }).toMatchObject({
      code: 'bytes_do_not_match_type',
    });
  });

  it('refuses a media type a PDF cannot draw', async () => {
    const res = await upload(authIdOf(0), PNG, 'image/svg+xml');
    expect(res.status).toBe(400);
    expect((await res.json()) as { code: string }).toMatchObject({ code: 'unsupported_type' });
  });

  it('refuses a practitioner every one of the three', async () => {
    const practitioner = authIdOf(1);
    expect((await call('GET', practitioner)).status).toBe(403);
    expect((await upload(practitioner, PNG, 'image/png')).status).toBe(403);
    expect((await call('DELETE', practitioner)).status).toBe(403);
    // And nothing moved.
    expect(await logoRows()).toHaveLength(1);
  });

  it('refuses a second logo written round the route, whoever writes it', async () => {
    // Migration 909's partial unique index: one per practice, so "the logo"
    // is a row rather than a convention.
    const id = '00000000-0000-4000-8000-000000000909';
    await expect(
      owner.query(
        'insert into document (id, tenant_id, client_id, kind, storage_key, mime_type, sha256) ' +
          "values ($1, $2, null, 'practice_logo', $3, 'image/png', sha256(($4)::bytea))",
        [id, data.tenant.id, `tenant/${data.tenant.id}/practice/${id}`, 'second'],
      ),
    ).rejects.toThrow('document_practice_logo_idx');
  });

  it('refuses a logo filed against a household', async () => {
    const client = data.clients[0];
    const id = '00000000-0000-4000-8000-00000000090a';
    await expect(
      owner.query(
        'insert into document (id, tenant_id, client_id, kind, storage_key, mime_type, sha256) ' +
          "values ($1, $2, $3, 'practice_logo', $4, 'image/png', sha256(($5)::bytea))",
        [id, data.tenant.id, client?.id, `tenant/${data.tenant.id}/practice/${id}`, 'household'],
      ),
    ).rejects.toThrow('document_practice_logo_has_no_client');
  });
});

describe('the door itself: app.remove_practice_logo()', () => {
  /**
   * The route is one caller; the function is the rule. `app_role` holds
   * execute on it (it is the one delete app_role may cause on `document`), so
   * a practitioner who has signed in can reach it directly whatever a screen
   * shows, and it has to refuse them itself. Both cases run inside a rolled
   * back transaction, so the practice's own logo is where the next test
   * expects it.
   */
  const INSUFFICIENT_PRIVILEGE = '42501';

  it('refuses a practitioner calling it directly, and leaves the logo standing', async () => {
    await rolledBack(owner, async () => {
      await asApiRole(
        owner,
        data.tenant.id,
        async () => {
          await rejectsWith(owner, INSUFFICIENT_PRIVILEGE, 'select app.remove_practice_logo()');
        },
        'practitioner',
      );
    });
    expect(await logoRows()).toHaveLength(1);
  });

  it("reaches only the caller's own practice, never another's", async () => {
    // app.current_tenant_id() scopes the delete, so tenant B calling it finds
    // nothing of its own and takes nothing of A's.
    await rolledBack(owner, async () => {
      await seedTenant(owner, IDS.tenantB, IDS.ownerB, 'Synthetic Studio B');
      await asApiRole(owner, IDS.tenantB, async () => {
        const { rows } = await owner.query<{ key: string | null }>(
          'select app.remove_practice_logo() as key',
        );
        expect(rows[0]?.key).toBeNull();
      });
      expect(await logoRows()).toHaveLength(1);
    });
    expect(await logoRows()).toHaveLength(1);
  });
});

describe('removing one', () => {
  it('takes the row and the bytes, and leaves the wordmark standing', async () => {
    const [before] = await logoRows();
    const key = before?.storage_key ?? '';

    const res = await call('DELETE', authIdOf(0));
    expect(res.status).toBe(204);

    expect(await logoRows()).toEqual([]);
    expect(await storage.exists(key)).toBe(false);
    expect((await call('GET', authIdOf(0))).status).toBe(404);
  });

  it('records the removal on the trail like any other row change', async () => {
    const { rows } = await owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'delete' and entity_type = 'document'",
    );
    expect(Number(rows[0]?.n ?? '0')).toBeGreaterThan(0);
  });
});
