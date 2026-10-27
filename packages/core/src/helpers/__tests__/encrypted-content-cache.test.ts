import { EventStore } from "../../event-store/index.js";
import { EncryptedContentSymbol, setEncryptedContentCache } from "../encrypted-content.js";
import { kinds } from "../event.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import {
  EncryptedContentCache,
  EncryptedContentFromCacheSymbol,
  isEncryptedContentFromCache,
  markEncryptedContentFromCache,
  restoreEncryptedContent,
  saveEncryptedContent,
  getOrDecryptEncryptedContent,
} from "../encrypted-content-cache.js";

const mockStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
};

const user = new FakeUser();
let eventStore: EventStore;

beforeEach(() => {
  vi.clearAllMocks();
  eventStore = new EventStore();
});

// 05.1-09: markEncryptedContentFromCache's EncryptedContentFromCacheSymbol write migrated from
// Reflect.set to setCachedValue — the flag must be non-enumerable and dropped by a plain spread,
// and isEncryptedContentFromCache's Reflect.has-based reader must still return true (WR-11's
// separate === true tightening stays deferred, D-10 — out of scope here).
describe("markEncryptedContentFromCache non-enumerability (05.1-09)", () => {
  it("writes EncryptedContentFromCacheSymbol non-enumerable and drops it on a plain spread", () => {
    const event = user.event({ kind: kinds.EncryptedDirectMessage, content: "encrypted" });

    markEncryptedContentFromCache(event);

    expect(Object.keys(event)).not.toContain(EncryptedContentFromCacheSymbol);
    expect(Object.getOwnPropertySymbols(event)).toContain(EncryptedContentFromCacheSymbol);
    const descriptor = Object.getOwnPropertyDescriptor(event, EncryptedContentFromCacheSymbol);
    expect(descriptor?.enumerable).toBe(false);

    const spread = { ...event };
    expect(Reflect.has(spread, EncryptedContentFromCacheSymbol)).toBe(false);
  });

  it("isEncryptedContentFromCache still returns true after the flag is set (reader unchanged)", () => {
    const event = user.event({ kind: kinds.EncryptedDirectMessage, content: "encrypted" });

    expect(isEncryptedContentFromCache(event)).toBe(false);
    markEncryptedContentFromCache(event);
    expect(isEncryptedContentFromCache(event)).toBe(true);
  });
});

describe("direct encrypted content cache helpers", () => {
  it("restores empty plaintext and notifies observers after marking provenance", async () => {
    const event = user.event({ kind: kinds.EncryptedDirectMessage, content: "encrypted" });
    eventStore.add(event);
    mockStorage.getItem.mockResolvedValue("");
    const updated = vi.fn((updatedEvent) => expect(isEncryptedContentFromCache(updatedEvent)).toBe(true));
    const subscription = eventStore.update$.subscribe(updated);

    expect(await restoreEncryptedContent(event, mockStorage)).toBe("");
    expect(updated).toHaveBeenCalledWith(event);
    expect(await saveEncryptedContent(event, mockStorage)).toBe(true);
    expect(mockStorage.setItem).toHaveBeenCalledWith(event.id, "");
    subscription.unsubscribe();
  });

  it("leaves locked events unchanged on a miss and skips saving them", async () => {
    const event = user.event({ kind: kinds.Seal, content: "encrypted" });
    mockStorage.getItem.mockResolvedValue(null);

    expect(await restoreEncryptedContent(event, mockStorage)).toBeUndefined();
    expect(isEncryptedContentFromCache(event)).toBe(false);
    expect(await saveEncryptedContent(event, mockStorage)).toBe(false);
    expect(mockStorage.setItem).not.toHaveBeenCalled();
  });

  it("does not replace plaintext unlocked while a cache read is pending", async () => {
    const event = user.event({ kind: kinds.Seal, content: "encrypted" });
    let finishRead!: (content: string) => void;
    mockStorage.getItem.mockReturnValue(
      new Promise<string>((resolve) => {
        finishRead = resolve;
      }),
    );
    const restored = restoreEncryptedContent(event, mockStorage);
    setEncryptedContentCache(event, "new plaintext");
    finishRead("old plaintext");

    expect(await restored).toBe("new plaintext");
    expect(isEncryptedContentFromCache(event)).toBe(false);
  });

  it("propagates storage and decryption errors", async () => {
    const event = user.event({ kind: kinds.Seal, content: "encrypted" });
    const failure = new Error("failed");
    const decrypt = vi.fn().mockRejectedValue(failure);
    mockStorage.getItem.mockRejectedValueOnce(failure);
    await expect(getOrDecryptEncryptedContent(event, mockStorage, decrypt)).rejects.toBe(failure);
    expect(decrypt).not.toHaveBeenCalled();

    mockStorage.getItem.mockResolvedValue(null);
    await expect(getOrDecryptEncryptedContent(event, mockStorage, decrypt)).rejects.toBe(failure);
    expect(Reflect.has(event, EncryptedContentSymbol)).toBe(false);

    setEncryptedContentCache(event, "plaintext");
    mockStorage.setItem.mockRejectedValueOnce(failure);
    await expect(saveEncryptedContent(event, mockStorage)).rejects.toBe(failure);
  });
});
