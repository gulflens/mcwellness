import { createMiddleware } from 'hono/factory';
import type { Hono } from 'hono';
import {
  DEFAULT_SIGNED_URL_TTL_SECONDS,
  StorageUnavailableError,
} from '../../../../domain/shared/storage';
import type { ApiEnv } from '../request-context';
import { LOCAL_STORAGE_ROUTE, localDiskStorage } from './local-disk';
import { supabaseStorage } from './supabase';
import { isLocalStorage, type ServerStorageProvider } from './types';

export { DEFAULT_STORAGE_DIR, LOCAL_STORAGE_ROUTE, localDiskStorage } from './local-disk';
export { DOCUMENTS_BUCKET, supabaseStorage } from './supabase';
export { isLocalStorage } from './types';
export type { LocalOnly, ServerStorageProvider } from './types';

/**
 * Which implementation of the storage seam this deployment runs
 * (docs/SEAMS.md). `STORAGE_PROVIDER=local` is the deterministic fallback and
 * the default on a laptop and in the tests; `STORAGE_PROVIDER=supabase` is the
 * real one. Anywhere else — staging, production — the choice is explicit or
 * the API refuses to start, because silently falling back to a folder on a
 * server is how documents go missing.
 */
export function storageFromEnv(env: NodeJS.ProcessEnv): ServerStorageProvider {
  const chosen = env.STORAGE_PROVIDER?.trim();
  const laptop = env.APP_ENV === 'development' || env.APP_ENV === 'test';

  if (!chosen) {
    if (!laptop) {
      throw new Error(
        'STORAGE_PROVIDER is not set. Choose "supabase" or "local" explicitly outside development.',
      );
    }
    return localDiskStorage({ dir: env.STORAGE_DIR });
  }
  if (chosen === 'local') {
    return localDiskStorage({ dir: env.STORAGE_DIR });
  }
  if (chosen === 'supabase') {
    const url = env.SUPABASE_URL;
    // The anon key is the browser's and is never the storage credential.
    const serviceKey = env.SUPABASE_STORAGE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url) {
      throw new Error('STORAGE_PROVIDER=supabase needs SUPABASE_URL.');
    }
    if (!serviceKey) {
      throw new Error('STORAGE_PROVIDER=supabase needs SUPABASE_STORAGE_KEY (never the anon key).');
    }
    return supabaseStorage({ url, serviceKey });
  }
  throw new Error(`STORAGE_PROVIDER is "${chosen}"; it is "supabase" or "local".`);
}

/**
 * Publishes the provider onto the request context, the way withIdentityKeys
 * publishes the Emirates ID keys: a route reads `c.get('storage')` rather than
 * the environment. Unlike those keys this sits ahead of the authentication
 * fence, because the signed-URL route below is the one door that must answer
 * without a session — its token is its authorisation.
 */
export function withStorage(storage: ServerStorageProvider) {
  return createMiddleware<ApiEnv>(async (c, next) => {
    c.set('storage', storage);
    await next();
  });
}

/**
 * `GET /api/storage/:key` — what the local implementation's own signed URLs
 * point at, mounted by create-api.ts only when that implementation is the one
 * chosen. The Supabase implementation signs the vendor's own URLs and never
 * reaches this route.
 *
 * The token and expiry are the whole authorisation: they are verified before
 * anything is read, an unsigned or stale link is a flat 404 rather than a hint
 * that the key exists, and the answer is never cached.
 */
export function mountLocalStorage(api: Hono<ApiEnv>, storage: ServerStorageProvider): void {
  if (!isLocalStorage(storage)) return;
  api.get(`${LOCAL_STORAGE_ROUTE}/:key{.+}`, async (c) => {
    const key = c.req.param('key');
    const expires = Number(c.req.query('expires'));
    const token = c.req.query('token') ?? '';
    if (!storage.verifySigned({ key, expires, token })) {
      return c.json({ error: 'not_found', requestId: c.get('requestId') ?? null }, 404);
    }
    const bytes = await storage.read(key);
    if (bytes === null) {
      return c.json({ error: 'not_found', requestId: c.get('requestId') ?? null }, 404);
    }
    c.header('cache-control', 'no-store');
    c.header('content-type', 'application/octet-stream');
    c.header('content-disposition', 'attachment');
    return c.body(new Uint8Array(bytes));
  });
}

/** The 503 an unreachable store gets, in the shape every other refusal uses. */
export function isStorageUnavailable(error: unknown): error is StorageUnavailableError {
  return error instanceof StorageUnavailableError;
}

export { DEFAULT_SIGNED_URL_TTL_SECONDS };
