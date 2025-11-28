import { kinds } from "nostr-tools";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FakeUser } from "../../__tests__/fixtures.js";
import { EventStore } from "../../event-store/event-store.js";
import { EncryptedContentSymbol, setEncryptedContentCache, unlockEncryptedContent } from "../encrypted-content.js";
import { EncryptedContentFromCacheSymbol, persistEncryptedContent } from "applesauce-common/helpers/encrypted-content-cache";

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

    // Wait two ticks
    await Promise.resolve();
    await Promise.resolve();

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

    // Wait two ticks
    await Promise.resolve();
    await Promise.resolve();

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

    // Wait two ticks
    await Promise.resolve();
    await Promise.resolve();

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
