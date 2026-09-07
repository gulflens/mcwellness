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

/** What a caller may say about a write. */
export type PutOptions = {
  /**
   * Whether bytes already at that key may be replaced. **False by default**,
   * on both implementations: a document is written once. The bytes behind a
   * filed consent, a signed report or a piece of consent wording are the
   * evidence of what a person was shown and agreed to, and a store that
   * quietly accepts a second write over the first is a store where that
   * evidence can be changed after the fact. A caller that genuinely means to
   * replace an object — a retry that knows the first attempt half-finished —
   * says `overwrite: true` and says it deliberately.
   */
  overwrite?: boolean;
};

export type StorageProvider = {
  /**
   * Writes bytes at a key and fingerprints them. Refuses a key that already
   * holds an object unless `overwrite` says otherwise: see PutOptions.
   */
  put(
    key: string,
    bytes: Uint8Array,
    mimeType: string,
    options?: PutOptions,
  ): Promise<StoredObject>;
  /**
   * The bytes at a key, or null when nothing is there.
   *
   * For the server that filed them, not for a person: handing somebody a
   * document is `getSignedUrl`, which is audited as the read it is
   * (docs/SEAMS.md). This is for the one case where the API itself needs the
   * bytes back — the practice's logo, read out of its own `document` row and
   * drawn onto every invoice it renders (docs/SPEC/billing.md section 5.6).
   *
   * Null is "nothing is stored there", which is an answer and not a fault; a
   * store that cannot be reached raises `StorageUnavailableError` exactly as
   * every other call here does, so a bucket that is down never reads as a bug
   * in the document that wanted the picture.
   */
  get(key: string): Promise<Uint8Array | null>;
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

/**
 * Something is already stored at that key and the caller did not ask to
 * replace it (`PutOptions.overwrite`). Not an outage — the store answered,
 * and its answer was no — so it is its own type and its own status: the API
 * (app/api/create-api.ts) answers **409 `document_exists`**, which a caller
 * can tell apart from a store that is down.
 */
export class StorageConflictError extends Error {
  /** Structural, for the same reason StorageUnavailableError carries one. */
  readonly storageConflict = true;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StorageConflictError';
  }
}

/**
 * The refusal both implementations give, worded once. The key is not echoed:
 * it names a document.
 */
export function alreadyStored(): StorageConflictError {
  return new StorageConflictError('Something is already stored under that key.');
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

/**
 * How long a practice document is kept: five years from upload
 * (`docs/SPEC/00-data-model.md` section 3 and section 7's retention rule,
 * `db/migrations/060_client.sql`). `document.retention_until` is computed by
 * the application at upload, so this is the arithmetic every stream calls
 * rather than one each.
 */
export const DOCUMENT_RETENTION_YEARS = 5;

/**
 * The kinds of document upload-dated retention does not fit. Both are practice
 * documents, neither is the practice's own paperwork, and both are kept for as
 * long as something still uses them rather than for five years from the day
 * the file arrived. Their `retention_until` is deliberately null, meaning "not
 * on an upload clock", never "forever by oversight".
 *
 * - **`consent_text`** (`db/migrations/903_document_write_guard.sql`): the
 *   text a person was shown. A consent recorded in year four of a wording's
 *   life would outlive the words it points at, so a wording is kept until no
 *   `consent` row references it and the last referencing client's own
 *   retention has expired.
 * - **`practice_logo`** (`db/migrations/909_practice_logo.sql`): the mark on
 *   the practice's own documents. There is one at a time and it is replaced
 *   rather than expired — the day it is replaced, the route that replaces it
 *   removes the old bytes — so a five-year clock started at upload would mark
 *   the practice's *current* logo for deletion while it is still the logo.
 *
 * A deletion job must therefore ask what still references a document before it
 * removes anything, which is the rule for both (`docs/SEAMS.md`).
 */
export const RETENTION_EXEMPT_KINDS: readonly string[] = ['consent_text', 'practice_logo'];

/**
 * When a document uploaded now stops being kept, or null when its kind is
 * exempt. Pure: the clock is an argument, never read in here.
 *
 * Note the shape of the answer. Null is not "no retention": it is "not this
 * rule's to decide", and a deletion job must check what still references the
 * row before it calls `storage.delete` (`docs/SEAMS.md`).
 */
export function documentRetentionUntil(kind: string, uploadedAt: Date): Date | null {
  if (RETENTION_EXEMPT_KINDS.includes(kind)) return null;
  const until = new Date(uploadedAt.getTime());
  until.setUTCFullYear(until.getUTCFullYear() + DOCUMENT_RETENTION_YEARS);
  return until;
}
