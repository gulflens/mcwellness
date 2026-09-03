import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import {
  assertValidStorageKey,
  MAX_SIGNED_URL_TTL_SECONDS,
  StorageUnavailableError,
  type StoredObject,
} from '../../../../domain/shared/storage';
import type { ServerStorageProvider } from './types';

/**
 * The deterministic fallback behind the storage seam (docs/SEAMS.md): a folder
 * on the machine running the API — `STORAGE_DIR`, `.storage/` by default and
 * git-ignored. Same semantics as the real one, bytes in and sha256 out, so
 * every test and every laptop runs the whole document path with no vendor and
 * no network.
 *
 * A signed URL here points back at this API's own `GET /api/storage/:key`,
 * which create-api.ts mounts only when this implementation is the one chosen.
 * The token is an HMAC over the key and the expiry under a secret this process
 * holds — fresh random at startup unless one is given — so a URL never
 * outlives the process that issued it and no new secret enters the
 * environment.
 *
 * A key is validated first (domain/shared/storage.ts) and then resolved
 * against the folder and checked again, so nothing is read or written outside
 * it even if that validation is ever loosened.
 */

export const DEFAULT_STORAGE_DIR = '.storage';
export const LOCAL_STORAGE_ROUTE = '/api/storage';

export type LocalDiskOptions = {
  /** Where the bytes live. A relative path resolves against the working directory. */
  dir?: string;
  /** The HMAC secret behind a signed URL. Fresh random per process unless a test pins it. */
  signingSecret?: Buffer;
  /** What a signed URL is prefixed with. Empty (the default) gives a same-origin path. */
  baseUrl?: string;
};

function unavailable(what: string, cause: unknown): StorageUnavailableError {
  // The key never reaches the message: it names a document.
  return new StorageUnavailableError(`The document store could not ${what}.`, { cause });
}

/** Resolves a key inside the root, and refuses anything that would land outside it. */
function pathFor(root: string, key: string): string {
  assertValidStorageKey(key);
  const full = resolve(root, key);
  if (!full.startsWith(root + sep)) {
    throw new Error('That storage key is not a valid one.');
  }
  return full;
}

export function localDiskStorage(options: LocalDiskOptions = {}): ServerStorageProvider {
  const root = resolve(options.dir ?? process.env.STORAGE_DIR ?? DEFAULT_STORAGE_DIR);
  const secret = options.signingSecret ?? randomBytes(32);
  const baseUrl = options.baseUrl ?? '';

  const sign = (key: string, expires: number): string =>
    createHmac('sha256', secret).update(`${key}\n${expires}`).digest('hex');

  return {
    kind: 'local',
    root,

    async put(key: string, bytes: Uint8Array, mimeType: string): Promise<StoredObject> {
      const path = pathFor(root, key);
      void mimeType; // The type is the document row's to hold; the disk keeps bytes only.
      try {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, bytes);
      } catch (error) {
        throw unavailable('write that document', error);
      }
      return { sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.byteLength };
    },

    async getSignedUrl(key: string, ttlSeconds: number): Promise<string> {
      assertValidStorageKey(key);
      const ttl = Math.min(Math.max(1, Math.floor(ttlSeconds)), MAX_SIGNED_URL_TTL_SECONDS);
      const expires = Math.floor(Date.now() / 1000) + ttl;
      const path = key.split('/').map(encodeURIComponent).join('/');
      return `${baseUrl}${LOCAL_STORAGE_ROUTE}/${path}?expires=${expires}&token=${sign(key, expires)}`;
    },

    async delete(key: string): Promise<void> {
      const path = pathFor(root, key);
      try {
        await rm(path, { force: true });
      } catch (error) {
        throw unavailable('remove that document', error);
      }
    },

    async exists(key: string): Promise<boolean> {
      const path = pathFor(root, key);
      try {
        return (await stat(path)).isFile();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw unavailable('read that document', error);
      }
    },

    /** Verifies a signed URL's own parts, in constant time, before any read happens. */
    verifySigned({ key, expires, token }, now = Date.now()): boolean {
      if (!Number.isFinite(expires) || expires * 1000 < now) return false;
      const expected = Buffer.from(sign(key, expires), 'utf8');
      const given = Buffer.from(token, 'utf8');
      return expected.length === given.length && timingSafeEqual(expected, given);
    },

    /** The bytes, or null when nothing is stored there — a missing file is not an outage. */
    async read(key: string): Promise<Buffer | null> {
      const path = pathFor(root, key);
      try {
        return await readFile(path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw unavailable('read that document', error);
      }
    },

    describe(): string {
      return `local disk at ${root}`;
    },
  };
}
