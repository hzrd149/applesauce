import { Amount, type Token } from "@cashu/cashu-ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type SecureStorage from "../encrypted-storage";

const legacy = vi.hoisted(() => ({ getAll: vi.fn(), remove: vi.fn() }));
vi.mock("applesauce-wallet/helpers", () => ({
  getProofUID: (proof: { id: string; amount: unknown; secret: string; C: string }) =>
    proof.id + String(proof.amount) + proof.C + proof.secret,
  IndexedDBCouch: class {
    getAll = legacy.getAll;
    remove = legacy.remove;
  },
}));
import { createEncryptedCouch, migrateLegacyCouch } from "../encrypted-couch";

function token(secret: string): Token {
  return {
    mint: "https://mint.example",
    unit: "sat",
    proofs: [{ id: "keyset", amount: Amount.from(1), secret, C: "signature" }],
  };
}
function storage() {
  const records = new Map<string, string>();
  const adapter = {
    database: {},
    unlocked: true,
    getItem: vi.fn(async (key: string) => {
      await Promise.resolve();
      return records.get(key) ?? null;
    }),
    setItem: vi.fn(async (key: string, value: string) => {
      records.set(key, value);
      return true;
    }),
  };
  return { adapter, records, secure: adapter as unknown as SecureStorage };
}

beforeEach(() => {
  vi.clearAllMocks();
  legacy.getAll.mockResolvedValue([]);
  legacy.remove.mockResolvedValue(undefined);
});

describe("encrypted recovery couch", () => {
  it("serializes concurrent writes across separate couch instances and restores Amount proofs", async () => {
    const { secure } = storage();
    const a = createEncryptedCouch(() => secure, "wallet-a");
    const b = createEncryptedCouch(() => secure, "wallet-a");
    await Promise.all([a.store(token("first")), b.store(token("second"))]);
    const restored = await a.getAll();
    expect(restored.map((value) => value.proofs[0].secret)).toEqual(["first", "second"]);
    expect(restored[0].proofs[0].amount).toBeInstanceOf(Amount);
  });

  it("captures the original wallet owner in a token cleanup callback", async () => {
    const { secure } = storage();
    let owner = "wallet-a";
    const couch = createEncryptedCouch(
      () => secure,
      () => owner,
    );
    const clearFirst = await couch.store(token("first"));
    owner = "wallet-b";
    await couch.store(token("second"));
    await clearFirst();
    expect((await couch.getAll()).map((value) => value.proofs[0].secret)).toEqual(["second"]);
    owner = "wallet-a";
    expect(await couch.getAll()).toEqual([]);
  });

  it("preserves backups on read failure and rejects false persistence without poisoning the queue", async () => {
    const { secure, adapter } = storage();
    const couch = createEncryptedCouch(() => secure, "wallet");
    await couch.store(token("original"));
    adapter.getItem.mockRejectedValueOnce(new Error("decryption failed"));
    const writes = adapter.setItem.mock.calls.length;
    await expect(couch.store(token("new"))).rejects.toThrow("decryption failed");
    expect(adapter.setItem).toHaveBeenCalledTimes(writes);
    adapter.setItem.mockResolvedValueOnce(false);
    await expect(couch.remove(token("original"))).rejects.toThrow("Could not persist");
    expect((await couch.getAll())[0].proofs[0].secret).toBe("original");
    await couch.clear();
    expect(await couch.getAll()).toEqual([]);
  });

  it("refuses locked storage and namespaces without an owner", async () => {
    const { secure, adapter } = storage();
    adapter.unlocked = false;
    await expect(createEncryptedCouch(() => secure, "wallet").getAll()).rejects.toThrow("Unlock recovery storage");
    adapter.unlocked = true;
    await expect(createEncryptedCouch(() => secure, "").store(token("first"))).rejects.toThrow("wallet-specific");
  });

  it("keeps plaintext legacy backups until encrypted storage succeeds and avoids duplicate migration", async () => {
    const { secure, adapter } = storage();
    const couch = createEncryptedCouch(() => secure, "explicitly-selected-wallet");
    legacy.getAll.mockResolvedValue([token("legacy")]);
    adapter.setItem.mockResolvedValueOnce(false);
    await expect(migrateLegacyCouch(couch)).rejects.toThrow("Could not persist");
    expect(legacy.remove).not.toHaveBeenCalled();
    await expect(migrateLegacyCouch(couch)).resolves.toBe(1);
    expect(legacy.remove).toHaveBeenCalledTimes(1);
    await migrateLegacyCouch(couch);
    expect(await couch.getAll()).toHaveLength(1);
  });
});
