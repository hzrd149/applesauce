import { EventStore } from "applesauce-core/event-store";
import {
  EncryptedContentSymbol,
  setEncryptedContentCache,
  unlockEncryptedContent,
} from "applesauce-core/helpers/encrypted-content";
import { kinds } from "applesauce-core/helpers/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import {
  EncryptedContentFromCacheSymbol,
  isEncryptedContentFromCache,
  markEncryptedContentFromCache,
  persistEncryptedContent,
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

describe("persistEncryptedContent", () => {
  it("should restore encrypted content from cache when event is inserted", async () => {
    const event = user.event({ kind: kinds.EncryptedDirectMessage, content: "encrypted" });
    mockStorage.getItem.mockResolvedValue("decrypted content");

    const dispose = persistEncryptedContent(eventStore, mockStorage);
    eventStore.add(event);

    // Wait
    await new Promise((res) => setTimeout(res, 10));

    expect(mockStorage.getItem).toHaveBeenCalledWith(event.id);
    expect(Reflect.get(event, EncryptedContentSymbol)).toBe("decrypted content");
    expect(Reflect.has(event, EncryptedContentFromCacheSymbol)).toBe(true);

    dispose();
  });

  it("should not persist encrypted content when content is restored", async () => {
    const event = user.event({ kind: kinds.EncryptedDirectMessage, content: "encrypted" });
    mockStorage.getItem.mockResolvedValue("decrypted content");

    const dispose = persistEncryptedContent(eventStore, mockStorage);
    eventStore.add(event);

    // Wait
    await new Promise((res) => setTimeout(res, 10));

    expect(mockStorage.getItem).toHaveBeenCalledWith(event.id);
    expect(Reflect.get(event, EncryptedContentSymbol)).toBe("decrypted content");
    expect(Reflect.has(event, EncryptedContentFromCacheSymbol)).toBe(true);
    expect(mockStorage.setItem).not.toHaveBeenCalled();

    dispose();
  });

  it("should save encrypted content when event is unlocked", async () => {
    const event = user.event({
      kind: kinds.EncryptedDirectMessage,
      content: await user.nip04.encrypt(user.pubkey, "content"),
    });
    eventStore.add(event);

    const dispose = persistEncryptedContent(eventStore, mockStorage);
    await unlockEncryptedContent(event, user.pubkey, user);
    await Promise.resolve();

    expect(mockStorage.setItem).toHaveBeenCalledWith(event.id, "content");

    dispose();
  });

  it("should trigger an update when restoring encrypted content", async () => {
    const event = user.event({ kind: kinds.EncryptedDirectMessage, content: "encrypted" });
    mockStorage.getItem.mockResolvedValue("decrypted content");

    const dispose = persistEncryptedContent(eventStore, mockStorage);
    eventStore.add(event);

    // Wait
    await new Promise((res) => setTimeout(res, 10));

    // Event should be updated in the store
    const storedEvent = eventStore.getEvent(event.id);
    expect(Reflect.get(storedEvent!, EncryptedContentSymbol)).toBe("decrypted content");
    expect(Reflect.has(storedEvent!, EncryptedContentFromCacheSymbol)).toBe(true);

    dispose();
  });

  it("should call fallback method when plaintext is not in cache", async () => {
    const event = user.event({ kind: kinds.EncryptedDirectMessage, content: "encrypted" });
    const fallbackMock = vi.fn().mockImplementation((e) => setEncryptedContentCache(e, "fallback content"));

    // Mock storage to return null (cache miss)
    mockStorage.getItem.mockResolvedValue(null);

    const dispose = persistEncryptedContent(eventStore, mockStorage, fallbackMock);
    eventStore.add(event);
    await Promise.resolve();

    expect(mockStorage.getItem).toHaveBeenCalledWith(event.id);
    expect(fallbackMock).toHaveBeenCalledWith(event);
    expect(Reflect.get(event, EncryptedContentSymbol)).toBe("fallback content");
    expect(Reflect.has(event, EncryptedContentFromCacheSymbol)).toBe(false);

    dispose();
  });
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
