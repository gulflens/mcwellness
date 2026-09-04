import { describe, expect, it } from 'vitest';
import {
  alreadyStored,
  assertValidStorageKey,
  clientDocumentKey,
  documentRetentionUntil,
  DOCUMENT_RETENTION_YEARS,
  isValidStorageKey,
  practiceDocumentKey,
  StorageConflictError,
  StorageUnavailableError,
} from './storage';

const TENANT = '00000000-0000-4000-8000-00000000000a';
const CLIENT = '00000000-0000-4000-8000-0000000000c1';
const DOCUMENT = '00000000-0000-4000-8000-0000000000f1';

const REFUSED_KEYS = [
  '',
  '..',
  '../secrets',
  'tenant/../../etc/passwd',
  '/tenant/a',
  'tenant//a',
  'tenant/a/',
  'tenant/./a',
  'tenant\\a',
  'tenant/a%2f..%2fb',
  'tenant/a b',
  'tenant/a\tb',
  'tenant/a\u0000b',
  '.hidden',
  '-leading-dash',
  `a/${'b'.repeat(512)}`,
];

describe('storage keys', () => {
  it('names a client document and a practice document by id alone', () => {
    expect(clientDocumentKey(TENANT, CLIENT, DOCUMENT)).toBe(
      `tenant/${TENANT}/client/${CLIENT}/${DOCUMENT}`,
    );
    expect(practiceDocumentKey(TENANT, DOCUMENT)).toBe(`tenant/${TENANT}/practice/${DOCUMENT}`);
  });

  it('accepts an ordinary key', () => {
    expect(isValidStorageKey('tenant/a/practice/b')).toBe(true);
    expect(isValidStorageKey('consent-text/participation.en.v0_1-draft.md')).toBe(true);
  });

  it('refuses a key that could climb out of the folder or mean something else to a bucket', () => {
    for (const key of REFUSED_KEYS) {
      expect(isValidStorageKey(key)).toBe(false);
      expect(() => assertValidStorageKey(key)).toThrow('not a valid one');
    }
  });

  it('never echoes the key it refused', () => {
    let message = '';
    try {
      assertValidStorageKey('tenant/../secret-report');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe('That storage key is not a valid one.');
  });
});

describe('StorageUnavailableError', () => {
  it('is recognisable by name and by class, and keeps its cause', () => {
    const cause = new Error('connect ECONNREFUSED');
    const error = new StorageUnavailableError('The document store is unavailable.', { cause });

    expect(error).toBeInstanceOf(StorageUnavailableError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('StorageUnavailableError');
    expect(error.cause).toBe(cause);
  });
});

describe('StorageConflictError', () => {
  it('is its own type, so an outage and a refusal are never the same answer', () => {
    const error = alreadyStored();

    expect(error).toBeInstanceOf(StorageConflictError);
    expect(error).not.toBeInstanceOf(StorageUnavailableError);
    expect(error.name).toBe('StorageConflictError');
  });

  it('names no key: a key names a document', () => {
    expect(alreadyStored().message).toBe('Something is already stored under that key.');
  });
});

describe('how long a document is kept', () => {
  const UPLOADED = new Date('2026-09-03T08:30:00.000Z');

  it('gives a practice document five years from its upload, not from now', () => {
    const until = documentRetentionUntil('certificate', UPLOADED);

    expect(DOCUMENT_RETENTION_YEARS).toBe(5);
    expect(until?.toISOString()).toBe('2031-09-03T08:30:00.000Z');
    // Pure: the clock is an argument, so the same upload always answers the same.
    expect(documentRetentionUntil('report', UPLOADED)?.toISOString()).toBe(until?.toISOString());
    // And the date handed in is left as it was found.
    expect(UPLOADED.toISOString()).toBe('2026-09-03T08:30:00.000Z');
  });

  it('leaves a leap day on a real date rather than inventing the 29th', () => {
    // 2028 is a leap year, 2033 is not: 29 February + five years is 1 March.
    const until = documentRetentionUntil('report', new Date('2028-02-29T00:00:00.000Z'));

    expect(until?.toISOString()).toBe('2033-03-01T00:00:00.000Z');
  });

  it('puts consent wording on no clock at all, and says so with null', () => {
    // Not "forever by oversight": kept while a consent still points at it
    // (migration 903, docs/SEAMS.md), which is a question about references
    // rather than about a date, so no date is the honest answer.
    expect(documentRetentionUntil('consent_text', UPLOADED)).toBeNull();
  });

  it('puts the practice logo on no clock either', () => {
    // There is one at a time and it is replaced rather than expired
    // (migration 909): a five-year clock started at upload would mark the
    // practice's current logo for deletion while it is still the logo, and
    // every document the practice issues would lose its mark on the same day.
    expect(documentRetentionUntil('practice_logo', UPLOADED)).toBeNull();
  });
});
