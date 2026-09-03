import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import type { ServerStorageProvider } from '../_middleware/storage';
import type { Db } from '../_middleware/request-context';
import { photoEvidenceToRemove, removePhotoBytes } from './withdrawal';

/**
 * The order a withdrawal does its two jobs in (./withdrawal.ts).
 *
 * Deleting bytes cannot be rolled back and a transaction can be, so every
 * database statement has to be finished before the first byte goes. The whole
 * of that rule is in the split — one function reads and audits, the other
 * deletes — so the test worth having is that the first one deletes nothing,
 * and that the second one cannot throw a completed withdrawal away.
 *
 * Against fakes rather than a database: the rule under test is the order of
 * two calls, not what either of them says to Postgres.
 */

const CLIENT_ID = '00000009-0000-4000-8000-000000000001';
const PHOTO_ONE = '00000009-0000-4000-8000-000000000002';
const PHOTO_TWO = '00000009-0000-4000-8000-000000000003';

type Answer = { rows: Record<string, unknown>[] };

/** A database that answers in the order the module asks, and remembers what it was asked. */
function fakeDb(answers: Answer[]): { db: Db; statements: string[] } {
  const statements: string[] = [];
  let next = 0;
  const db: Db = {
    query: async (text: string) => {
      statements.push(text);
      const answer = answers[next] ?? { rows: [] };
      next += 1;
      return answer as unknown as pg.QueryResult;
    },
  };
  return { db, statements };
}

function fakeStorage(failOn: string[] = []): {
  storage: ServerStorageProvider;
  deleted: string[];
} {
  const deleted: string[] = [];
  const storage = {
    delete: async (key: string) => {
      if (failOn.includes(key)) throw new Error('the store refused');
      deleted.push(key);
    },
  } as unknown as ServerStorageProvider;
  return { storage, deleted };
}

const NO_ACTIVE_CONSENT: Answer = { rows: [{ n: '0' }] };
const TWO_PHOTOS: Answer = {
  rows: [
    { id: PHOTO_ONE, storage_key: 'tenant/a/client/b/one' },
    { id: PHOTO_TWO, storage_key: 'tenant/a/client/b/two' },
  ],
};

describe('photoEvidenceToRemove', () => {
  it('writes the trail and removes nothing, so the transaction can still be taken back', async () => {
    const { db, statements } = fakeDb([NO_ACTIVE_CONSENT, TWO_PHOTOS, { rows: [] }, { rows: [] }]);
    const { storage, deleted } = fakeStorage();

    const found = await photoEvidenceToRemove(db, storage, CLIENT_ID);

    expect(found.keys).toEqual(['tenant/a/client/b/one', 'tenant/a/client/b/two']);
    expect(found.stillOnFile).toBe(0);
    // One audit row per photograph, before anything is deleted.
    expect(statements.filter((sql) => sql.startsWith('insert into audit_log'))).toHaveLength(2);
    expect(deleted).toEqual([]);
  });

  it('leaves the photographs alone while anyone is still giving that permission', async () => {
    const { db } = fakeDb([{ rows: [{ n: '1' }] }]);
    const { storage, deleted } = fakeStorage();
    const found = await photoEvidenceToRemove(db, storage, CLIENT_ID);
    expect(found).toEqual({ keys: [], stillOnFile: 0 });
    expect(deleted).toEqual([]);
  });

  it('says the photographs are still out there when there is no store to reach', async () => {
    const { db } = fakeDb([NO_ACTIVE_CONSENT, TWO_PHOTOS]);
    const found = await photoEvidenceToRemove(db, undefined, CLIENT_ID);
    expect(found).toEqual({ keys: [], stillOnFile: 2 });
  });
});

describe('removePhotoBytes', () => {
  it('removes every key and says how many went', async () => {
    const { storage, deleted } = fakeStorage();
    const removed = await removePhotoBytes(storage, ['one', 'two']);
    expect(removed).toBe(2);
    expect(deleted).toEqual(['one', 'two']);
  });

  it('never throws, so a store that refuses cannot undo the withdrawal', async () => {
    // A throw here would reach create-api's error handler as a 500, and
    // request-context rolls a 500 back: the consent would come back to life
    // with one photograph already gone.
    const { storage, deleted } = fakeStorage(['two']);
    const removed = await removePhotoBytes(storage, ['one', 'two', 'three']);
    expect(removed).toBe(2);
    expect(deleted).toEqual(['one', 'three']);
  });
});
