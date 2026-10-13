import { deserializeProofs, serializeProofs, type Token } from "@cashu/cashu-ts";
import type { Couch } from "applesauce-wallet/helpers";
import { getProofUID, IndexedDBCouch } from "applesauce-wallet/helpers";
import type SecureStorage from "./encrypted-storage";

const queues = new WeakMap<object, Map<string, Promise<void>>>();
type StoredToken = { id: string; token: Omit<Token, "proofs"> & { proofs: string[] } };

/** Identifies a token by its mint, unit, and proofs regardless of ordering */
export function tokenIdentity(token: Token) {
  return JSON.stringify([token.mint.replace(/\/+$/, ""), token.unit ?? "sat", token.proofs.map(getProofUID).sort()]);
}

function serialize<T>(storage: SecureStorage, key: string, operation: () => Promise<T>): Promise<T> {
  let keys = queues.get(storage.database);
  if (!keys) queues.set(storage.database, (keys = new Map()));
  const previous = keys.get(key) ?? Promise.resolve();
  const result = previous.then(() => {
    if (!storage.unlocked) throw new Error("Unlock recovery storage before using the wallet");
    // Web Locks also serialize separate tabs writing the same recovery namespace.
    return typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks.request(`examples-couch:${key}`, operation)
      : operation();
  });
  const settled = result.then(
    () => undefined,
    () => undefined,
  );
  keys.set(key, settled);
  void settled.then(() => {
    if (keys.get(key) === settled) keys.delete(key);
  });
  return result;
}

/** Persists recovery tokens in unlocked encrypted storage with serialized durable mutations */
export function createEncryptedCouch(
  getStorage: () => SecureStorage | null | undefined,
  namespace: string | (() => string),
): Couch {
  const context = () => {
    const storage = getStorage();
    if (!storage?.unlocked) throw new Error("Unlock recovery storage before using the wallet");
    const scope = typeof namespace === "function" ? namespace() : namespace;
    if (!scope.trim()) throw new Error("A wallet-specific recovery namespace is required");
    return { storage, key: `example-encrypted-couch:${scope}` };
  };
  const read = async (storage: SecureStorage, key: string): Promise<StoredToken[]> => {
    const value = await storage.getItem(key);
    if (value === null) return [];
    const records: StoredToken[] = JSON.parse(value);
    if (
      !Array.isArray(records) ||
      records.some((record) => !record.id || !record.token?.mint || !Array.isArray(record.token.proofs))
    )
      throw new Error("Recovery tokens could not be read; preserve the encrypted record");
    return records;
  };
  const write = async (storage: SecureStorage, key: string, records: StoredToken[]) => {
    if (!(await storage.setItem(key, JSON.stringify(records)))) throw new Error("Could not persist recovery tokens");
  };
  const decoded = (record: StoredToken): Token => ({ ...record.token, proofs: deserializeProofs(record.token.proofs) });
  const removeById = (storage: SecureStorage, key: string, id: string) =>
    serialize(storage, key, async () => {
      const records = await read(storage, key);
      await write(
        storage,
        key,
        records.filter((record) => record.id !== id),
      );
    });
  return {
    async store(token) {
      const { storage, key } = context();
      const id = crypto.randomUUID();
      await serialize(storage, key, async () => {
        const records = await read(storage, key);
        records.push({ id, token: { ...token, proofs: serializeProofs(token.proofs) } });
        await write(storage, key, records);
      });
      // Capture the original owner: switching accounts must not clear another wallet's token.
      return () => removeById(storage, key, id);
    },
    async getAll() {
      const { storage, key } = context();
      return serialize(storage, key, async () => (await read(storage, key)).map(decoded));
    },
    async remove(token) {
      const { storage, key } = context();
      await serialize(storage, key, async () => {
        const records = await read(storage, key);
        const index = records.findIndex((record) => tokenIdentity(decoded(record)) === tokenIdentity(token));
        if (index < 0) return;
        await write(
          storage,
          key,
          records.filter((_, position) => position !== index),
        );
      });
    },
    async clear() {
      const { storage, key } = context();
      await serialize(storage, key, async () => {
        await write(storage, key, []);
      });
    },
  };
}

/** Copies legacy plaintext tokens into the explicitly selected wallet before removing each legacy record */
export async function migrateLegacyCouch(target: Couch): Promise<number> {
  const legacy = new IndexedDBCouch();
  const migrated = new Set((await target.getAll()).map(tokenIdentity));
  let count = 0;
  for (const token of await legacy.getAll()) {
    const identity = tokenIdentity(token);
    if (!migrated.has(identity)) {
      await target.store(token);
      migrated.add(identity);
    }
    await legacy.remove(token);
    count++;
  }
  return count;
}
