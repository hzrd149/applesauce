import type { IAsyncEventDatabase, SyncPair } from "applesauce-core/event-store";
import {
  createReplaceableAddress,
  getIndexableTags,
  getReplaceableAddress,
  matchFilter,
  type Filter,
  type Rumor,
} from "applesauce-core/helpers";
import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from "idb";
import type SecureStorage from "./encrypted-storage";
import type { EncryptedValue } from "./encrypted-storage";

/** The methods the rumor database uses to encrypt rumors at rest */
export type RumorCipher = Pick<SecureStorage, "encrypt" | "decrypt">;

/** A stored rumor whose metadata stays queryable while its JSON is encrypted */
type RumorRecord = {
  id: string;
  kind: number;
  pubkey: string;
  created_at: number;
  /** Single-letter tags as "name:value", matching getIndexableTags */
  tags: string[];
  /** The replaceable address for replaceable and addressable kinds */
  address?: string;
  /** The encrypted rumor JSON */
  payload: EncryptedValue;
};

interface RumorSchema extends DBSchema {
  rumors: {
    key: string;
    value: RumorRecord;
    indexes: {
      kind: number;
      pubkey: string;
      created_at: number;
      tags: string;
      address: string;
    };
  };
}

type RumorStoreName = "rumors";
type RumorTransaction = IDBPTransaction<RumorSchema, [RumorStoreName], "readonly" | "readwrite">;

/** An index lookup that returns candidate records for one filter */
type CandidateQuery = {
  count: () => Promise<number>;
  records: () => Promise<RumorRecord[]>;
};

/** Sorts records newest first with ids breaking ties so results are stable */
function compareRecords(a: RumorRecord, b: RumorRecord) {
  return b.created_at - a.created_at || a.id.localeCompare(b.id);
}

/** Builds a tag-only stand-in for the rumor so matchFilter can run without decrypting it */
function getRecordMetadata(record: RumorRecord) {
  const tags = record.tags.map((tag) => [tag.slice(0, 1), tag.slice(2)]);
  return { id: record.id, kind: record.kind, pubkey: record.pubkey, created_at: record.created_at, tags, content: "" };
}

/** Sums the matching keys of several index lookups */
async function countKeys(counts: Promise<number>[]) {
  const totals = await Promise.all(counts);
  return totals.reduce((sum, count) => sum + count, 0);
}

/** Combines the matching records of several index lookups */
async function getAllRecords(lookups: Promise<RumorRecord[]>[]) {
  const results = await Promise.all(lookups);
  return results.flat();
}

/** An IndexedDB rumor database that indexes rumor metadata in plaintext and encrypts each rumor's JSON */
export class RumorDatabase implements IAsyncEventDatabase<Rumor> {
  private constructor(
    private readonly db: IDBPDatabase<RumorSchema>,
    private readonly cipher: RumorCipher,
  ) {}

  /** Opens or creates a rumor database with the given IndexedDB name */
  static async open(name: string, cipher: RumorCipher): Promise<RumorDatabase> {
    const db = await openDB<RumorSchema>(name, 1, {
      upgrade(db) {
        const rumors = db.createObjectStore("rumors", { keyPath: "id" });
        rumors.createIndex("kind", "kind");
        rumors.createIndex("pubkey", "pubkey");
        rumors.createIndex("created_at", "created_at");
        rumors.createIndex("tags", "tags", { multiEntry: true });
        rumors.createIndex("address", "address");
      },
    });

    return new RumorDatabase(db, cipher);
  }

  /** Closes the underlying IndexedDB connection */
  close() {
    this.db.close();
  }

  private toRecord(rumor: Rumor): RumorRecord {
    return {
      id: rumor.id,
      kind: rumor.kind,
      pubkey: rumor.pubkey,
      created_at: rumor.created_at,
      tags: [...getIndexableTags(rumor)],
      address: getReplaceableAddress(rumor) ?? undefined,
      payload: this.cipher.encrypt(JSON.stringify(rumor)),
    };
  }

  private toRumor(record: RumorRecord): Rumor {
    return JSON.parse(this.cipher.decrypt(record.payload));
  }

  /** Returns every index lookup that could answer the filter */
  private getCandidateQueries(tx: RumorTransaction, filter: Filter): CandidateQuery[] {
    const store = tx.objectStore("rumors");
    const queries: CandidateQuery[] = [];

    if (filter.ids) {
      const ids = filter.ids;
      queries.push({
        count: async () => ids.length,
        records: async () => {
          const records = await Promise.all(ids.map((id) => store.get(id)));
          return records.filter((record) => record !== undefined);
        },
      });
    }

    for (const [key, values] of Object.entries(filter)) {
      if ((key[0] !== "#" && key[0] !== "&") || !Array.isArray(values)) continue;

      const tags = values.map((value) => `${key.slice(1)}:${value}`);
      const index = store.index("tags");
      queries.push({
        count: () => countKeys(tags.map((tag) => index.count(tag))),
        records: () => getAllRecords(tags.map((tag) => index.getAll(tag))),
      });
    }

    if (filter.authors) {
      const authors = filter.authors;
      const index = store.index("pubkey");
      queries.push({
        count: () => countKeys(authors.map((pubkey) => index.count(pubkey))),
        records: () => getAllRecords(authors.map((pubkey) => index.getAll(pubkey))),
      });
    }

    if (filter.kinds) {
      const kinds = filter.kinds;
      const index = store.index("kind");
      queries.push({
        count: () => countKeys(kinds.map((kind) => index.count(kind))),
        records: () => getAllRecords(kinds.map((kind) => index.getAll(kind))),
      });
    }

    // The created_at range is always an option, and the only one for filters with no other fields
    const range = IDBKeyRange.bound(filter.since ?? 0, filter.until ?? Number.MAX_SAFE_INTEGER);
    const index = store.index("created_at");
    queries.push({ count: () => index.count(range), records: () => index.getAll(range) });

    return queries;
  }

  /** Reads the records matching one filter using its most selective index */
  private async getFilterRecords(tx: RumorTransaction, filter: Filter): Promise<RumorRecord[]> {
    const queries = this.getCandidateQueries(tx, filter);
    const counts = await Promise.all(queries.map((query) => query.count()));
    const smallest = queries[counts.indexOf(Math.min(...counts))];

    const candidates = await smallest.records();
    const matches = candidates.filter((record) => matchFilter(filter, getRecordMetadata(record))).sort(compareRecords);

    return filter.limit !== undefined ? matches.slice(0, filter.limit) : matches;
  }

  /** Reads the records matching any filter without decrypting them */
  private async getRecords(tx: RumorTransaction, filters: Filter | Filter[]): Promise<RumorRecord[]> {
    const list = Array.isArray(filters) ? filters : [filters];
    const results = await Promise.all(list.map((filter) => this.getFilterRecords(tx, filter)));

    const unique = new Map<string, RumorRecord>();
    for (const record of results.flat()) unique.set(record.id, record);

    return [...unique.values()].sort(compareRecords);
  }

  private getAddressRecords(kind: number, pubkey: string, identifier?: string) {
    const address = createReplaceableAddress(kind, pubkey, identifier);
    return this.db.getAllFromIndex("rumors", "address", address);
  }

  async hasEvent(id: string): Promise<boolean> {
    return (await this.db.count("rumors", id)) > 0;
  }

  async getEvent(id: string): Promise<Rumor | undefined> {
    const record = await this.db.get("rumors", id);
    return record && this.toRumor(record);
  }

  async hasReplaceable(kind: number, pubkey: string, identifier?: string): Promise<boolean> {
    const address = createReplaceableAddress(kind, pubkey, identifier);
    return (await this.db.countFromIndex("rumors", "address", address)) > 0;
  }

  async getReplaceable(kind: number, pubkey: string, identifier?: string): Promise<Rumor | undefined> {
    const records = await this.getAddressRecords(kind, pubkey, identifier);
    const newest = records.sort(compareRecords)[0];

    return newest && this.toRumor(newest);
  }

  async getReplaceableHistory(kind: number, pubkey: string, identifier?: string): Promise<Rumor[] | undefined> {
    const records = await this.getAddressRecords(kind, pubkey, identifier);
    if (records.length === 0) return undefined;

    return records.sort(compareRecords).map((record) => this.toRumor(record));
  }

  async getByFilters(filters: Filter | Filter[]): Promise<Rumor[]> {
    const tx = this.db.transaction("rumors", "readonly");
    const records = await this.getRecords(tx, filters);

    return records.map((record) => this.toRumor(record));
  }

  async getTimeline(filters: Filter | Filter[]): Promise<Rumor[]> {
    // Records are already sorted newest first
    return this.getByFilters(filters);
  }

  /** Reads sync pairs from the plaintext index without decrypting any rumors */
  async getSyncPairs(filters: Filter | Filter[]): Promise<SyncPair[]> {
    const tx = this.db.transaction("rumors", "readonly");
    const records = await this.getRecords(tx, filters);

    return records.map(({ id, created_at }) => ({ id, created_at }));
  }

  // The receiver only marks an envelope complete once this write resolves, so failed writes reject
  async add(rumor: Rumor): Promise<Rumor> {
    await this.db.put("rumors", this.toRecord(rumor));
    return rumor;
  }

  async remove(rumor: string | Rumor): Promise<boolean> {
    const id = typeof rumor === "string" ? rumor : rumor.id;
    const tx = this.db.transaction("rumors", "readwrite");

    const exists = (await tx.store.count(id)) > 0;
    if (exists) await tx.store.delete(id);
    await tx.done;

    return exists;
  }

  async removeByFilters(filters: Filter | Filter[]): Promise<number> {
    const tx = this.db.transaction("rumors", "readwrite");

    const records = await this.getRecords(tx, filters);
    await Promise.all(records.map((record) => tx.store.delete(record.id)));
    await tx.done;

    return records.length;
  }
}
