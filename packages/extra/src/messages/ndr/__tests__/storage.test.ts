import { describe, expect, it } from "vitest";
import { createNdrStorage, type NdrKeyValueStorage } from "../storage.js";

function createMemoryStorage(): NdrKeyValueStorage & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, value),
    removeItem: (key) => items.delete(key),
    keys: () => [...items.keys()],
  };
}

describe("createNdrStorage", () => {
  it("round-trips JSON values and returns undefined for missing keys", async () => {
    const storage = createNdrStorage(createMemoryStorage());

    await storage.put("a", { count: 1 });
    expect(await storage.get("a")).toEqual({ count: 1 });
    expect(await storage.get("missing")).toBeUndefined();

    await storage.del("a");
    expect(await storage.get("a")).toBeUndefined();
  });

  it("lists keys by prefix", async () => {
    const storage = createNdrStorage(createMemoryStorage());
    await storage.put("v1/one", 1);
    await storage.put("v1/two", 2);
    await storage.put("app/three", 3);

    expect((await storage.list("v1/")).sort()).toEqual(["v1/one", "v1/two"]);
    expect(await storage.list()).toHaveLength(3);
  });

  it("throws when the store reports a failed write", async () => {
    const memory = createMemoryStorage();
    const storage = createNdrStorage({ ...memory, setItem: async () => false });

    await expect(storage.put("a", 1)).rejects.toThrow("Failed to write");
  });
});
