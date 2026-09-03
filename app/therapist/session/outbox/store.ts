/**
 * The device's own store for a visit in progress (docs/SPEC/session-capture.md
 * sections 2 and 7): an append-only queue of events, plus one note of which
 * visit is open so a reload can offer to resume it.
 *
 * IndexedDB "through a thin wrapper", as section 7 asks — thin enough that
 * the interesting behaviour (ordering, retry, acknowledgement) lives in
 * ./outbox.ts and is testable without a browser, and thin enough that the
 * second implementation below is a genuine equal rather than a stub.
 *
 * There are two implementations on purpose:
 *
 * - **IndexedDbStore**, which is what a phone uses and what survives the app
 *   being force-quit or the battery running out.
 * - **MemoryStore**, for a browser with no IndexedDB at all — a private
 *   window with storage blocked, an embedded web view, or a test in jsdom.
 *   A visit still runs; it simply does not survive a reload, and the screen
 *   says so rather than pretending otherwise.
 *
 * Nothing here holds a name, a record number or an address. The queue holds
 * event payloads (ratings, telemetry, observation chips) and the open-visit
 * note holds the same short label the screen already shows — a given name
 * and an initial — because that is what "resume session for Client L." needs
 * and no more.
 */

export type OutboxRecord = {
  /** The event's own client-generated id: the primary key here and the idempotency key at the server. */
  id: string;
  sessionId: string;
  seq: number;
  kind: string;
  deviceAt: string;
  payload: unknown;
};

/** What a reload needs to offer "resume session for Client L., started 14:32". */
export type OpenVisitNote = {
  sessionId: string;
  clientLabel: string;
  serviceTypeId: string;
  checkedInAt: string;
  number: number;
  of: number | null;
};

export type OutboxStore = {
  /** Durable across a reload? False for the memory fallback, and the screen says so. */
  readonly durable: boolean;
  append(record: OutboxRecord): Promise<void>;
  /** Everything still waiting, oldest first by session then seq. */
  pending(): Promise<OutboxRecord[]>;
  /** Acknowledged or refused: either way the device is done with them. */
  forget(ids: readonly string[]): Promise<void>;
  readOpenVisit(): Promise<OpenVisitNote | null>;
  writeOpenVisit(note: OpenVisitNote | null): Promise<void>;
};

const DB_NAME = 'mcwellness-session';
const DB_VERSION = 1;
const EVENTS = 'events';
const META = 'meta';
const OPEN_VISIT_KEY = 'open-visit';

function byOrder(a: OutboxRecord, b: OutboxRecord): number {
  if (a.sessionId !== b.sessionId) return a.sessionId < b.sessionId ? -1 : 1;
  if (a.seq !== b.seq) return a.seq - b.seq;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** The fallback: correct, in order, and gone when the tab is. */
export function createMemoryStore(): OutboxStore {
  const records = new Map<string, OutboxRecord>();
  let openVisit: OpenVisitNote | null = null;
  return {
    durable: false,
    append: async (record) => {
      // Append-only: an id already queued is the same event, never a change.
      if (!records.has(record.id)) records.set(record.id, record);
    },
    pending: async () => [...records.values()].sort(byOrder),
    forget: async (ids) => {
      for (const id of ids) records.delete(id);
    },
    readOpenVisit: async () => openVisit,
    writeOpenVisit: async (note) => {
      openVisit = note;
    },
  };
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(EVENTS)) db.createObjectStore(EVENTS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB could not be opened'));
    request.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
  });
}

function createIndexedDbStore(db: IDBDatabase): OutboxStore {
  const run = <T>(
    storeName: string,
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const transaction = db.transaction(storeName, mode);
    const result = promisify(work(transaction.objectStore(storeName)));
    return new Promise<T>((resolve, reject) => {
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB write failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB write aborted'));
      transaction.oncomplete = () => {
        result.then(resolve, reject);
      };
    });
  };

  return {
    durable: true,
    // `add`, not `put`: a queue that is append-only in the schema is one
    // fewer thing to reason about than one that is append-only by habit.
    // An id already stored is the same event, and its ConstraintError is
    // swallowed here rather than surfaced as a failure.
    append: async (record) => {
      try {
        await run(EVENTS, 'readwrite', (store) => store.add(record));
      } catch (error) {
        if ((error as DOMException)?.name !== 'ConstraintError') throw error;
      }
    },
    pending: async () => {
      const all = await run<OutboxRecord[]>(EVENTS, 'readonly', (store) => store.getAll());
      return all.sort(byOrder);
    },
    forget: async (ids) => {
      if (ids.length === 0) return;
      const transaction = db.transaction(EVENTS, 'readwrite');
      const store = transaction.objectStore(EVENTS);
      for (const id of ids) store.delete(id);
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () =>
          reject(transaction.error ?? new Error('IndexedDB delete failed'));
        transaction.onabort = () =>
          reject(transaction.error ?? new Error('IndexedDB delete aborted'));
      });
    },
    readOpenVisit: async () => {
      const note = await run<OpenVisitNote | undefined>(META, 'readonly', (store) =>
        store.get(OPEN_VISIT_KEY),
      );
      return note ?? null;
    },
    writeOpenVisit: async (note) => {
      // Written as two calls rather than one conditional expression: `delete`
      // and `put` return differently typed requests, and a union of the two
      // is a type puzzle with nothing behind it.
      if (note === null) {
        await run<undefined>(META, 'readwrite', (store) => store.delete(OPEN_VISIT_KEY));
        return;
      }
      await run<IDBValidKey>(META, 'readwrite', (store) => store.put(note, OPEN_VISIT_KEY));
    },
  };
}

/**
 * The store this device can actually use. IndexedDB when the browser has it
 * and will open it; the in-memory queue when it does not — a refusal to open
 * a database is not a reason to refuse to run a visit.
 */
export async function createOutboxStore(): Promise<OutboxStore> {
  if (typeof indexedDB === 'undefined') return createMemoryStore();
  try {
    return createIndexedDbStore(await openDatabase());
  } catch {
    return createMemoryStore();
  }
}

/**
 * Asks the browser to keep this origin's storage rather than evicting it
 * under pressure (section 7). Best effort by definition: a browser may
 * decline, and a decline is not an error worth showing anybody.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
  if (!storage?.persist) return false;
  try {
    return await storage.persist();
  } catch {
    return false;
  }
}
