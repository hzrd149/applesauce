import { Amount, type Token } from "@cashu/cashu-ts";
import { describe, expect, it, vi } from "vitest";
import { KeyValueCouch, migrateCouch, tokenIdentity } from "../key-value-couch.js";

function token(secret: string): Token {
  return {
    mint: "https://mint.example",
    unit: "sat",
    proofs: [{ id: "keyset", amount: Amount.from(1), secret, C: "signature" }],
  };
}

function fixture() {
  const records = new Map<string, string>();
  const storage = {
    getItem: vi.fn(async (key: string) => records.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      records.set(key, value);
      return true;
    }),
    removeItem: vi.fn(async (key: string) => {
      records.delete(key);
    }),
    keys: async () => [...records.keys()],
  };
  return { storage, records };
}

describe("key-value couch", () => {
  it("accepts stores that return the persisted value from setItem", async () => {
    const { storage, records } = fixture();
    const couch = new KeyValueCouch({
      ...storage,
      async setItem(key, value) {
        records.set(key, value);
        return value;
      },
    });
    await couch.store(token("proof"));
    expect((await couch.getAll())[0].proofs[0].secret).toBe("proof");
  });

  it("serializes concurrent writes across instances and restores Amount proofs", async () => {
    const { storage } = fixture();
    const first = new KeyValueCouch(storage);
    const second = new KeyValueCouch(storage);
    await Promise.all([first.store(token("first")), second.store(token("second"))]);
    const restored = await first.getAll();
    expect(restored.map((value) => value.proofs[0].secret)).toEqual(["first", "second"]);
    expect(restored[0].proofs[0].amount).toBeInstanceOf(Amount);
  });

  it("binds cleanup to the original account and storage", async () => {
    const first = fixture();
    const second = fixture();
    let storage = first.storage;
    const couch = new KeyValueCouch(() => storage);
    const cleanup = await couch.store(token("first"));
    storage = second.storage;
    await couch.store(token("second"));
    await cleanup();
    expect(await couch.getAll()).toHaveLength(1);
    expect(await new KeyValueCouch(first.storage).getAll()).toEqual([]);
  });

  it("preserves backups on read and write failures without poisoning the queue", async () => {
    const { storage } = fixture();
    const couch = new KeyValueCouch(storage);
    await couch.store(token("original"));
    storage.getItem.mockRejectedValueOnce(new Error("locked"));
    await expect(couch.store(token("new"))).rejects.toThrow("locked");
    storage.setItem.mockResolvedValueOnce(false);
    await expect(couch.remove(token("original"))).rejects.toThrow("persist");
    expect(await couch.getAll()).toHaveLength(1);
    await couch.clear();
    expect(await couch.getAll()).toEqual([]);
  });

  it("requires a storage scope and rejects malformed records without overwriting them", async () => {
    const { storage, records } = fixture();
    await expect(new KeyValueCouch(() => null).getAll()).rejects.toThrow("Unlock");
    records.set("tokens", "{}");
    await expect(new KeyValueCouch(storage).store(token("new"))).rejects.toThrow("Invalid couch");
    expect(records.get("tokens")).toBe("{}");
  });

  it("identifies tokens independently of proof order and trailing mint slashes", () => {
    const first = { ...token("first"), proofs: [...token("first").proofs, ...token("second").proofs] };
    expect(tokenIdentity(first)).toBe(
      tokenIdentity({ ...first, mint: first.mint + "/", proofs: [...first.proofs].reverse() }),
    );
  });

  it("migrates copy-before-delete and is retryable after source cleanup fails", async () => {
    const source = new KeyValueCouch(fixture().storage);
    const target = new KeyValueCouch(fixture().storage);
    await source.store(token("legacy"));
    const remove = vi.spyOn(source, "remove").mockRejectedValueOnce(new Error("cleanup failed"));
    await expect(migrateCouch(source, target)).rejects.toThrow("cleanup failed");
    expect(await target.getAll()).toHaveLength(1);
    expect(await source.getAll()).toHaveLength(1);
    await migrateCouch(source, target);
    expect(remove).toHaveBeenCalledTimes(2);
    expect(await target.getAll()).toHaveLength(1);
    expect(await source.getAll()).toEqual([]);
  });

  it("keeps write queues independent for separate storage instances", async () => {
    const first = fixture();
    const second = fixture();
    let release!: () => void;
    first.storage.getItem.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(null);
        }),
    );
    const blocked = new KeyValueCouch(first.storage).store(token("first"));
    await Promise.resolve();
    await new KeyValueCouch(second.storage).store(token("second"));
    release();
    await blocked;
    expect((await new KeyValueCouch(second.storage).getAll())[0].proofs[0].secret).toBe("second");
  });

  it("imports an old array record from separate app storage without overwriting the target", async () => {
    const legacy = fixture();
    const current = fixture();
    const old = new KeyValueCouch(legacy.storage);
    await old.store(token("legacy"));
    const value = legacy.records.get("tokens")!;
    legacy.records.clear();
    legacy.records.set("old-global-key", value);
    const target = new KeyValueCouch(current.storage);
    await target.store(token("current"));
    legacy.storage.removeItem.mockRejectedValueOnce(new Error("cleanup failed"));
    await expect(target.importLegacy(legacy.storage, "old-global-key")).rejects.toThrow("cleanup failed");
    expect(legacy.records.has("old-global-key")).toBe(true);
    await target.importLegacy(legacy.storage, "old-global-key");
    expect((await target.getAll()).map((token) => token.proofs[0].secret)).toEqual(["current", "legacy"]);
    expect(legacy.records.size).toBe(0);
  });
});
