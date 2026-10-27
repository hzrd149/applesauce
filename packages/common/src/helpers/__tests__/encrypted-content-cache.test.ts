import { EventStore } from "applesauce-core/event-store";
import {
  EncryptedContentSymbol,
  setEncryptedContentCache,
  unlockEncryptedContent,
} from "applesauce-core/helpers/encrypted-content";
import { kinds } from "applesauce-core/helpers/event";
import * as coreCache from "applesauce-core/helpers/encrypted-content-cache";
import * as commonCache from "../encrypted-content-cache.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import {
  EncryptedContentCache,
  EncryptedContentFromCacheSymbol,
  isEncryptedContentFromCache,
  persistEncryptedContent,
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

  it("restores empty plaintext without calling fallback", async () => {
    const event = user.event({ kind: kinds.EncryptedDirectMessage, content: "encrypted" });
    mockStorage.getItem.mockResolvedValue("");
    const fallback = vi.fn();
    const dispose = persistEncryptedContent(eventStore, mockStorage, fallback);

    eventStore.add(event);
    await vi.waitFor(() => expect(Reflect.get(event, EncryptedContentSymbol)).toBe(""));

    expect(fallback).not.toHaveBeenCalled();
    expect(mockStorage.setItem).not.toHaveBeenCalled();
    dispose();
  });

  it("persists empty plaintext when an event is unlocked", async () => {
    const event = user.event({ kind: kinds.EncryptedDirectMessage, content: "encrypted" });
    eventStore.add(event);
    const dispose = persistEncryptedContent(eventStore, mockStorage);

    setEncryptedContentCache(event, "");
    expect(mockStorage.setItem).toHaveBeenCalledWith(event.id, "");
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

describe("core cache integration", () => {
  it("supports synchronous storage across direct helpers and store persistence", async () => {
    const values = new Map<string, string>();
    const storage: EncryptedContentCache = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    };
    const event = user.event({ kind: kinds.EncryptedDirectMessage, content: "encrypted" });
    const duplicate = { ...event };
    const decrypt = vi.fn(() => "");

    expect(await restoreEncryptedContent(event, storage)).toBeUndefined();
    expect(await getOrDecryptEncryptedContent(event, storage, decrypt)).toBe("");
    expect(values.get(event.id)).toBe("");
    expect(await saveEncryptedContent(event, storage)).toBe(true);
    expect(await restoreEncryptedContent(duplicate, storage)).toBe("");
    expect(await getOrDecryptEncryptedContent(duplicate, storage, decrypt)).toBe("");
    expect(decrypt).toHaveBeenCalledTimes(1);

    const dispose = persistEncryptedContent(eventStore, storage);
    const storedEvent = { ...event };
    eventStore.add(storedEvent);
    await vi.waitFor(() => expect(Reflect.get(storedEvent, EncryptedContentSymbol)).toBe(""));

    const freshlyUnlocked = user.event({ kind: kinds.EncryptedDirectMessage, content: "other encrypted" });
    eventStore.add(freshlyUnlocked);
    setEncryptedContentCache(freshlyUnlocked, "plaintext");
    expect(values.get(freshlyUnlocked.id)).toBe("plaintext");
    dispose();
  });

  it("shares event ID keys between direct decryption and store persistence", async () => {
    const event = user.event({ kind: kinds.EncryptedDirectMessage, content: "encrypted" });
    const duplicate = { ...event };
    const values = new Map<string, string>();
    const storage = {
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        values.set(key, value);
      },
    };
    const decrypt = vi.fn().mockResolvedValue("plaintext");

    expect(await getOrDecryptEncryptedContent(event, storage, decrypt)).toBe("plaintext");
    expect(isEncryptedContentFromCache(event)).toBe(false);
    const dispose = persistEncryptedContent(eventStore, storage);
    eventStore.add(duplicate);
    await vi.waitFor(() => expect(Reflect.get(duplicate, EncryptedContentSymbol)).toBe("plaintext"));
    expect(isEncryptedContentFromCache(duplicate)).toBe(true);
    expect(await getOrDecryptEncryptedContent(duplicate, storage, decrypt)).toBe("plaintext");
    expect(decrypt).toHaveBeenCalledTimes(1);
    dispose();
  });
});

describe("cache compatibility exports", () => {
  it("re-exports the core helpers without wrapping them", () => {
    for (const [name, value] of Object.entries(coreCache)) {
      expect(commonCache[name as keyof typeof coreCache]).toBe(value);
    }
  });
});
