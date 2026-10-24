import { type DmSendRequest } from "@kehto/services";
import { EventStore } from "applesauce-core";
import { finalizeEvent, kinds, unixNow } from "applesauce-core/helpers";
import type { RelayPool } from "applesauce-relay";
import { PrivateKeySigner } from "applesauce-signers";
import { LegacyMessageFactory } from "applesauce-common/factories";
import { unlockLegacyMessage } from "applesauce-common/helpers";
import { BehaviorSubject, defer, from, NEVER, of, Subject } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDmOptions,
  createLegacyMessageProtocol,
  createWrappedMessageProtocol,
  firstMatchingRoute,
  useLastMessageProtocol,
  useProtocol,
  useProtocolWhenSupported,
  defaultDmRouter,
  type DmOperationContext,
  type DmProtocolAdapter,
  type DmProtocolMessage,
  type DmProtocolSession,
} from "../kehto/services/dm.js";

const aliceKey = new Uint8Array(32).fill(1);
const aliceSigner = new PrivateKeySigner(aliceKey);
const bobSigner = new PrivateKeySigner(new Uint8Array(32).fill(2));
const alice = await aliceSigner.getPublicKey();
const bob = await bobSigner.getPublicKey();
const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((close) => close());
});

function message(id: string, createdAt = 10): DmProtocolMessage {
  return { id, createdAt, participants: [alice, bob], senderPubkey: bob, content: id, status: "received" };
}

function memoryProtocol(id: string, history: DmProtocolMessage[] = [], supported = true) {
  const live = new Subject<DmProtocolMessage>();
  const publish = vi.fn();
  const prepare = vi.fn((request: DmSendRequest, context: DmOperationContext) => {
    const sent: DmProtocolMessage = {
      id: "sent",
      createdAt: 100,
      senderPubkey: alice,
      content: request.content,
      status: "sent",
      participants: [...new Set([alice, ...request.recipients])],
    };
    return of({
      message: sent,
      publish$: defer(() => {
        context.signal.throwIfAborted();
        publish();
        return of(sent);
      }),
    });
  });
  const session: DmProtocolSession = {
    ownerPubkey: alice,
    discover$: vi.fn(() => of({ canSend: true, support: supported ? "supported" : "unknown" })),
    messages$: (context) => (context.history ? from(history) : live),
    prepareSend$: prepare,
  };
  const session$ = new BehaviorSubject<DmProtocolSession | undefined>(session);
  const protocol: DmProtocolAdapter = { id, session$, close: vi.fn() };
  return { protocol, session, session$, live, publish, prepare };
}

function compose(protocols: DmProtocolAdapter[], options: Partial<Parameters<typeof createDmOptions>[0]> = {}) {
  const dm = createDmOptions({ protocols, routingTimeout: 30, ...options }).adapter;
  cleanup.push(() => dm.close?.());
  return dm;
}

function nostr() {
  const eventStore = new EventStore();
  const pool = {
    req: vi.fn(() => new Subject()),
    publish: vi.fn(async (relays: string[]) => relays.map((from) => ({ from, ok: true }))),
  };
  const config = {
    eventStore,
    pool: pool as unknown as RelayPool,
    signer: aliceSigner,
    timeout: 15,
    fallbackRelays: ["wss://fallback.test/"],
  };
  const relayList = (signerKey: Uint8Array, kind: number, tags: string[][]) =>
    eventStore.add(
      finalizeEvent(
        {
          kind,
          created_at: unixNow(),
          tags,
          content: "",
        },
        signerKey,
      ),
    );
  relayList(aliceKey, kinds.DirectMessageRelaysList, [["relay", "wss://sender.test/"]]);
  return { config, eventStore, pool, relayList };
}

describe("composable DM protocols", () => {
  it("supports a custom-only protocol with no store, pool, or signer", async () => {
    const custom = memoryProtocol("custom-chat");
    const dm = compose([custom.protocol], { routeSend: useProtocol("custom-chat") });
    expect(await dm.status()).toMatchObject({ available: true, implementations: ["custom-chat"] });
    expect((await dm.send({ recipients: [bob], content: "hello" })).message.content).toBe("hello");
    expect(custom.publish).toHaveBeenCalledTimes(1);
  });

  it("allows no protocols without creating implicit implementations", async () => {
    const dm = compose([]);
    expect(await dm.status()).toMatchObject({ available: false, implementations: [] });
    expect((await dm.conversations()).conversations).toEqual([]);
    await expect(dm.send({ recipients: [bob], content: "hello" })).rejects.toThrow("No available");
  });

  it("rejects ambiguous protocol identifiers", () => {
    const custom = memoryProtocol("custom");
    expect(() => compose([custom.protocol, custom.protocol])).toThrow("unique");
  });

  it("prefers detected custom support over NIP-17 and uses the default when unknown", async () => {
    const { config, relayList } = nostr();
    relayList(new Uint8Array(32).fill(2), kinds.DirectMessageRelaysList, [["relay", "wss://wrapped.test/"]]);
    const custom = memoryProtocol("custom");
    const dm = compose([custom.protocol, createWrappedMessageProtocol(config)], {
      routeSend: firstMatchingRoute(useProtocolWhenSupported("custom"), defaultDmRouter),
    });
    const request = { recipients: [bob], content: "hello" };
    expect((await dm.send(request)).message.id).toBe("custom:sent");
    expect(custom.publish).toHaveBeenCalledTimes(1);

    const unknown = memoryProtocol("custom", [], false);
    const fallbackDm = compose([unknown.protocol, createWrappedMessageProtocol(config)], {
      routeSend: firstMatchingRoute(useProtocolWhenSupported("custom"), defaultDmRouter),
    });
    expect((await fallbackDm.send(request)).message.id).toMatch(/^nip17:/);
    expect(unknown.publish).not.toHaveBeenCalled();
  });

  it("merges protocol history with collision-safe ids and routes by the latest observed message", async () => {
    const wrapped = memoryProtocol("nip17", [message("same", 10)]);
    const custom = memoryProtocol("custom", [message("same", 20)]);
    const dm = compose([wrapped.protocol, custom.protocol]);
    const conversations = (await dm.conversations()).conversations;
    expect(conversations).toHaveLength(1);
    const page = await dm.messages({ conversationId: conversations[0].id });
    expect(page.messages.map((entry) => entry.id)).toEqual(["nip17:same", "custom:same"]);
    const sent = await dm.send({ recipients: [bob], content: "reply" });
    expect(sent.message.id).toBe("custom:sent");
    expect(wrapped.publish).not.toHaveBeenCalled();
  });

  it("can route by the latest incoming message rather than the latest outgoing one", async () => {
    const outgoing = { ...message("outgoing", 50), senderPubkey: alice, status: "sent" as const };
    const wrapped = memoryProtocol("nip17", [outgoing]);
    const custom = memoryProtocol("custom", [message("incoming", 20)]);
    const dm = compose([wrapped.protocol, custom.protocol], {
      routeSend: firstMatchingRoute(useLastMessageProtocol({ direction: "incoming" })),
    });
    await dm.conversations();
    expect((await dm.send({ recipients: [bob], content: "reply" })).message.id).toBe("custom:sent");
  });

  it("bounds unresponsive discovery without preventing another protocol from sending", async () => {
    const stalled = memoryProtocol("stalled");
    stalled.session.discover$ = () => NEVER;
    const custom = memoryProtocol("custom");
    const dm = compose([stalled.protocol, custom.protocol], {
      routeSend: firstMatchingRoute(useProtocolWhenSupported("stalled"), useProtocolWhenSupported("custom")),
    });
    expect((await dm.send({ recipients: [bob], content: "hello" })).message.id).toBe("custom:sent");
  });

  it("rejects invalid router selections before preparing or publishing", async () => {
    const custom = memoryProtocol("custom");
    const dm = compose([custom.protocol], { routeSend: useProtocol("missing") });
    await expect(dm.send({ recipients: [bob], content: "hello" })).rejects.toThrow("Ineligible");
    expect(custom.prepare).not.toHaveBeenCalled();
  });

  it("does not fall back to another protocol after a publication error", async () => {
    const custom = memoryProtocol("custom");
    custom.publish.mockImplementation(() => {
      throw new Error("partial delivery");
    });
    const wrapped = memoryProtocol("nip17");
    const dm = compose([custom.protocol, wrapped.protocol], { routeSend: useProtocol("custom") });
    await expect(dm.send({ recipients: [bob], content: "hello" })).rejects.toThrow("partial delivery");
    expect(wrapped.prepare).not.toHaveBeenCalled();
  });

  it("cancels publication when a custom session changes during preparation", async () => {
    const custom = memoryProtocol("custom");
    const prepared = new Subject<never>();
    let signal: AbortSignal | undefined;
    custom.session.prepareSend$ = (_request, context) => {
      signal = context.signal;
      return prepared;
    };
    const dm = compose([custom.protocol], { routeSend: useProtocol("custom") });
    const sending = dm.send({ recipients: [bob], content: "hello" });
    await vi.waitFor(() => expect(prepared.observed).toBe(true));
    custom.session$.next(undefined);
    await expect(sending).rejects.toThrow("Account changed");
    expect(signal?.aborted).toBe(true);
    expect(prepared.observed).toBe(false);
    expect(custom.publish).not.toHaveBeenCalled();
  });

  it("requires a common owner identity when composing protocols", async () => {
    const first = memoryProtocol("first");
    const second = memoryProtocol("second");
    second.session.ownerPubkey = bob;
    const dm = compose([first.protocol, second.protocol]);
    await expect(dm.conversations()).rejects.toThrow("same owner");
  });

  it("names group conversations consistently across sends and history", async () => {
    const custom = memoryProtocol("custom");
    const dm = compose([custom.protocol], { routeSend: useProtocol("custom") });
    const group = await dm.send({ recipients: [bob, "third"], content: "group" });
    expect(group.message.conversationId).toMatch(/^group:/);
  });
  it("allows explicit custom-only routing when recipient support is unknown", async () => {
    const custom = memoryProtocol("custom", [], false);
    const dm = compose([custom.protocol], { routeSend: useProtocol("custom") });
    expect((await dm.send({ recipients: [bob], content: "hello" })).ok).toBe(true);
  });

  it("bounds a router that never resolves and aborts its operation", async () => {
    const custom = memoryProtocol("custom");
    let signal: AbortSignal | undefined;
    const dm = compose([custom.protocol], {
      routeSend: (context) => {
        signal = context.signal;
        return new Promise(() => {});
      },
    });
    await expect(dm.send({ recipients: [bob], content: "hello" })).rejects.toThrow("Timeout");
    expect(signal?.aborted).toBe(true);
    expect(custom.prepare).not.toHaveBeenCalled();
  });

  it("bounds non-completing custom history and send preparation", async () => {
    const custom = memoryProtocol("custom");
    let signal: AbortSignal | undefined;
    custom.session.messages$ = (context) => {
      signal = context.signal;
      return NEVER;
    };
    custom.session.prepareSend$ = (_request, context) => {
      signal = context.signal;
      return NEVER;
    };
    const dm = compose([custom.protocol], { routeSend: useProtocol("custom"), operationTimeout: 20 });
    await expect(dm.conversations()).rejects.toThrow("Timeout");
    expect(signal?.aborted).toBe(true);
    await expect(dm.send({ recipients: [bob], content: "hello" })).rejects.toThrow("Timeout");
    expect(signal?.aborted).toBe(true);
  });

  it("merges live protocols and cleans up every source when closed", async () => {
    const custom = memoryProtocol("custom");
    const wrapped = memoryProtocol("nip17");
    const dm = compose([custom.protocol, wrapped.protocol]);
    const onMessage = vi.fn();
    await dm.subscribe({}, onMessage);
    custom.live.next(message("custom"));
    wrapped.live.next(message("wrapped"));
    expect(onMessage).toHaveBeenCalledTimes(2);
    dm.close?.();
    expect(custom.live.observed).toBe(false);
    expect(wrapped.live.observed).toBe(false);
    expect(custom.protocol.close).toHaveBeenCalledTimes(1);
    expect(wrapped.protocol.close).toHaveBeenCalledTimes(1);
  });
});

describe("Nostr DM protocols", () => {
  it("routes to advertised wrapped relays before legacy inboxes", async () => {
    const { config, relayList, pool } = nostr();
    relayList(new Uint8Array(32).fill(2), kinds.DirectMessageRelaysList, [["relay", "wss://wrapped.test/"]]);
    relayList(new Uint8Array(32).fill(2), kinds.RelayList, [["r", "wss://legacy.test/", "read"]]);
    const dm = compose([createLegacyMessageProtocol(config), createWrappedMessageProtocol(config)]);
    expect((await dm.send({ recipients: [bob], content: "hello" })).message.id).toMatch(/^nip17:/);
    expect(pool.publish.mock.calls[0][0]).toEqual(["wss://wrapped.test/"]);
  });

  it("routes to legacy inboxes when wrapped support is unknown and round-trips both directions", async () => {
    const { config, eventStore, relayList, pool } = nostr();
    relayList(new Uint8Array(32).fill(2), kinds.RelayList, [["r", "wss://legacy.test/", "read"]]);
    relayList(aliceKey, kinds.RelayList, [["r", "wss://outbox.test/", "write"]]);
    const dm = compose([createWrappedMessageProtocol(config), createLegacyMessageProtocol(config)]);
    const sent = await dm.send({ recipients: [bob], content: "outgoing" });
    expect(sent.message.id).toMatch(/^nip04:/);
    const event = [...eventStore.getByFilters({ kinds: [kinds.EncryptedDirectMessage] })][0];
    expect(await unlockLegacyMessage(event, bob, bobSigner)).toBe("outgoing");
    expect(pool.publish.mock.calls[0][0]).toEqual(["wss://legacy.test/", "wss://outbox.test/"]);
    eventStore.add(await LegacyMessageFactory.create(alice, "incoming").sign(bobSigner));
    const history = await dm.messages({ conversationId: sent.message.conversationId });
    expect(history.messages.map((entry) => entry.content)).toEqual(expect.arrayContaining(["outgoing", "incoming"]));
    expect(history.messages).toContainEqual(sent.message);
  });

  it("supports legacy-only signers and rejects group sends", async () => {
    const { config } = nostr();
    const signer = {
      getPublicKey: () => aliceSigner.getPublicKey(),
      signEvent: aliceSigner.signEvent.bind(aliceSigner),
      nip04: aliceSigner.nip04,
    };
    const dm = compose(
      [createWrappedMessageProtocol({ ...config, signer }), createLegacyMessageProtocol({ ...config, signer })],
      {
        routeSend: useProtocol("nip04"),
      },
    );
    expect((await dm.status()).implementations).toEqual(["nip04"]);
    await expect(dm.send({ recipients: [bob, "f".repeat(64)], content: "group" })).rejects.toThrow("Ineligible");
    expect((await dm.send({ recipients: [bob], content: "direct" })).ok).toBe(true);
  });

  it("does not encrypt or sign a legacy message when approval is denied", async () => {
    const { config, pool } = nostr();
    const encrypt = vi.spyOn(aliceSigner.nip04, "encrypt");
    const sign = vi.spyOn(aliceSigner, "signEvent");
    cleanup.push(() => {
      encrypt.mockRestore();
      sign.mockRestore();
    });
    const dm = compose([createLegacyMessageProtocol({ ...config, approve: () => false })], {
      routeSend: useProtocol("nip04"),
    });
    await expect(dm.send({ recipients: [bob], content: "private" })).rejects.toThrow("User denied");
    expect(encrypt).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
    expect(pool.publish).not.toHaveBeenCalled();
  });
  it("invalidates a closed protocol instead of replaying its previous session", async () => {
    const { config } = nostr();
    const protocol = createWrappedMessageProtocol(config);
    const observed: (DmProtocolSession | undefined)[] = [];
    const subscription = protocol.session$.subscribe((session) => observed.push(session));
    cleanup.push(() => subscription.unsubscribe());
    await vi.waitFor(() => expect(observed.at(-1)?.ownerPubkey).toBe(alice));
    protocol.close?.();
    expect(observed.at(-1)).toBeUndefined();
    const dm = compose([protocol]);
    expect((await dm.status()).available).toBe(false);
  });
});
