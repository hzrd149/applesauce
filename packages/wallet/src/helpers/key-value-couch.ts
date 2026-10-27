import { deserializeProofs, serializeProofs, type Token } from "@cashu/cashu-ts";
import type { Couch } from "./couch.js";
import { getProofUID } from "./cashu.js";
import { saveRecovery, withRecoveryLock, type RecoveryStorage } from "./recovery-storage.js";

type StoredToken = { id: string; token: Omit<Token, "proofs"> & { proofs: string[] } };
const queues = new WeakMap<RecoveryStorage, Promise<void>>();
const tokensKey = "tokens";

/** Identifies a token by its normalized mint, unit, and unordered proof identities */
export function tokenIdentity(token: Token): string {
  return JSON.stringify([token.mint.replace(/\/+$/, ""), token.unit ?? "sat", token.proofs.map(getProofUID).sort()]);
}

/** Stores couch tokens in a consumer-provided string store, which can encrypt values */
export class KeyValueCouch implements Couch {
  /** Creates a couch using app-scoped storage, optionally resolving the current account's storage */
  constructor(private readonly storage: RecoveryStorage | (() => RecoveryStorage | null | undefined)) {}

  private context() {
    const storage = typeof this.storage === "function" ? this.storage() : this.storage;
    if (!storage) throw new Error("Unlock recovery storage before using the wallet");
    return { storage, key: tokensKey };
  }

  private serialize<T>(storage: RecoveryStorage, key: string, operation: () => Promise<T>): Promise<T> {
    const previous = queues.get(storage) ?? Promise.resolve();
    const result = previous.then(() => withRecoveryLock(storage, `applesauce-couch:${key}`, operation));
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    queues.set(storage, settled);
    void settled.then(() => {
      if (queues.get(storage) === settled) queues.delete(storage);
    });
    return result;
  }

  private async read(storage: RecoveryStorage, key: string): Promise<StoredToken[]> {
    const value = await storage.getItem(key);
    if (value === null) return [];
    const records = JSON.parse(value) as StoredToken[];
    if (
      !Array.isArray(records) ||
      records.some((record) => !record.id || !record.token?.mint || !Array.isArray(record.token.proofs))
    )
      throw new Error("Invalid couch record; preserve the stored value");
    return records;
  }

  private decode(record: StoredToken): Token {
    return { ...record.token, proofs: deserializeProofs(record.token.proofs) };
  }

  /**
   * Persists a token and returns cleanup bound to the original storage and account
   * @throws if the storage scope is missing, unreadable, or cannot be persisted
   */
  async store(token: Token): Promise<() => Promise<void>> {
    const { storage, key } = this.context();
    const id = crypto.randomUUID();
    await this.serialize(storage, key, async () => {
      const records = await this.read(storage, key);
      records.push({ id, token: { ...token, proofs: serializeProofs(token.proofs) } });
      await saveRecovery(storage, key, records);
    });
    return () =>
      this.serialize(storage, key, async () => {
        const records = await this.read(storage, key);
        await saveRecovery(
          storage,
          key,
          records.filter((record) => record.id !== id),
        );
      });
  }

  /**
   * Returns all tokens in this couch
   * @throws if the storage scope is missing or its contents cannot be read
   */
  async getAll(): Promise<Token[]> {
    const { storage, key } = this.context();
    return this.serialize(storage, key, async () =>
      (await this.read(storage, key)).map((record) => this.decode(record)),
    );
  }

  /**
   * Removes one matching token regardless of proof order
   * @throws if the storage scope is missing, unreadable, or cannot be persisted
   */
  async remove(token: Token): Promise<void> {
    const { storage, key } = this.context();
    await this.serialize(storage, key, async () => {
      const records = await this.read(storage, key);
      const index = records.findIndex((record) => tokenIdentity(this.decode(record)) === tokenIdentity(token));
      if (index >= 0)
        await saveRecovery(
          storage,
          key,
          records.filter((_, position) => position !== index),
        );
    });
  }

  /**
   * Removes every token in this couch
   * @throws if the storage scope is missing or cannot be persisted
   */
  async clear(): Promise<void> {
    const { storage, key } = this.context();
    await this.serialize(storage, key, () => saveRecovery(storage, key, []));
  }

  /**
   * Imports an earlier array-based couch record from explicitly selected legacy storage
   * @throws if source and target overlap or persistence or cleanup fails
   */
  async importLegacy(source: RecoveryStorage, key: string): Promise<number> {
    const { storage } = this.context();
    if (source === storage && key === tokensKey)
      throw new Error("Source and target couches must use independent storage scopes");
    const target = new KeyValueCouch(storage);
    return withRecoveryLock(source, `applesauce-couch:${key}`, async () => {
      const value = await source.getItem(key);
      if (value === null) return 0;
      const records = await this.read(source, key);
      const copied = new Set((await target.getAll()).map(tokenIdentity));
      for (const record of records) {
        const token = this.decode(record);
        const identity = tokenIdentity(token);
        if (copied.has(identity)) continue;
        await target.store(token);
        copied.add(identity);
      }
      await source.removeItem(key);
      return records.length;
    });
  }
}

/**
 * Copies tokens into an explicitly selected couch before removing each source token
 * @throws if either couch cannot be read or mutated
 */
export async function migrateCouch(source: Couch, target: Couch): Promise<number> {
  if (source === target) throw new Error("Source and target couches must use independent storage scopes");
  const copied = new Set((await target.getAll()).map(tokenIdentity));
  let count = 0;
  for (const token of await source.getAll()) {
    const identity = tokenIdentity(token);
    if (!copied.has(identity)) {
      await target.store(token);
      copied.add(identity);
    }
    await source.remove(token);
    count++;
  }
  return count;
}
