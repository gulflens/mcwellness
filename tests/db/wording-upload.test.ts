import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isLocalStorage, storageFromEnv } from '../../app/api/_middleware/storage';
import { applySeed } from '../../db/seed/apply';
import { loadConsentTexts } from '../../db/seed/consent-text';
import { generateSeed, SEED_TENANT_ID } from '../../db/seed/generate';
import { uploadConsentWording } from '../../db/seed/wording-upload';
import { deriveIdentityKeys } from '../../domain/shared/identity';
import { freshDatabase } from './helpers';

// A test key that unlocks nothing outside this file.
const KEYS = deriveIdentityKeys(Buffer.alloc(32, 9));
const data = generateSeed();
const texts = loadConsentTexts();

let owner: pg.Client;
let dir: string;

/**
 * The seam chosen the way the command chooses it, from an environment rather
 * than by naming an implementation: STORAGE_PROVIDER=local and a folder of this
 * run's own, so the whole path is exercised with no vendor and no network
 * (docs/SEAMS.md).
 */
function store(): ReturnType<typeof storageFromEnv> {
  return storageFromEnv({ STORAGE_PROVIDER: 'local', STORAGE_DIR: dir } as NodeJS.ProcessEnv);
}

beforeAll(async () => {
  owner = await freshDatabase();
  await applySeed(owner, data, KEYS);
  dir = await mkdtemp(join(tmpdir(), 'mcwellness-wording-'));
});

afterAll(async () => {
  await owner.end();
  await rm(dir, { recursive: true, force: true });
});

describe('filing the consent wording behind the storage seam', () => {
  it('puts every wording file at the key its own row names', async () => {
    const storage = store();
    const results = await uploadConsentWording({
      client: owner,
      storage,
      tenantId: SEED_TENANT_ID,
    });
    expect(results).toHaveLength(texts.length);
    expect(results.map((r) => r.outcome)).toEqual(texts.map(() => 'uploaded'));
    expect(new Set(results.map((r) => r.storageKey)).size).toBe(texts.length);
    if (!isLocalStorage(storage)) throw new Error('The local implementation serves its own bytes.');
    for (const result of results) {
      const text = texts.find((t) => t.file === result.file);
      const bytes = await storage.get(result.storageKey ?? '');
      expect(bytes, result.file).not.toBeNull();
      // What is in the store is what the row fingerprints, byte for byte.
      expect(
        createHash('sha256')
          .update(bytes ?? Buffer.alloc(0))
          .digest('hex'),
      ).toBe(text?.sha256Hex);
      expect(result.size).toBe(text?.bytes.byteLength);
    }
  });

  it('uploads nothing the second time, because a wording is written once', async () => {
    const results = await uploadConsentWording({
      client: owner,
      storage: store(),
      tenantId: SEED_TENANT_ID,
    });
    expect(results.map((r) => r.outcome)).toEqual(texts.map(() => 'already present'));
  });

  it('refuses a file whose bytes are not the ones its row fingerprints', async () => {
    const first = texts[0];
    expect(first).toBeDefined();
    const edited = Buffer.from(`${first?.bytes.toString('utf8') ?? ''}\nAn added line.\n`);
    const results = await uploadConsentWording({
      client: owner,
      storage: store(),
      tenantId: SEED_TENANT_ID,
      texts: [
        {
          ...(first as (typeof texts)[number]),
          bytes: edited,
          sha256Hex: createHash('sha256').update(edited).digest('hex'),
        },
      ],
    });
    expect(results.map((r) => r.outcome)).toEqual(['hash mismatch']);
    // And the bytes already in the store are the ones the row points at, still.
    const storage = store();
    if (!isLocalStorage(storage)) throw new Error('The local implementation serves its own bytes.');
    const bytes = await storage.get(results[0]?.storageKey ?? '');
    expect(
      createHash('sha256')
        .update(bytes ?? Buffer.alloc(0))
        .digest('hex'),
    ).toBe(first?.sha256Hex);
  });

  it('says so, rather than inventing a key, when no row claims the file', async () => {
    const first = texts[0];
    const results = await uploadConsentWording({
      client: owner,
      storage: store(),
      tenantId: SEED_TENANT_ID,
      texts: [{ ...(first as (typeof texts)[number]), version: '99.9-unseeded' }],
    });
    expect(results.map((r) => r.outcome)).toEqual(['no row']);
    expect(results[0]?.storageKey).toBeNull();
  });

  it('sees no wording at all when it is pointed at another practice', async () => {
    const results = await uploadConsentWording({
      client: owner,
      storage: store(),
      tenantId: '00000001-0000-4000-8000-000000000002',
    });
    expect(results.map((r) => r.outcome)).toEqual(texts.map(() => 'no row'));
  });
});
