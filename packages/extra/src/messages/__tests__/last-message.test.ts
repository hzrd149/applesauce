import { EventStore } from "applesauce-core";
import { finalizeEvent, getEncryptedContent, kinds } from "applesauce-core/helpers";
import { PrivateKeySigner } from "applesauce-signers";
import type { RelayPool } from "applesauce-relay";
import { of, throwError } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { LegacyMessagesClient } from "../index.js";

const ownerKey = new Uint8Array(32).fill(1);
const peerKey = new Uint8Array(32).fill(2);
const owner = await new PrivateKeySigner(ownerKey).getPublicKey();
const peer = await new PrivateKeySigner(peerKey).getPublicKey();

function message(createdAt: number, outgoing = false) {
  return finalizeEvent(
    {
      kind: kinds.EncryptedDirectMessage,
      created_at: createdAt,
      tags: [["p", outgoing ? peer : owner]],
      content: "encrypted",
    },
    outgoing ? ownerKey : peerKey,
  );
}

function dependencies() {
  const pool = {
    request: vi.fn(() => {
      throw new Error("Unexpected network request");
    }),
    subscription: vi.fn(() => {
      throw new Error("Unexpected network subscription");
    }),
  };
  return { eventStore: new EventStore(), pool: pool as unknown as RelayPool, network: pool };
}

describe("legacy lastMessage$", () => {
  it("reads memory immediately without a configured cache and completes on disposal", () => {
    const { eventStore, pool, network } = dependencies();
    const newest = message(30);
    eventStore.add(newest);
    eventStore.add(message(10, true));
    const client = new LegacyMessagesClient({ pubkey: owner, eventStore, pool });
    const conversation = client.conversation(peer);
    const values: unknown[] = [];
    const subscription = conversation.lastMessage$.subscribe((value) => values.push(value));
    expect(values).toEqual([newest]);
    client.dispose();
    expect(subscription.closed).toBe(true);
    expect(conversation.lastMessage$.subscribe().closed).toBe(true);
    expect(network.request).not.toHaveBeenCalled();
    expect(network.subscription).not.toHaveBeenCalled();
  });

  it("lazily hydrates both directions, restores plaintext and shares work without networking or signing", async () => {
    const { eventStore, pool, network } = dependencies();
    const incoming = message(10);
    const outgoing = message(20, true);
    const cacheRequest = vi.fn(() => of(incoming, outgoing));
    const getItem = vi.fn(async () => "cached plaintext");
    const decrypt = vi.fn();
    const client = new LegacyMessagesClient({
      pubkey: owner,
      eventStore,
      pool,
      cacheRequest,
      signer: { getPublicKey: async () => owner, nip04: { decrypt, encrypt: vi.fn() } },
      autoUnlock: true,
      decryptionCache: { getItem, setItem: vi.fn() },
    });
    const conversation = client.conversation(peer);
    expect(cacheRequest).not.toHaveBeenCalled();

    const values: unknown[] = [];
    const subscription = conversation.lastMessage$.subscribe((event) => values.push(event));
    const second = conversation.lastMessage$.subscribe();
    await vi.waitFor(() => expect(getEncryptedContent(outgoing)).toBe("cached plaintext"));
    expect(values.at(-1)).toBe(outgoing);
    expect(cacheRequest).toHaveBeenCalledTimes(1);
    expect(cacheRequest.mock.calls[0][0]).toEqual([
      { kinds: [4], "#p": [owner], authors: [peer], limit: 1 },
      { kinds: [4], authors: [owner], "#p": [peer], limit: 1 },
    ]);

    const newer = message(30);
    eventStore.add(newer);
    await vi.waitFor(() => expect(values.at(-1)).toBe(newer));
    expect(decrypt).not.toHaveBeenCalled();
    expect(network.request).not.toHaveBeenCalled();
    expect(network.subscription).not.toHaveBeenCalled();
    client.dispose();
    expect(subscription.closed).toBe(true);
    expect(second.closed).toBe(true);
  });

  it("keeps observing memory after a cache failure and reports the error", async () => {
    const { eventStore, pool, network } = dependencies();
    const error = new Error("Cache unavailable");
    const client = new LegacyMessagesClient({
      pubkey: owner,
      eventStore,
      pool,
      cacheRequest: () => throwError(() => error),
    });
    const conversation = client.conversation(peer);
    const errors: unknown[] = [];
    conversation.errors$.subscribe((value) => errors.push(value));
    const values: unknown[] = [];
    conversation.lastMessage$.subscribe((value) => values.push(value));
    expect(values).toEqual([undefined]);
    expect(errors).toContainEqual({ operation: "restore", error });
    const newest = message(30);
    eventStore.add(newest);
    eventStore.add(message(10));
    await vi.waitFor(() => expect(values.at(-1)).toBe(newest));
    expect(network.request).not.toHaveBeenCalled();
    expect(network.subscription).not.toHaveBeenCalled();
    client.dispose();
  });
});
