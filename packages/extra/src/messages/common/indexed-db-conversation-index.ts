import type { ConversationIndexEntry, ConversationIndexListOptions, ConversationIndexStore } from "./types.js";

const STORE_NAME = "conversations";
const ACTIVITY_INDEX = "activity";
const DB_VERSION = 1;

/** The number of entries read per IndexedDB transaction while listing */
const BATCH_SIZE = 50;

/** Resolves with the result of an IndexedDB request */
function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** A browser conversation index in IndexedDB with one record per conversation, paged by newest activity */
export class IndexedDBConversationIndexStore implements ConversationIndexStore {
  private constructor(private readonly db: IDBDatabase) {}

  /**
   * Opens or creates a conversation index database with the given IndexedDB name
   * @throws if IndexedDB is unavailable or the database cannot be opened
   */
  static async open(name: string): Promise<IndexedDBConversationIndexStore> {
    if (typeof indexedDB === "undefined") throw new Error("IndexedDB is not available");

    const request = indexedDB.open(name, DB_VERSION);
    request.onupgradeneeded = () => {
      const conversations = request.result.createObjectStore(STORE_NAME, { keyPath: "id" });

      // The id breaks timestamp ties so every entry has a unique position to resume from
      conversations.createIndex(ACTIVITY_INDEX, ["lastActivity", "id"]);
    };

    const db = await requestResult(request);
    return new IndexedDBConversationIndexStore(db);
  }

  /** Closes the underlying IndexedDB connection */
  close(): void {
    this.db.close();
  }

  /** Returns one conversation entry */
  get(id: string): Promise<ConversationIndexEntry | undefined> {
    const store = this.db.transaction(STORE_NAME).objectStore(STORE_NAME);
    return requestResult<ConversationIndexEntry | undefined>(store.get(id));
  }

  /**
   * Replaces one conversation entry
   * @throws if the entry cannot be persisted
   */
  async set(entry: ConversationIndexEntry): Promise<void> {
    const transaction = this.db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(entry);

    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error("Conversation index write was aborted"));
    });
  }

  /** Iterates entries newest activity first, reading in batches so callers can await other work between entries */
  async *list(options: ConversationIndexListOptions = {}): AsyncGenerator<ConversationIndexEntry> {
    // Arrays sort after strings, so [until, []] includes every id at the until timestamp
    let range = options.until === undefined ? undefined : IDBKeyRange.upperBound([options.until, []]);

    while (true) {
      const batch = await this.readBatch(range);
      yield* batch;
      if (batch.length < BATCH_SIZE) return;

      // A transaction closes while the caller awaits, so the next batch resumes after the last entry
      const last = batch[batch.length - 1];
      range = IDBKeyRange.upperBound([last.lastActivity, last.id], true);
    }
  }

  private readBatch(range?: IDBKeyRange): Promise<ConversationIndexEntry[]> {
    const index = this.db.transaction(STORE_NAME).objectStore(STORE_NAME).index(ACTIVITY_INDEX);
    const request = index.openCursor(range, "prev");
    const entries: ConversationIndexEntry[] = [];

    return new Promise((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return resolve(entries);

        entries.push(cursor.value);
        if (entries.length === BATCH_SIZE) return resolve(entries);

        cursor.continue();
      };
    });
  }
}
