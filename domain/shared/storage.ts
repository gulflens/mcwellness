/**
 * The storage seam (CLAUDE.md rule on external capabilities, docs/SEAMS.md).
 *
 * Files the practice holds — a signed consent, a referral letter, a report, a
 * practitioner's certificate — live outside Postgres. Every one of them is a
 * `document` row (docs/SPEC/00-data-model.md section 3) whose `storage_key`
 * names the bytes; this file declares the one interface that puts, fetches,
 * checks and removes them, so no route, job or seed ever talks to a storage
 * vendor directly.
 *
 * Browser-safe: types, pure key helpers and one error class. Nothing here
 * imports a Node built-in or a vendor SDK — the implementations live under
 * app/api/_middleware/storage and are server-only.
 *
 * A key is an opaque path the caller chooses, from the two conventions below.
 * It is never derived from a person's name or record number: an id, and only
 * an id, so a leaked key says nothing about whose file it is.
 */

/** What a provider reports back after writing bytes. */
export type StoredObject = {
  /** Lowercase hexadecimal sha256 of the bytes as written, for `document.sha256`. */
  sha256: string;
  /** Bytes written. */
  size: number;
};

export type StorageProvider = {
  /** Writes bytes at a key, replacing whatever was there, and fingerprints them. */
  put(key: string, bytes: Uint8Array, mimeType: string): Promise<StoredObject>;
  /** A URL that fetches those bytes without a session, good for `ttlSeconds` and no longer. */
  getSignedUrl(key: string, ttlSeconds: number): Promise<string>;
  /** Removes the object. Removing what is not there is not an error. */
  delete(key: string): Promise<void>;
  /** Whether an object exists at that key. */
  exists(key: string): Promise<boolean>;
};

/**
 * The storage vendor could not be reached, or refused. Thrown by an
 * implementation and turned into a 503 `storage_unavailable` by the API
 * (app/api/create-api.ts), so a bucket that is down never reads as a bug in
 * the record it belongs to.
 */
export class StorageUnavailableError extends Error {
  /**
   * Distinguishes it from a plain Error structurally, not only by class: with
   * no member of its own the two types are identical to TypeScript, and
   * narrowing one away from the other leaves nothing behind.
   */
  readonly storageUnavailable = true;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StorageUnavailableError';
  }
}

/** How long a signed URL should live by default: long enough to fetch, short enough to leak harmlessly. */
export const DEFAULT_SIGNED_URL_TTL_SECONDS = 300;
/** The longest any signed URL may live, whichever provider signs it. */
export const MAX_SIGNED_URL_TTL_SECONDS = 3600;

/** A key segment: lowercase letters, digits, dots, dashes and underscores, never empty. */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_KEY_LENGTH = 512;

/**
 * Whether a key is one this platform will accept. Deliberately strict: no
 * leading slash, no empty segment, no `.` or `..`, no backslash, no control
 * character and no percent-encoding, so a key can never climb out of a
 * folder on the local implementation nor mean something else to a bucket.
 */
export function isValidStorageKey(key: string): boolean {
  if (key.length === 0 || key.length > MAX_KEY_LENGTH) return false;
  const segments = key.split('/');
  return segments.every((segment) => segment !== '.' && segment !== '..' && SEGMENT.test(segment));
}

/** The same check, as a refusal, for the implementations and the routes. */
export function assertValidStorageKey(key: string): void {
  if (!isValidStorageKey(key)) {
    // The key itself is not echoed: it names a document, and a refusal is not the place for it.
    throw new Error('That storage key is not a valid one.');
  }
}

/** `tenant/<tenantId>/client/<clientId>/<documentId>` — anything filed against a client. */
export function clientDocumentKey(tenantId: string, clientId: string, documentId: string): string {
  const key = `tenant/${tenantId}/client/${clientId}/${documentId}`;
  assertValidStorageKey(key);
  return key;
}

/** `tenant/<tenantId>/practice/<documentId>` — a document with no client: consent wording, a certificate. */
export function practiceDocumentKey(tenantId: string, documentId: string): string {
  const key = `tenant/${tenantId}/practice/${documentId}`;
  assertValidStorageKey(key);
  return key;
}
