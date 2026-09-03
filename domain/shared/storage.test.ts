import { describe, expect, it } from 'vitest';
import {
  assertValidStorageKey,
  clientDocumentKey,
  isValidStorageKey,
  practiceDocumentKey,
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
