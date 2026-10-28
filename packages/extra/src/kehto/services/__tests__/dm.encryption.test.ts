import { GiftWrapFactory, LegacyMessageFactory } from "applesauce-common/factories";
import { getGiftWrapSeal, internalGiftWrapEvents, persistEncryptedContent } from "applesauce-common/helpers";
import { EventStore } from "applesauce-core";
import {
  finalizeEvent,
  getEventHash,
  kinds,
  unixNow,
  type EncryptedContentCache,
  type NostrEvent,
} from "applesauce-core/helpers";
import type { RelayPool } from "applesauce-relay";
import { PrivateKeySigner } from "applesauce-signers";
import { EMPTY, firstValueFrom, Subject, toArray } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLegacyMessageProtocol, createWrappedMessageProtocol } from "../dm.js";

const aliceKey = new Uint8Array(32).fill(1);
const aliceSigner = new PrivateKeySigner(aliceKey);
const bobSigner = new PrivateKeySigner(new Uint8Array(32).fill(2));
const alice = await aliceSigner.getPublicKey();
const bob = await bobSigner.getPublicKey();
const context = { signal: new AbortController().signal };

afterEach(() => {
  internalGiftWrapEvents.removeByFilters({});
  vi.restoreAllMocks();
});

function memoryCache() {
  const entries = new Map<string, string>();
  const cache = {
    getItem: vi.fn(async (key: string) => entries.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      entries.set(key, value);
    }),
  };
  return { cache, entries };
}

describe.each(["nip04", "nip17"] as const)("%s decrypted content cache", (protocolId) => {
  const createProtocol = protocolId === "nip04" ? createLegacyMessageProtocol : createWrappedMessageProtocol;

  async function incoming(content = "hello") {
    if (protocolId === "nip04") return LegacyMessageFactory.create(alice, content).sign(bobSigner);

    const template = { kind: 14, pubkey: bob, created_at: unixNow(), tags: [["p", alice]], content };
    return GiftWrapFactory.create(bobSigner, alice, { ...template, id: getEventHash(template) });
  }

  function reader(event: NostrEvent, cache?: EncryptedContentCache) {
    const eventStore = new EventStore();
    // A reload has no symbol caches or internally remembered seals/rumors.
    internalGiftWrapEvents.removeByFilters({});
    eventStore.add(JSON.parse(JSON.stringify(event)));
    const protocol = createProtocol({
      eventStore,
      signer: aliceSigner,
      pool: {
        relay: () => ({ getSupported: async () => [], request: () => EMPTY }),
        req: () => new Subject(),
      } as unknown as RelayPool,
      decryptionCache: cache,
      fallbackRelays: ["wss://dm.test/"],
      timeout: 5,
    });
    return {
      eventStore,
      protocol,
      async read() {
        const session = (await firstValueFrom(protocol.session$))!;
        return firstValueFrom(session.messages$({ ...context, history: true }).pipe(toArray()));
      },
    };
  }

  it("persists by event ID and restores after reload without signer calls", async () => {
    const event = await incoming();
    const { cache, entries } = memoryCache();
    const decrypt = vi.spyOn(aliceSigner[protocolId === "nip04" ? "nip04" : "nip44"], "decrypt");
    const first = reader(event, cache);
    try {
      expect(await first.read()).toEqual([expect.objectContaining({ content: "hello" })]);
    } finally {
      first.protocol.close?.();
    }

    expect(decrypt).toHaveBeenCalledTimes(protocolId === "nip04" ? 1 : 2);
    expect(entries.has(event.id)).toBe(true);
    expect(entries.size).toBe(protocolId === "nip04" ? 1 : 2);
    expect([...entries.keys()].every((key) => /^[0-9a-f]{64}$/.test(key))).toBe(true);
    decrypt.mockClear();
    cache.setItem.mockClear();

    const reloaded = reader(event, cache);
    try {
      expect(await reloaded.read()).toEqual([expect.objectContaining({ content: "hello" })]);
      expect(decrypt).not.toHaveBeenCalled();
      expect(cache.setItem).not.toHaveBeenCalled();
    } finally {
      reloaded.protocol.close?.();
    }
  });

  it("reads entries written by persistEncryptedContent", async () => {
    const event = await incoming();
    const { cache } = memoryCache();
    const source = new EventStore();
    const stop = persistEncryptedContent(source, cache);
    source.add(event);
    await vi.waitFor(() => expect(cache.setItem).toHaveBeenCalledTimes(protocolId === "nip04" ? 1 : 2));
    stop();

    const decrypt = vi.spyOn(aliceSigner[protocolId === "nip04" ? "nip04" : "nip44"], "decrypt");
    const restored = reader(event, cache);
    try {
      expect(await restored.read()).toHaveLength(1);
      expect(decrypt).not.toHaveBeenCalled();
    } finally {
      restored.protocol.close?.();
    }
  });

  it.each(["read", "write"])("delivers messages when cache %s fails", async (operation) => {
    const { cache } = memoryCache();
    if (operation === "read") cache.getItem.mockRejectedValue(new Error("unavailable"));
    else cache.setItem.mockRejectedValue(new Error("unavailable"));
    const state = reader(await incoming(), cache);
    try {
      expect(await state.read()).toEqual([expect.objectContaining({ content: "hello" })]);
    } finally {
      state.protocol.close?.();
    }
  });

  it("restores empty message content", async () => {
    const event = await incoming("");
    const { cache } = memoryCache();
    const first = reader(event, cache);
    try {
      expect(await first.read()).toHaveLength(1);
    } finally {
      first.protocol.close?.();
    }
    const decrypt = vi.spyOn(aliceSigner[protocolId === "nip04" ? "nip04" : "nip44"], "decrypt");
    const restored = reader(event, cache);
    try {
      expect(await restored.read()).toEqual([expect.objectContaining({ content: "" })]);
      expect(decrypt).not.toHaveBeenCalled();
    } finally {
      restored.protocol.close?.();
    }
  });

  it("persists sends so their sender copy survives reload", async () => {
    const { cache } = memoryCache();
    const eventStore = new EventStore();
    eventStore.add(
      finalizeEvent(
        {
          kind: kinds.DirectMessageRelaysList,
          created_at: unixNow(),
          tags: [["relay", "wss://dm.test/"]],
          content: "",
        },
        aliceKey,
      ),
    );
    const publish = vi.fn(async (_relays: string[], _event: NostrEvent) => [{ ok: true }]);
    const protocol = createProtocol({
      eventStore,
      pool: { publish } as unknown as RelayPool,
      signer: aliceSigner,
      decryptionCache: cache,
      timeout: 5,
    });
    const session = (await firstValueFrom(protocol.session$))!;
    try {
      const prepared = await firstValueFrom(
        session.prepareSend$({ recipients: [alice], content: "note to self" }, context),
      );
      expect(cache.setItem).toHaveBeenCalledTimes(protocolId === "nip04" ? 1 : 2);
      await firstValueFrom(prepared.publish$);
    } finally {
      protocol.close?.();
    }

    const decrypt = vi.spyOn(aliceSigner[protocolId === "nip04" ? "nip04" : "nip44"], "decrypt");
    const restored = reader(publish.mock.calls[0][1], cache);
    try {
      expect(await restored.read()).toEqual([expect.objectContaining({ content: "note to self", status: "sent" })]);
      expect(decrypt).not.toHaveBeenCalled();
    } finally {
      restored.protocol.close?.();
    }
  });

  it("shares pending cache lookup and decryption between readers", async () => {
    const { cache } = memoryCache();
    let finishLookup!: (value: null) => void;
    cache.getItem.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishLookup = resolve;
        }),
    );
    const state = reader(await incoming(), cache);
    const decrypt = vi.spyOn(aliceSigner[protocolId === "nip04" ? "nip04" : "nip44"], "decrypt");
    try {
      const first = state.read();
      const second = state.read();
      await vi.waitFor(() => expect(cache.getItem).toHaveBeenCalledTimes(1));
      expect(decrypt).not.toHaveBeenCalled();
      finishLookup(null);
      const results = await Promise.all([first, second]);
      expect(results[0]).toEqual(results[1]);
      expect(results[0]).toHaveLength(1);
      expect(decrypt).toHaveBeenCalledTimes(protocolId === "nip04" ? 1 : 2);
    } finally {
      state.protocol.close?.();
    }
  });

  it("continues to decrypt without a persistent cache", async () => {
    const state = reader(await incoming());
    try {
      expect(await state.read()).toEqual([expect.objectContaining({ content: "hello" })]);
    } finally {
      state.protocol.close?.();
    }
  });
});

describe("NIP-17 partial cache", () => {
  it.each(["seal signature", "rumor author"])("rejects cached content with an invalid %s", async (invalid) => {
    const template = { kind: 14, pubkey: bob, created_at: unixNow(), tags: [["p", alice]], content: "private" };
    const rumor = { ...template, id: getEventHash(template) };
    const event = await GiftWrapFactory.create(bobSigner, alice, rumor);
    const seal = getGiftWrapSeal(event)!;
    const { cache, entries } = memoryCache();
    if (invalid === "seal signature") {
      entries.set(event.id, JSON.stringify({ ...seal, sig: "0".repeat(128) }));
    } else {
      entries.set(event.id, JSON.stringify(seal));
      const forgedTemplate = { ...template, pubkey: alice };
      entries.set(seal.id, JSON.stringify({ ...forgedTemplate, id: getEventHash(forgedTemplate) }));
    }

    internalGiftWrapEvents.removeByFilters({});
    const eventStore = new EventStore();
    eventStore.add(JSON.parse(JSON.stringify(event)));
    const decrypt = vi.spyOn(aliceSigner.nip44, "decrypt");
    const protocol = createWrappedMessageProtocol({
      eventStore,
      pool: {
        relay: () => ({ getSupported: async () => [], request: () => EMPTY }),
        req: () => new Subject(),
      } as unknown as RelayPool,
      signer: aliceSigner,
      decryptionCache: cache,
      timeout: 5,
    });
    try {
      const session = (await firstValueFrom(protocol.session$))!;
      const messages = await firstValueFrom(session.messages$({ ...context, history: true }).pipe(toArray()));
      if (invalid === "seal signature") {
        expect(messages).toEqual([]);
        expect(decrypt).not.toHaveBeenCalled();
      } else {
        // The unlock helper can recover an invalid cached rumor by decrypting the authenticated seal.
        expect(messages).toEqual([expect.objectContaining({ senderPubkey: bob, content: "private" })]);
        expect(decrypt).toHaveBeenCalledTimes(1);
      }
    } finally {
      protocol.close?.();
    }
  });

  it("decrypts only the missing seal layer", async () => {
    const template = { kind: 14, pubkey: bob, created_at: unixNow(), tags: [["p", alice]], content: "partial" };
    const event = await GiftWrapFactory.create(bobSigner, alice, { ...template, id: getEventHash(template) });
    const seal = getGiftWrapSeal(event)!;
    const { cache, entries } = memoryCache();
    entries.set(event.id, JSON.stringify(seal));
    internalGiftWrapEvents.removeByFilters({});
    const eventStore = new EventStore();
    eventStore.add(JSON.parse(JSON.stringify(event)));
    const decrypt = vi.spyOn(aliceSigner.nip44, "decrypt");
    const protocol = createWrappedMessageProtocol({
      eventStore,
      pool: {
        relay: () => ({ getSupported: async () => [], request: () => EMPTY }),
        req: () => new Subject(),
      } as unknown as RelayPool,
      signer: aliceSigner,
      decryptionCache: cache,
      timeout: 5,
    });
    try {
      const session = (await firstValueFrom(protocol.session$))!;
      const messages = await firstValueFrom(session.messages$({ ...context, history: true }).pipe(toArray()));
      expect(messages).toEqual([expect.objectContaining({ content: "partial" })]);
      expect(decrypt).toHaveBeenCalledTimes(1);
      expect(entries.has(seal.id)).toBe(true);
    } finally {
      protocol.close?.();
    }
  });
});
