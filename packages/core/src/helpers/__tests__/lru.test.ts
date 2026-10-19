import { afterEach, describe, expect, it, vi } from "vitest";
import { LRU } from "../lru.js";

describe("LRU", () => {
  afterEach(() => vi.useRealTimers());

  it("should keep keys in least recently used order", () => {
    const lru = new LRU<number>();
    lru.set("a", 1).set("b", 2).set("c", 3);
    lru.get("a");

    expect(lru.keys()).toEqual(["b", "c", "a"]);
    expect(lru.values()).toEqual([2, 3, 1]);
  });

  it("should evict the least recently used key when full", () => {
    const lru = new LRU<number>(2);
    lru.set("a", 1).set("b", 2);
    lru.get("a");
    lru.set("c", 3);

    expect(lru.has("b")).toBe(false);
    expect(lru.keys()).toEqual(["a", "c"]);
    expect(lru.size).toBe(2);
  });

  it("should update existing keys without growing", () => {
    const lru = new LRU<number>(2);
    lru.set("a", 1).set("b", 2).set("a", 3);

    expect(lru.get("a")).toBe(3);
    expect(lru.size).toBe(2);
    expect(lru.keys()).toEqual(["b", "a"]);
  });

  it("should unlink deleted keys from the middle of the list", () => {
    const lru = new LRU<number>();
    lru.set("a", 1).set("b", 2).set("c", 3).delete("b");

    expect(lru.has("b")).toBe(false);
    expect(lru.keys()).toEqual(["a", "c"]);
    expect(lru.size).toBe(2);
    lru.delete("missing");
    expect(lru.size).toBe(2);
  });

  it("should expire keys after the ttl", () => {
    vi.useFakeTimers();
    const lru = new LRU<number>(0, 1000);
    lru.set("a", 1);
    expect(lru.expiresAt("a")).toBe(Date.now() + 1000);

    vi.advanceTimersByTime(1001);
    expect(lru.get("a")).toBeUndefined();
    expect(lru.has("a")).toBe(false);
  });

  it("should be empty after clear", () => {
    const lru = new LRU<number>();
    lru.set("a", 1).set("b", 2).clear();

    expect(lru.size).toBe(0);
    expect(lru.keys()).toEqual([]);
    expect(lru.has("a")).toBe(false);
  });
});
