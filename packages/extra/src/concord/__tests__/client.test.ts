// ConcordClient over dependency-injected EventStore/RelayPool/storage — no
// network. A fake pool (empty request/subscription streams) exercises the fold +
// optimistic local-echo path and the pluggable storage; live relay behaviour is
// covered by the Phase 5 puppeteer drivers.

import { describe, expect, it } from "vitest";
import { BehaviorSubject, EMPTY, NEVER, Subject } from "rxjs";
import { generateSecretKey } from "nostr-tools";
import { PrivateKeySigner } from "applesauce-signers";
import { EventStore } from "applesauce-core";
import type { RelayPool } from "applesauce-relay";

import { ConcordClient } from "../client.js";
import { memoryStorage } from "../storage.js";

// The control fold is debounced (~60ms); let it run before asserting state.
const settle = () => new Promise((r) => setTimeout(r, 150));

// A RelayPool stand-in whose request/subscription streams are inert (no sockets).
function fakePool(): RelayPool {
  const relay = {
    url: "wss://fake",
    challenge: null,
    challenge$: new BehaviorSubject<string | null>(null),
    isAuthenticated: () => false,
    authenticate: async () => ({ ok: true }),
  };
  return {
    status$: new Subject(),
    relay: () => relay,
    subscription: () => NEVER,
    request: () => EMPTY,
    publish: async () => [],
  } as unknown as RelayPool;
}

async function makeClient(storage = memoryStorage()) {
  const signer = new PrivateKeySigner(generateSecretKey());
  const pubkey = await signer.getPublicKey();
  const client = new ConcordClient({
    signer,
    pubkey,
    eventStore: new EventStore(),
    pool: fakePool(),
    storage,
    relays: ["wss://fake"],
  });
  return { client, pubkey, storage };
}

describe("ConcordClient (DI, no network)", () => {
  it("founds a community and reflects genesis + chat via optimistic local echo", async () => {
    const { client, pubkey } = await makeClient();
    const cid = await client.createNewCommunity("Test", "hi", ["wss://fake"]);
    await settle();

    const state$ = client.getState$(cid)!;
    expect(state$.value.metadata?.name).toBe("Test");
    const general = state$.value.channels.find((c) => c.name === "general");
    expect(general).toBeDefined();
    expect(state$.value.members.has(pubkey)).toBe(true); // owner is a member

    const messages$ = client.getMessages$(cid, general!.channel_id);
    await client.sendMessage(cid, general!.channel_id, "hello world");
    expect(messages$.value.some((m) => m.content === "hello world" && m.author === pubkey)).toBe(true);

    client.stop();
    expect(client.communities$.value).toEqual([]);
  });

  it("sending a file without an uploader throws", async () => {
    const { client } = await makeClient();
    const cid = await client.createNewCommunity("T", "", ["wss://fake"]);
    await settle();
    const chId = client.getState$(cid)!.value.channels[0].channel_id;
    await expect(client.sendMessage(cid, chId, "x", undefined, [new Blob(["z"])])).rejects.toThrow(/uploader/);
    client.stop();
  });

  it("persists memberships + decoded rumors across a restart via injected storage", async () => {
    const storage = memoryStorage();
    const { client, pubkey } = await makeClient(storage);
    const cid = await client.createNewCommunity("Persisted", "d", ["wss://fake"]);
    await settle();
    client.stop(); // flushes the pending cache write

    // A fresh client with the SAME storage rehydrates without any network.
    const signer2 = new PrivateKeySigner(generateSecretKey());
    const client2 = new ConcordClient({
      signer: signer2,
      pubkey, // same account
      eventStore: new EventStore(),
      pool: fakePool(),
      storage,
      relays: ["wss://fake"],
    });
    await client2.start();
    await settle();

    const state = client2.getState$(cid)?.value;
    expect(state?.metadata?.name).toBe("Persisted");
    expect(state?.channels.some((c) => c.name === "general")).toBe(true);
    expect(state?.members.has(pubkey)).toBe(true);
    client2.stop();
  });
});
