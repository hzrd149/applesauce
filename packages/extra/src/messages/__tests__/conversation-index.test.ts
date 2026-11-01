import { EventStore } from "applesauce-core";
import { finalizeEvent, kinds, type NostrEvent } from "applesauce-core/helpers";
import { createConversationIdentifier } from "applesauce-common/helpers";
import { PrivateKeySigner } from "applesauce-signers";
import type { RelayPool } from "applesauce-relay";
import { firstValueFrom, of } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { LegacyMessagesClient, type MessageStorage } from "../index.js";

const ownerKey = new Uint8Array(32).fill(1);
const peerKey = new Uint8Array(32).fill(2);
const owner = await new PrivateKeySigner(ownerKey).getPublicKey();
const peer = await new PrivateKeySigner(peerKey).getPublicKey();

describe("legacy conversation index", () => {
  it.each(["read", "parse"])(
    "captures index %s failures and clears them after successful restoration",
    async (operation) => {
      const failure = new Error("storage offline");
      const getItem = vi.fn(() => JSON.stringify({ version: 1, correspondents: [peer] }));
      if (operation === "read")
        getItem.mockImplementationOnce(() => {
          throw failure;
        });
      else getItem.mockReturnValueOnce("invalid JSON");
      const storage: MessageStorage = { getItem, setItem: vi.fn(), removeItem: vi.fn() };
      const client = new LegacyMessagesClient({
        pubkey: owner,
        eventStore: new EventStore(),
        pool: {} as RelayPool,
        conversationStorage: storage,
      });
      try {
        expect(await firstValueFrom(client.conversations$)).toEqual([]);
        const error = await firstValueFrom(client.conversationStorageError$);
        if (operation === "read") expect(error).toBe(failure);
        else expect(error).toBeInstanceOf(SyntaxError);

        expect(await firstValueFrom(client.conversations$)).toHaveLength(1);
        expect(await firstValueFrom(client.conversationStorageError$)).toBeUndefined();
      } finally {
        client.dispose();
      }
    },
  );

  it("captures index write failures and clears them after a successful write", async () => {
    const failure = new Error("write failed");
    const setItem = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(undefined);
    const eventStore = new EventStore();
    const client = new LegacyMessagesClient({
      pubkey: owner,
      eventStore,
      pool: {} as RelayPool,
      conversationStorage: { getItem: () => null, setItem, removeItem: vi.fn() },
    });
    try {
      const message = (created_at: number) =>
        finalizeEvent(
          { kind: kinds.EncryptedDirectMessage, created_at, tags: [["p", owner]], content: "encrypted" },
          peerKey,
        );
      eventStore.add(message(1));
      await vi.waitFor(async () => expect(await firstValueFrom(client.conversationStorageError$)).toBe(failure));
      eventStore.add(message(2));
      await vi.waitFor(() => expect(setItem).toHaveBeenCalledTimes(2));
      expect(await firstValueFrom(client.conversationStorageError$)).toBeUndefined();
      expect(await firstValueFrom(client.conversations$)).toHaveLength(1);
    } finally {
      client.dispose();
    }
  });

  it("persists one account-scoped list and restores conversations before messages load", async () => {
    const values = new Map<string, string>();
    const storage: MessageStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    };
    const pool = { subscription: vi.fn(() => of()) } as unknown as RelayPool;
    const eventStore = new EventStore();
    const client = new LegacyMessagesClient({ pubkey: owner, eventStore, pool, conversationStorage: storage });

    const message: NostrEvent = finalizeEvent(
      { kind: kinds.EncryptedDirectMessage, created_at: 1, tags: [["p", owner]], content: "encrypted" },
      peerKey,
    );
    eventStore.add(message);

    await vi.waitFor(() => expect(values.has(`conversations:${owner}`)).toBe(true));
    expect(JSON.parse(values.get(`conversations:${owner}`)!)).toEqual({ version: 1, correspondents: [peer] });
    client.dispose();

    const restored = new LegacyMessagesClient({
      pubkey: owner,
      eventStore: new EventStore(),
      pool,
      conversationStorage: storage,
    });
    const conversations = await firstValueFrom(restored.conversations$);
    expect(conversations).toEqual([
      { id: createConversationIdentifier(owner, peer), participants: [owner, peer], lastMessage: undefined },
    ]);
    restored.dispose();
  });
});
