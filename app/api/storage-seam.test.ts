import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PoolLike } from './_middleware/request-context';
import { localDiskStorage, supabaseStorage } from './_middleware/storage';
import type { TokenVerifier } from './_middleware/token-verifier';
import { createApi } from './create-api';

/**
 * The forced-fallback proof for the storage seam (CLAUDE.md, the seam pattern;
 * docs/SEAMS.md): with the real implementation disabled the whole document
 * path still works, and with the real implementation selected but unreachable
 * the API still starts, still answers its health check, and refuses a document
 * call cleanly rather than falling over.
 *
 * No database and no token: the signed-URL route sits ahead of the
 * authentication fence on purpose, because the signature in the link is its
 * authorisation.
 */

const untouchedPool: PoolLike = {
  async connect() {
    throw new Error('the pool must not be touched');
  },
};
const rejectingVerifier: TokenVerifier = {
  async verify() {
    return null;
  },
};

const KEY =
  'tenant/00000000-0000-4000-8000-00000000000a/practice/00000000-0000-4000-8000-0000000000f1';
const BYTES = new TextEncoder().encode('Draft consent wording, synthetic.');

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mcwellness-fallback-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('the API with the real store disabled', () => {
  it('puts a document, signs a link, and serves those exact bytes back', async () => {
    const storage = localDiskStorage({ dir, signingSecret: Buffer.alloc(32, 3) });
    const api = createApi({ pool: untouchedPool, verifier: rejectingVerifier, storage });
    await storage.put(KEY, BYTES, 'text/markdown');

    const url = await storage.getSignedUrl(KEY, 60);
    const response = await api.request(url);

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES);
    expect(response.headers.get('cache-control')).toBe('no-store');
    // Never rendered in the browser, whatever the bytes turn out to be.
    expect(response.headers.get('content-disposition')).toBe('attachment');
  });

  it('answers an unsigned, tampered, expired or unknown link with a flat not-found', async () => {
    const storage = localDiskStorage({ dir, signingSecret: Buffer.alloc(32, 3) });
    const api = createApi({ pool: untouchedPool, verifier: rejectingVerifier, storage });
    await storage.put(KEY, BYTES, 'text/markdown');
    const url = await storage.getSignedUrl(KEY, 60);

    const unsigned = await api.request(`/api/storage/${KEY}`);
    const tampered = await api.request(url.replace(/token=./, 'token=0'));
    const expired = await api.request(url.replace(/expires=\d+/, 'expires=1'));
    const unknown = await api.request(
      await storage.getSignedUrl('tenant/a/practice/never-written', 60),
    );

    for (const response of [unsigned, tampered, expired, unknown]) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'not_found', requestId: null });
    }
  });

  it('mounts no storage route at all when no store is configured', async () => {
    const api = createApi({ pool: untouchedPool, verifier: rejectingVerifier });

    const response = await api.request(`/api/storage/${KEY}`);

    // Behind the fence with every other unknown path: refused before it is looked at.
    expect(response.status).toBe(401);
  });
});

describe('the API with the real store selected but unreachable', () => {
  const storage = supabaseStorage({
    url: 'http://127.0.0.1:1',
    serviceKey: 'not-a-real-key',
    timeoutMs: 250,
  });
  const api = createApi({ pool: untouchedPool, verifier: rejectingVerifier, storage });
  // A caller of c.get('storage'), standing in for the document routes the
  // streams will write: the point is the answer the API gives, not the path.
  api.get('/probe', async (c) => c.json({ found: await c.get('storage')?.exists(KEY) }));

  it('starts and answers its health check', async () => {
    const response = await api.request('/api/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, service: 'mcwellness-api' });
  });

  it('serves none of its own signed URLs: the vendor signs those', async () => {
    const response = await api.request(`/api/storage/${KEY}`);

    expect(response.status).toBe(401);
  });

  it('refuses a document call with a clean 503 rather than an internal error', async () => {
    const response = await api.request('/probe');

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'storage_unavailable', requestId: null });
  });
});
