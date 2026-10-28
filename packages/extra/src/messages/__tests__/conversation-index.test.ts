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
