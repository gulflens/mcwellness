import { createHash } from 'node:crypto';
import {
  alreadyStored,
  assertValidStorageKey,
  MAX_SIGNED_URL_TTL_SECONDS,
  StorageUnavailableError,
  type PutOptions,
  type StoredObject,
} from '../../../../domain/shared/storage';
import type { ServerStorageProvider } from './types';

/**
 * The real implementation behind the storage seam (docs/SEAMS.md): one private
 * bucket, `documents`, in the project named by SUPABASE_URL
 * (docs/COMPLIANCE/approved-vendors.md, docs/STAGING.md).
 *
 * Private, always: the bucket is never public, every fetch goes through a
 * short-lived signed URL, and the credential is the service key — never the
 * anon key, which the browser holds and which row security does not fence for
 * storage. Nothing here reaches the network until a call is made, so an
 * unreachable or misconfigured project cannot stop the API from starting; a
 * call then fails as StorageUnavailableError, which create-api.ts answers as
 * 503 `storage_unavailable`.
 *
 * The REST endpoints are used directly rather than the JavaScript client: this
 * is four calls, and the failure of each is ours to translate.
 */

export const DOCUMENTS_BUCKET = 'documents';

export type SupabaseStorageOptions = {
  /** The project's URL, https://<ref>.supabase.co. */
  url: string;
  /** The service credential (SUPABASE_STORAGE_KEY, or the project's service role key). */
  serviceKey: string;
  bucket?: string;
  /** Tests inject a fetch; the server uses the runtime's own. */
  fetchImpl?: typeof fetch;
  /** How long each call may take before it counts as unreachable. */
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 10_000;

export function supabaseStorage(options: SupabaseStorageOptions): ServerStorageProvider {
  const base = options.url.replace(/\/+$/, '');
  const bucket = options.bucket ?? DOCUMENTS_BUCKET;
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const headers = {
    apikey: options.serviceKey,
    authorization: `Bearer ${options.serviceKey}`,
  };

  /**
   * One call. Anything but a clean answer is an outage as far as the caller is
   * concerned.
   *
   * The credential goes on first and the call's own headers on top, in that
   * order and not the other way about: spreading `headers` after `init` threw
   * every per-call header away, so a `put` sent no content type and no upsert
   * decision and a `getSignedUrl` posted JSON labelled as text. No call here
   * sets `apikey` or `authorization`, so nothing can shed the credential this
   * way either.
   */
  async function call(
    path: string,
    init: RequestInit & { headers?: Record<string, string> },
  ): Promise<Response> {
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      return await doFetch(`${base}/storage/v1/${path}`, {
        ...init,
        headers: { ...headers, ...init.headers },
        signal,
      });
    } catch (error) {
      throw new StorageUnavailableError('The document store could not be reached.', {
        cause: error,
      });
    }
  }

  /** A refusal from the vendor. The body is not echoed: it can name the object. */
  function refused(response: Response, what: string): StorageUnavailableError {
    return new StorageUnavailableError(
      `The document store refused to ${what} (status ${response.status}).`,
    );
  }

  return {
    kind: 'supabase',

    async put(
      key: string,
      bytes: Uint8Array,
      mimeType: string,
      options: PutOptions = {},
    ): Promise<StoredObject> {
      assertValidStorageKey(key);
      // The default is no replacement: `x-upsert: false` and the vendor's own
      // 409 is the refusal, so the check and the write are one operation and
      // no window exists between them. A caller that means to replace an
      // object says so, and only then does the upsert header go true.
      const overwrite = options.overwrite === true;
      // Copied into a buffer of its own: the seam accepts any Uint8Array, and
      // fetch will only take one backed by a plain, unshared ArrayBuffer.
      const body = new Uint8Array(bytes.byteLength);
      body.set(bytes);
      const response = await call(`object/${bucket}/${key}`, {
        method: 'POST',
        body,
        headers: { 'content-type': mimeType, 'x-upsert': overwrite ? 'true' : 'false' },
      });
      if (!overwrite && response.status === 409) throw alreadyStored();
      if (!response.ok) throw refused(response, 'accept that document');
      return { sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.byteLength };
    },

    async getSignedUrl(key: string, ttlSeconds: number): Promise<string> {
      assertValidStorageKey(key);
      const expiresIn = Math.min(Math.max(1, Math.floor(ttlSeconds)), MAX_SIGNED_URL_TTL_SECONDS);
      const response = await call(`object/sign/${bucket}/${key}`, {
        method: 'POST',
        body: JSON.stringify({ expiresIn }),
        headers: { 'content-type': 'application/json' },
      });
      if (!response.ok) throw refused(response, 'sign a link to that document');
      const body = (await response.json().catch(() => ({}))) as { signedURL?: string };
      if (!body.signedURL) {
        throw new StorageUnavailableError('The document store signed no link.');
      }
      return `${base}/storage/v1${body.signedURL}`;
    },

    async delete(key: string): Promise<void> {
      assertValidStorageKey(key);
      const response = await call(`object/${bucket}/${key}`, { method: 'DELETE' });
      // Removing what is not there is not an error (domain/shared/storage.ts).
      if (!response.ok && response.status !== 404) {
        throw refused(response, 'remove that document');
      }
    },

    async exists(key: string): Promise<boolean> {
      assertValidStorageKey(key);
      const response = await call(`object/info/${bucket}/${key}`, { method: 'GET' });
      if (response.status === 404) return false;
      if (!response.ok) throw refused(response, 'look for that document');
      return true;
    },

    describe(): string {
      // The project's own URL only: never the key.
      return `Supabase Storage bucket "${bucket}" at ${base}`;
    },
  };
}
