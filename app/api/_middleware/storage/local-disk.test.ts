import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StorageUnavailableError } from '../../../../domain/shared/storage';
import { localDiskStorage } from './local-disk';
import { isLocalStorage } from './types';

const SECRET = Buffer.alloc(32, 9);
const KEY = 'tenant/00000000-0000-4000-8000-00000000000a/practice/consent-participation-en';
const BYTES = new TextEncoder().encode('Draft consent wording, synthetic.');
const SHA256 = createHash('sha256').update(BYTES).digest('hex');

let dir: string;
let storage: ReturnType<typeof localDiskStorage>;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mcwellness-storage-'));
  storage = localDiskStorage({ dir, signingSecret: SECRET });
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** The parts of one of this provider's own signed URLs. */
function partsOf(url: string): { key: string; expires: number; token: string } {
  const parsed = new URL(url, 'http://localhost');
  const key = parsed.pathname
    .replace('/api/storage/', '')
    .split('/')
    .map(decodeURIComponent)
    .join('/');
  return {
    key,
    expires: Number(parsed.searchParams.get('expires')),
    token: parsed.searchParams.get('token') ?? '',
  };
}

describe('the local disk store', () => {
  it('writes bytes, reports their sha256 and size, and knows they are there', async () => {
    expect(await storage.exists(KEY)).toBe(false);

    const written = await storage.put(KEY, BYTES, 'text/markdown');

    expect(written).toEqual({ sha256: SHA256, size: BYTES.byteLength });
    expect(await storage.exists(KEY)).toBe(true);
    expect(await readFile(join(dir, KEY))).toEqual(Buffer.from(BYTES));
  });

  it('hands back the same bytes it was given', async () => {
    expect(isLocalStorage(storage)).toBe(true);
    if (!isLocalStorage(storage)) return;

    expect(await storage.read(KEY)).toEqual(Buffer.from(BYTES));
    expect(await storage.read('tenant/a/practice/absent')).toBeNull();
  });

  it('signs a URL that verifies, and refuses a tampered or stale one', async () => {
    if (!isLocalStorage(storage)) throw new Error('the local provider serves its own URLs');
    const url = await storage.getSignedUrl(KEY, 60);
    const parts = partsOf(url);

    expect(url.startsWith('/api/storage/')).toBe(true);
    expect(parts.key).toBe(KEY);
    expect(storage.verifySigned(parts)).toBe(true);
    expect(storage.verifySigned({ ...parts, token: 'a'.repeat(64) })).toBe(false);
    expect(storage.verifySigned({ ...parts, token: '' })).toBe(false);
    expect(storage.verifySigned({ ...parts, key: 'tenant/a/practice/other' })).toBe(false);
    expect(storage.verifySigned({ ...parts, expires: parts.expires + 1 })).toBe(false);
    // A minute later the same link is no longer good for anything.
    expect(storage.verifySigned(parts, Date.now() + 61_000)).toBe(false);
  });

  it('caps how long a signed URL may live, however long is asked for', async () => {
    const url = await storage.getSignedUrl(KEY, 60 * 60 * 24 * 365);
    const { expires } = partsOf(url);

    expect(expires - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(3600);
  });

  it('removes an object, and removing what is not there is not an error', async () => {
    await storage.put('tenant/a/practice/temporary', BYTES, 'text/markdown');

    await storage.delete('tenant/a/practice/temporary');
    await storage.delete('tenant/a/practice/temporary');

    expect(await storage.exists('tenant/a/practice/temporary')).toBe(false);
  });

  it('refuses a key that would climb out of the folder, on every operation', async () => {
    const outside = '../escaped';
    await expect(storage.put(outside, BYTES, 'text/plain')).rejects.toThrow('not a valid one');
    await expect(storage.exists(outside)).rejects.toThrow('not a valid one');
    await expect(storage.delete(outside)).rejects.toThrow('not a valid one');
    await expect(storage.getSignedUrl(outside, 60)).rejects.toThrow('not a valid one');
    if (isLocalStorage(storage)) {
      await expect(storage.read(outside)).rejects.toThrow('not a valid one');
    }

    // Belt and braces: a file really does sit outside, and none of the above reached it.
    const neighbour = join(dir, '..', 'escaped');
    await writeFile(neighbour, 'not the practice');
    expect(await readFile(neighbour, 'utf8')).toBe('not the practice');
    await rm(neighbour, { force: true });
  });

  it('says where it keeps things, and never anything else', () => {
    expect(storage.describe()).toBe(`local disk at ${dir}`);
  });

  it('reports a folder it cannot write to as the store being unavailable', async () => {
    const unwritable = localDiskStorage({
      // A file, not a folder: mkdir under it fails the way a full or read-only disk would.
      dir: join(dir, KEY),
      signingSecret: SECRET,
    });

    await expect(unwritable.put('a/b', BYTES, 'text/plain')).rejects.toBeInstanceOf(
      StorageUnavailableError,
    );
  });
});
