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
 * What it holds is still personal data: the open-visit note carries a given
 * name and an initial, and the queue carries ratings, observation chips and
 * whatever the practitioner typed in the note beside them. So it is not left
 * lying about:
 *
 * - **Signing out empties it** (`forgetEverything`), the photographs included:
 *   a practitioner who signs out on a shared phone leaves nothing of the
 *   household behind, and a picture of a child's head is the last thing that
 *   should outlive a session.
 * - **A different person signing in empties it** (`claim`). The store records
 *   whose it is; a store claimed by somebody else is wiped before it is used,
 *   so a sign-out that never happened cannot leak into the next session.
 * - **Anything older than a week goes** (`PRUNE_AFTER_DAYS`). An event that
 *   has not reached the server in seven days is not going to, and keeping it
 *   is keeping a client's session on a device for no reason.
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

/**
 * The setup photograph's bytes, waiting for the event that names them to be
 * acknowledged (docs/SPEC/practitioner-phone.md section 4.2).
 *
 * Keyed by session id, because `session.setup_photo_document_id` is singular:
 * one photograph per visit. A retake before check-out replaces this record and
 * appends a new event, and the projection's `photo` is already the last
 * event's payload, so the server and the device agree about which picture is
 * the one.
 */
export type OutboxBlob = {
  sessionId: string;
  bytes: Blob;
  mimeType: string;
  sha256: string;
  /** The device clock that wrote it, so a blob is pruned on the same rule an event is. */
  deviceAt: string;
};

/** What a reload needs to offer "resume session for Client L., started 14:32". */
export type OpenVisitNote = {
  sessionId: string;
  clientLabel: string;
  serviceTypeId: string;
  checkedInAt: string;
  number: number;
  of: number | null;
  /**
   * The highest seq this device has ever written for this visit. Kept here,
   * and updated as events are written, because a resume with no signal
   * cannot ask the server where it got to — and picking up at zero would
   * mean every event of the second half claiming a position the first half
   * already has.
   */
  lastSeq: number;
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
  /**
   * The photograph waiting for this visit, replacing whatever was there: a
   * retake is one picture, not two.
   */
  putBlob(blob: OutboxBlob): Promise<void>;
  /** Every photograph still waiting, oldest first by session. */
  blobs(): Promise<OutboxBlob[]>;
  /** Acknowledged, or refused in a way that will not change: either way it goes. */
  forgetBlob(sessionId: string): Promise<void>;
  /** Every queued event and the open-visit note, gone. Sign-out, and a store claimed by somebody else. */
  forgetEverything(): Promise<void>;
  /**
   * Records whose store this is, wiping it first if it belonged to anybody
   * else. Returns whether it wiped, so a screen can say what happened.
   */
  claim(userId: string): Promise<boolean>;
  /** Drops queued events older than `days`. Returns how many went. */
  prune(days: number, now: Date): Promise<number>;
};

/**
 * A week. Long enough that a practitioner on leave with a phone in a drawer
 * still delivers a visit when they come back; short enough that a household's
 * session is not sitting on a device a month later.
 */
export const PRUNE_AFTER_DAYS = 7;

const DB_NAME = 'mcwellness-session';
/**
 * Two, from one: version 2 adds the `blobs` store beside the events
 * (docs/SPEC/practitioner-phone.md section 4.2). A device that has run this
 * app before opens at version 1 and is upgraded in place, keeping whatever
 * events it was holding — an upgrade that dropped the queue would lose a
 * visit somebody ran in a basement.
 */
const DB_VERSION = 2;
const EVENTS = 'events';
const BLOBS = 'blobs';
const META = 'meta';
const OPEN_VISIT_KEY = 'open-visit';
const OWNER_KEY = 'owner';

function byOrder(a: OutboxRecord, b: OutboxRecord): number {
  if (a.sessionId !== b.sessionId) return a.sessionId < b.sessionId ? -1 : 1;
  if (a.seq !== b.seq) return a.seq - b.seq;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** How old a queued event or photograph is, judged on the device clock that wrote it. */
function ageInDays(record: { deviceAt: string }, now: Date): number {
  const at = Date.parse(record.deviceAt);
  if (!Number.isFinite(at)) return Number.POSITIVE_INFINITY;
  return (now.getTime() - at) / 86_400_000;
}

/** The fallback: correct, in order, and gone when the tab is. */
export function createMemoryStore(): OutboxStore {
  const records = new Map<string, OutboxRecord>();
  const pictures = new Map<string, OutboxBlob>();
  let openVisit: OpenVisitNote | null = null;
  let owner: string | null = null;
  const store: OutboxStore = {
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
    putBlob: async (blob) => {
      // Replaced, not appended: one photograph per visit, and a retake is the
      // one that counts.
      pictures.set(blob.sessionId, blob);
    },
    blobs: async () =>
      [...pictures.values()].sort((a, b) => a.sessionId.localeCompare(b.sessionId)),
    forgetBlob: async (sessionId) => {
      pictures.delete(sessionId);
    },
    forgetEverything: async () => {
      records.clear();
      pictures.clear();
      openVisit = null;
      owner = null;
    },
    claim: async (userId) => {
      if (owner !== null && owner === userId) return false;
      const wiped = owner !== null;
      if (wiped) await store.forgetEverything();
      owner = userId;
      return wiped;
    },
    prune: async (days, now) => {
      const stale = [...records.values()].filter((record) => ageInDays(record, now) > days);
      for (const record of stale) records.delete(record.id);
      // A photograph goes with the events, on the same clock and for the same
      // reason: a picture that has not reached the server in seven days is not
      // going to, and keeping it is keeping a child's head on a device.
      for (const [sessionId, blob] of pictures) {
        if (ageInDays(blob, now) > days) pictures.delete(sessionId);
      }
      return stale.length;
    },
  };
  return store;
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
      // One record per visit, keyed by the session it belongs to.
      if (!db.objectStoreNames.contains(BLOBS)) {
        db.createObjectStore(BLOBS, { keyPath: 'sessionId' });
      }
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
    putBlob: async (blob) => {
      // `put`, not `add`: a retake before check-out replaces the picture.
      await run<IDBValidKey>(BLOBS, 'readwrite', (store) => store.put(blob));
    },
    blobs: async () => {
      const all = await run<OutboxBlob[]>(BLOBS, 'readonly', (store) => store.getAll());
      return all.sort((a, b) => a.sessionId.localeCompare(b.sessionId));
    },
    forgetBlob: async (sessionId) => {
      await run<undefined>(BLOBS, 'readwrite', (store) => store.delete(sessionId));
    },
    forgetEverything: async () => {
      await run<undefined>(EVENTS, 'readwrite', (store) => store.clear());
      await run<undefined>(BLOBS, 'readwrite', (store) => store.clear());
      await run<undefined>(META, 'readwrite', (store) => store.clear());
    },
    claim: async (userId) => {
      const current = await run<string | undefined>(META, 'readonly', (store) =>
        store.get(OWNER_KEY),
      );
      if (current === userId) return false;
      const wiped = current !== undefined;
      if (wiped) {
        await run<undefined>(EVENTS, 'readwrite', (store) => store.clear());
        await run<undefined>(BLOBS, 'readwrite', (store) => store.clear());
        await run<undefined>(META, 'readwrite', (store) => store.clear());
      }
      await run<IDBValidKey>(META, 'readwrite', (store) => store.put(userId, OWNER_KEY));
      return wiped;
    },
    prune: async (days, now) => {
      // The photographs go on the same clock as the events, and first: a
      // picture is the larger thing to be holding on to.
      const pictures = await run<OutboxBlob[]>(BLOBS, 'readonly', (store) => store.getAll());
      for (const blob of pictures) {
        if (ageInDays(blob, now) > days) {
          await run<undefined>(BLOBS, 'readwrite', (store) => store.delete(blob.sessionId));
        }
      }
      const all = await run<OutboxRecord[]>(EVENTS, 'readonly', (store) => store.getAll());
      const stale = all.filter((record) => ageInDays(record, now) > days);
      if (stale.length === 0) return 0;
      const transaction = db.transaction(EVENTS, 'readwrite');
      const events = transaction.objectStore(EVENTS);
      for (const record of stale) events.delete(record.id);
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () =>
          reject(transaction.error ?? new Error('IndexedDB prune failed'));
        transaction.onabort = () =>
          reject(transaction.error ?? new Error('IndexedDB prune aborted'));
      });
      return stale.length;
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
 * Everything this device holds for this practitioner, gone: both object
 * stores, without an Outbox and without a visit in progress.
 *
 * Separate from `OutboxStore.forgetEverything` on purpose. That one empties a
 * store somebody is already holding; this one is for the moment nobody is —
 * a practitioner signing out from a screen that never opened a store at all.
 * It opens the database only if there is one to open, and a browser that
 * refuses is a browser with nothing stored to clear.
 */
export async function forgetDevice(
  /** Injected in tests, where IndexedDB does not exist. */
  createStore: () => Promise<OutboxStore> = createOutboxStore,
): Promise<void> {
  const store = await createStore();
  await store.forgetEverything();
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
