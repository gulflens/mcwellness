import type { StorageProvider } from '../../domain/shared/storage';
import { isLocalDatabaseUrl } from '../runner/plan';
import type { SeedClient } from './apply';
import { CONSENT_TEXT_MIME_TYPE, loadConsentTexts, type ConsentText } from './consent-text';

/**
 * The consent wording's bytes, put into whichever store the storage seam is
 * pointed at (docs/SEAMS.md, docs/STAGING.md section 5a).
 *
 * The seed writes a `document` row for each wording file and files the bytes
 * in the local folder and nowhere else, deliberately: it holds no storage
 * credential and never reaches a bucket. So a hosted project seeded from a
 * rendered script has eight rows naming eight keys with nothing behind them,
 * and anyone opening a consent sees nothing. This is the step that fills them,
 * run once by the owner after the bucket exists.
 *
 * **The row is the truth.** A file whose sha256 differs from the row that
 * points at it is refused rather than uploaded: the row is what a recorded
 * consent points at, and a wording whose bytes no longer match the fingerprint
 * a person signed against is a different text. Editing a wording is a new
 * version and a new row (docs/CONSENT/README.md), never new bytes at an old
 * key — which is also why nothing here ever overwrites: `exists` first, and
 * `overwrite: false` under it, so two runs of this are one upload.
 *
 * Pure of the environment: the connection, the store and the practice are
 * arguments, so the same function serves the command line and the tests.
 */

/** What happened to one file. Nothing else can happen: every branch below is one of these. */
export type WordingOutcome = 'uploaded' | 'already present' | 'hash mismatch' | 'no row';

export type WordingResult = {
  /** The file in docs/CONSENT, which is the thing the operator can act on. */
  file: string;
  /** Where its bytes belong, or null when no row claims this file. */
  storageKey: string | null;
  size: number;
  outcome: WordingOutcome;
};

/**
 * Where the wording may be filed: the fallback implementation only ever fills a
 * folder on this machine, so pointing it at a database that is not on this
 * machine would report eight uploads and leave a hosted project's rows pointing
 * at nothing — the exact failure this command exists to end. Returns the
 * refusal, or null, the way seedTargetError does for the seed itself.
 */
export function wordingTargetError(storageKind: string, databaseUrl: string): string | null {
  if (storageKind === 'local' && !isLocalDatabaseUrl(databaseUrl)) {
    return (
      'The document store is a folder on this machine and the database is not: the files would go ' +
      'into that folder while the rows point at a bucket nobody filled. Set STORAGE_PROVIDER=supabase ' +
      'and SUPABASE_STORAGE_KEY (a service key, never the anon key) in the environment file given to ' +
      'this command.'
    );
  }
  return null;
}

/** The outcomes that mean the store is not what the rows say it is. */
export function isWordingRefusal(outcome: WordingOutcome): boolean {
  return outcome === 'hash mismatch' || outcome === 'no row';
}

type WordingRow = {
  purpose: string;
  locale: string;
  version: string;
  storage_key: string;
  sha256: string | null;
};

export async function uploadConsentWording(options: {
  client: SeedClient;
  storage: StorageProvider;
  /** The practice whose wording rows these are. */
  tenantId: string;
  /** The files. Read from docs/CONSENT unless a test hands its own in. */
  texts?: ConsentText[];
}): Promise<WordingResult[]> {
  const texts = options.texts ?? loadConsentTexts();
  const { rows } = await options.client.query<WordingRow>(
    "select purpose, locale, version, storage_key, encode(sha256, 'hex') as sha256 " +
      "from document where tenant_id = $1 and kind = 'consent_text'",
    [options.tenantId],
  );

  const results: WordingResult[] = [];
  for (const text of texts) {
    const size = text.bytes.byteLength;
    // Purpose, language and version together: a wording exists once at that
    // identity (migration 902), and a second version of the same purpose is a
    // different document with a key of its own.
    const row = rows.find(
      (r) => r.purpose === text.purpose && r.locale === text.locale && r.version === text.version,
    );
    if (row === undefined) {
      results.push({ file: text.file, storageKey: null, size, outcome: 'no row' });
      continue;
    }
    if (row.sha256 !== text.sha256Hex) {
      results.push({
        file: text.file,
        storageKey: row.storage_key,
        size,
        outcome: 'hash mismatch',
      });
      continue;
    }
    if (await options.storage.exists(row.storage_key)) {
      results.push({
        file: text.file,
        storageKey: row.storage_key,
        size,
        outcome: 'already present',
      });
      continue;
    }
    const stored = await options.storage.put(row.storage_key, text.bytes, CONSENT_TEXT_MIME_TYPE, {
      overwrite: false,
    });
    if (stored.sha256 !== text.sha256Hex) {
      // The bytes that arrived are not the bytes that left. Nothing else is
      // uploaded after that: the store is not doing what it says.
      throw new Error(`${text.file} changed while it was being filed; nothing further was sent.`);
    }
    results.push({ file: text.file, storageKey: row.storage_key, size, outcome: 'uploaded' });
  }
  return results;
}

/** One line per file, in the order the files were read. */
export function describeWordingResult(result: WordingResult): string {
  const key = result.storageKey ?? 'no key';
  return `${result.file}  ${key}  ${result.size} bytes  ${result.outcome}`;
}
