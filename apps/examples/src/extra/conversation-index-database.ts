import type {
  WrappedConversationIndexEntry,
  WrappedConversationIndexListOptions,
  WrappedConversationIndexStore,
} from "applesauce-extra/messages";
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

/** The number of entries read per IndexedDB transaction while listing */
const BATCH_SIZE = 50;

interface ConversationIndexSchema extends DBSchema {
  conversations: {
    key: string;
    value: WrappedConversationIndexEntry;
    // The id breaks timestamp ties so every entry has a unique position to resume from
    indexes: { activity: [number, string] };
  };
}

/** A wrapped conversation index in IndexedDB with one record per conversation, paged by newest activity */
export class ConversationIndexDatabase implements WrappedConversationIndexStore {
  private constructor(private readonly db: IDBPDatabase<ConversationIndexSchema>) {}

  /** Opens or creates a conversation index database with the given IndexedDB name */
  static async open(name: string): Promise<ConversationIndexDatabase> {
    const db = await openDB<ConversationIndexSchema>(name, 1, {
      upgrade(db) {
        const conversations = db.createObjectStore("conversations", { keyPath: "id" });
        conversations.createIndex("activity", ["lastActivity", "id"]);
      },
    });

    return new ConversationIndexDatabase(db);
  }

  /** Closes the underlying IndexedDB connection */
  close() {
    this.db.close();
  }

  get(id: string) {
    return this.db.get("conversations", id);
  }

  async set(entry: WrappedConversationIndexEntry) {
    await this.db.put("conversations", entry);
  }

  /** Lists entries newest first in batches, since a transaction closes while the caller awaits other work */
  async *list(options: WrappedConversationIndexListOptions = {}) {
    // Arrays sort after strings, so [until, []] includes every id at the until timestamp
    let range = options.until === undefined ? undefined : IDBKeyRange.upperBound([options.until, []]);

    while (true) {
      const batch = await this.readBatch(range);
      yield* batch;
      if (batch.length < BATCH_SIZE) return;

      const last = batch[batch.length - 1];
      range = IDBKeyRange.upperBound([last.lastActivity, last.id], true);
    }
  }

  private async readBatch(range?: IDBKeyRange) {
    const transaction = this.db.transaction("conversations");
    const entries: WrappedConversationIndexEntry[] = [];
    let cursor = await transaction.store.index("activity").openCursor(range, "prev");

    while (cursor) {
      entries.push(cursor.value);
      if (entries.length === BATCH_SIZE) break;

      cursor = await cursor.continue();
    }

    return entries;
  }
}
