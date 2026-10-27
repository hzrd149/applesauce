import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecoveryStorage } from "applesauce-wallet/helpers";
import type localforage from "localforage";
import SecureStorage from "../encrypted-storage";

const mocks = vi.hoisted(() => ({ createInstance: vi.fn() }));
vi.mock("localforage", () => ({ default: { createInstance: mocks.createInstance } }));

function database(name: string, storeName: string) {
  const records = new Map<string, unknown>();
  const storage = {
    getItem: async (key: string) => records.get(key) ?? null,
    setItem: async (key: string, value: unknown) => {
      records.set(key, value);
      return value;
    },
    removeItem: async (key: string) => {
      records.delete(key);
    },
    keys: async () => [...records.keys()],
    config: (key: string) => (key === "name" ? name : storeName),
  } as unknown as LocalForage;
  return { records, storage };
}

// LocalForage's generic reads and value-returning writes require no wallet-specific adapter.
type LocalForageStore = ReturnType<typeof localforage.createInstance>;
const acceptsLocalForage: LocalForageStore extends RecoveryStorage ? true : false = true;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createInstance.mockImplementation(
    (options: LocalForageOptions) => database(options.name!, options.storeName!).storage,
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("scoped encrypted storage", () => {
  it("accepts LocalForage's public storage interface directly", () => {
    expect(acceptsLocalForage).toBe(true);
  });

  it("creates isolated stores sharing the parent encryption key and caches each adapter", async () => {
    const root = database("app", "settings");
    const storage = new SecureStorage(root.storage);
    const first = storage.createInstance({ name: "app", storeName: "deposits_first" });
    const second = storage.createInstance({ name: "app", storeName: "deposits_second" });
    await expect(first.getItem("record")).rejects.toThrow("locked");
    expect(await storage.unlock("1234")).toBe(true);
    await first.setItem("record", "first secret");
    await second.setItem("record", "second secret");
    expect(await first.getItem("record")).toBe("first secret");
    expect(await second.getItem("record")).toBe("second secret");
    expect(await first.keys()).toEqual(["record"]);
    expect(await storage.getItem("record")).toBeNull();
    expect(storage.createInstance({ name: "app", storeName: "deposits_first" })).toBe(first);
    expect(mocks.createInstance).toHaveBeenCalledTimes(2);
    await first.removeItem("record");
    expect(await second.getItem("record")).toBe("second secret");
  });

  it("derives lock identities from the database and store rather than the operation key alone", async () => {
    const request = vi.fn(async (_name: string, _options: unknown, callback: (lock: object) => unknown) =>
      callback({}),
    );
    vi.stubGlobal("navigator", { locks: { request } });
    const first = new SecureStorage(database("app", "first").storage);
    const second = new SecureStorage(database("app", "second").storage);
    const sameBackend = new SecureStorage(database("app", "first").storage);
    await first.withLock("operation", async () => {});
    await second.withLock("operation", async () => {});
    await sameBackend.withLock("operation", async () => {});
    const names = request.mock.calls.map(([name]) => name);
    expect(names[0]).not.toBe(names[1]);
    expect(names[0]).toBe(names[2]);
  });
});
