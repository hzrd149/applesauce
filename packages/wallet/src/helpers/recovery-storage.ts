/** An app-scoped durable string store; missing values return null and failed reads or mutations must reject */
export interface RecoveryStorage {
  /** Returns the stored value, or null only when the key does not exist */
  getItem(key: string): Promise<string | null>;
  /** Persists a value before resolving; false is also treated as a failed write */
  setItem(key: string, value: string): Promise<unknown>;
  /** Removes a value durably before resolving */
  removeItem(key: string): Promise<void>;
  /** Returns all keys, including keys written in previous sessions */
  keys(): Promise<string[]>;
  /** Runs an exclusive operation using locks scoped to this storage backend */
  withLock?<T>(key: string, operation: () => Promise<T>): Promise<T>;
}

const active = new WeakMap<RecoveryStorage, Set<string>>();

/**
 * Runs a recovery mutation exclusively within a storage instance and delegates backend locking to the adapter
 * @throws if the operation is already running or the lock provider fails
 */
export async function withRecoveryLock<T>(
  storage: RecoveryStorage,
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  let keys = active.get(storage);
  if (!keys) active.set(storage, (keys = new Set()));
  if (keys.has(key)) throw new Error("A recovery operation is already running");
  keys.add(key);
  try {
    if (storage.withLock) return await storage.withLock(key, operation);
    return await operation();
  } finally {
    keys.delete(key);
  }
}

/**
 * Persists a recovery value and rejects storage adapters that report failure without throwing
 * @throws if serialization or persistence fails
 */
export async function saveRecovery(storage: RecoveryStorage, key: string, value: unknown): Promise<void> {
  if ((await storage.setItem(key, JSON.stringify(value))) === false)
    throw new Error("Could not persist recovery state");
}
