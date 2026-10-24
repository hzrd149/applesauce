import type { DmSendRequest } from "@kehto/services";
import { EventStore } from "applesauce-core";
import { finalizeEvent, kinds, npubEncode, unixNow } from "applesauce-core/helpers";
import { getConversationParticipants, unlockGiftWrap } from "applesauce-common/helpers";
import type { RelayPool } from "applesauce-relay";
import { PrivateKeySigner } from "applesauce-signers";
import { BehaviorSubject, EMPTY, firstValueFrom, from, NEVER, of, Subject, throwError } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createLegacyMessageProtocol,
  createMultiProtocolDmAdapter,
  createWrappedMessageProtocol,
  DmPublicationError,
  useProtocol,
  type DmProtocolAdapter,
  type DmProtocolMessage,
  type DmProtocolSession,
  type KehtoDmOptions,
} from "../kehto/services/dm.js";

const aliceKey = new Uint8Array(32).fill(1);
const bobKey = new Uint8Array(32).fill(2);
const aliceSigner = new PrivateKeySigner(aliceKey);
const bobSigner = new PrivateKeySigner(bobKey);
const alice = await aliceSigner.getPublicKey();
const bob = await bobSigner.getPublicKey();
const cleanup: (() => void)[] = [];

afterEach(() => {
  cleanup.splice(0).forEach((close) => close());
  vi.restoreAllMocks();
});

function compose(protocols: DmProtocolAdapter[], options: Partial<KehtoDmOptions> = {}) {
  const adapter = createMultiProtocolDmAdapter({ protocols, routingTimeout: 100, ...options });
  cleanup.push(() => adapter.close?.());
  return adapter;
}

function message(id: string): DmProtocolMessage {
  return { id, participants: [alice, bob], senderPubkey: bob, createdAt: 10, content: id, status: "received" };
}

function memoryProtocol(id: string, messages: DmProtocolMessage[] = []) {
  const live = new Subject<DmProtocolMessage>();
  const read = vi.fn((context) => (context.history ? from(messages) : live));
  const session: DmProtocolSession = {
    ownerPubkey: alice,
    messages$: read,
    discover$: () => of({ canSend: true, support: "supported" }),
    prepareSend$: () => EMPTY,
  };
  const session$ = new BehaviorSubject<DmProtocolSession | undefined>(session);
  const protocol: DmProtocolAdapter = { id, session$ };
  return { protocol, session, session$, live, read };
}

function nostr() {
  const eventStore = new EventStore();
  const pool = {
    req: vi.fn(() => new Subject()),
    publish: vi.fn(async (relays: string[], _event: unknown) => relays.map((from) => ({ from, ok: true }))),
  };
  const advertise = (key: Uint8Array, tags: string[][], kind = kinds.DirectMessageRelaysList) =>
    eventStore.add(finalizeEvent({ kind, created_at: unixNow(), tags, content: "" }, key));
  const config = {
    eventStore,
    pool: pool as unknown as RelayPool,
    signer: aliceSigner,
    timeout: 5,
    fallbackRelays: ["wss://fallback.test/"],
  };
  return { config, eventStore, pool, advertise };
}

function wrapped(options: Partial<KehtoDmOptions> = {}) {
  const state = nostr();
  state.advertise(aliceKey, [["relay", "wss://sender.test/"]]);
  state.advertise(bobKey, [["relay", "wss://recipient.test/"]]);
  const protocol = createWrappedMessageProtocol(state.config);
  const dm = compose([protocol], { routeSend: useProtocol("nip17"), ...options });
  return { ...state, protocol, dm };
}

describe("DM recipient integrity and relay policy", () => {
  it("preserves mention text without adding conversation participants", async () => {
    const { dm, pool } = wrapped();
    const mentioned = await new PrivateKeySigner(new Uint8Array(32).fill(3)).getPublicKey();
    const content = `hello @${npubEncode(mentioned)}`;
    const sent = await dm.send({ recipients: [bob], content });
    const event = pool.publish.mock.calls[0][1];
    const rumor = await unlockGiftWrap(event as Parameters<typeof unlockGiftWrap>[0], bobSigner);
    expect(getConversationParticipants(rumor).sort()).toEqual([alice, bob].sort());
    expect(rumor.content).toBe(content);
    expect(sent.message.content).toBe(rumor.content);
    const history = await dm.messages({ conversationId: sent.message.conversationId });
    expect(history.messages).toContainEqual(sent.message);
  });

  it.each([undefined, []])(
    "refuses wrapped fallback publication for absent or empty advertisements: %s",
    async (tags) => {
      const { config, advertise, pool } = nostr();
      advertise(aliceKey, [["relay", "wss://sender.test/"]]);
      if (tags) advertise(bobKey, tags);
      const dm = compose([createWrappedMessageProtocol(config)], { routeSend: useProtocol("nip17") });
      await expect(dm.send({ recipients: [bob], content: "private" })).rejects.toThrow("Ineligible");
      expect(pool.publish).not.toHaveBeenCalled();
    },
  );

  it("preflights the sender backup before approval or signing", async () => {
    const { config, advertise, pool } = nostr();
    advertise(bobKey, [["relay", "wss://recipient.test/"]]);
    const approve = vi.fn(() => true);
    const sign = vi.spyOn(aliceSigner, "signEvent");
    const dm = compose([createWrappedMessageProtocol({ ...config, approve })], { routeSend: useProtocol("nip17") });
    await expect(dm.send({ recipients: [bob], content: "private" })).rejects.toThrow("Ineligible");
    expect(approve).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
    expect(pool.publish).not.toHaveBeenCalled();
  });

  it("allows explicit legacy routing to advertised DM relays without treating them as legacy support", async () => {
    const { config, advertise, pool } = nostr();
    advertise(bobKey, [["relay", "wss://recipient.test/"]]);
    const protocol = createLegacyMessageProtocol({ ...config, fallbackRelays: [] });
    const session = await firstValueFrom(protocol.session$);
    const availability = await firstValueFrom(
      session!.discover$({ recipients: [bob], content: "hello" }, { signal: new AbortController().signal }),
    );
    expect(availability).toMatchObject({ canSend: true, support: "unknown" });
    const dm = compose([protocol], { routeSend: useProtocol("nip04") });
    expect((await dm.send({ recipients: [bob], content: "hello" })).ok).toBe(true);
    expect(pool.publish.mock.calls[0][0]).toEqual(["wss://recipient.test/"]);
  });
});

describe("wrapped partial publication", () => {
  it("reports every outcome, attempts later recipients, and retries only rejected envelopes", async () => {
    const { dm, pool, advertise } = wrapped();
    const charlieKey = new Uint8Array(32).fill(3);
    const charlie = await new PrivateKeySigner(charlieKey).getPublicKey();
    advertise(charlieKey, [["relay", "wss://third.test/"]]);
    pool.publish.mockImplementationOnce(async (relays) => [{ from: relays[0], ok: false }]);
    const request: DmSendRequest = { recipients: [bob, charlie], content: "hello", clientMessageId: "retry-me" };
    const failure = await dm.send(request).catch((error) => error);
    expect(failure).toBeInstanceOf(DmPublicationError);
    expect(failure.publications.map((entry: { accepted: boolean }) => entry.accepted)).toEqual([false, true, true]);
    expect(pool.publish).toHaveBeenCalledTimes(3);
    const firstEnvelope = pool.publish.mock.calls[0][1];
    const sent = await dm.send(request);
    expect(pool.publish).toHaveBeenCalledTimes(4);
    expect(pool.publish.mock.calls[3][1]).toBe(firstEnvelope);
    expect(sent.message.id).toBe(`nip17:${failure.protocolMessage.id}`);
    expect((await dm.send(request)).message).toEqual(sent.message);
    expect(pool.publish).toHaveBeenCalledTimes(4);
  });

  it("rejects reusing a client id for different content", async () => {
    const { dm, pool } = wrapped();
    await dm.send({ recipients: [bob], content: "first", clientMessageId: "same" });
    await expect(dm.send({ recipients: [bob], content: "second", clientMessageId: "same" })).rejects.toThrow(
      "another message",
    );
    expect(pool.publish).toHaveBeenCalledTimes(2);
  });

  it("scopes client ids to the requesting window", async () => {
    let windowId = "first";
    const { dm, pool } = wrapped({ getWindowId: () => windowId });
    await dm.send({ recipients: [bob], content: "first window", clientMessageId: "same" });
    windowId = "second";
    await dm.send({ recipients: [bob], content: "second window", clientMessageId: "same" });
    expect(pool.publish).toHaveBeenCalledTimes(4);
  });

  it("does not publish duplicate envelopes for concurrent retries", async () => {
    const { dm, pool } = wrapped();
    let finish!: (results: { from: string; ok: boolean }[]) => void;
    pool.publish.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const request = { recipients: [bob], content: "hello", clientMessageId: "concurrent" };
    const sending = dm.send(request);
    await vi.waitFor(() => expect(pool.publish).toHaveBeenCalledTimes(1));
    await expect(dm.send(request)).rejects.toThrow("already being published");
    expect(pool.publish).toHaveBeenCalledTimes(1);
    finish([{ from: "wss://recipient.test/", ok: true }]);
    expect((await sending).ok).toBe(true);
    expect(pool.publish).toHaveBeenCalledTimes(2);
  });

  it("does not add rejected envelopes to the shared store", async () => {
    const { dm, pool, eventStore } = wrapped();
    pool.publish.mockImplementation(async (relays) => [{ from: relays[0], ok: false }]);
    await expect(dm.send({ recipients: [bob], content: "not sent" })).rejects.toBeInstanceOf(DmPublicationError);
    expect([...eventStore.getByFilters({ kinds: [kinds.GiftWrap] })]).toEqual([]);
  });
});

describe("multi-protocol resilience and history", () => {
  it("keeps healthy live delivery running while reconnecting a failed protocol", async () => {
    const healthy = memoryProtocol("healthy");
    const recovering = memoryProtocol("recovering");
    const first = new Subject<DmProtocolMessage>();
    recovering.read.mockImplementationOnce(() => first);
    const onProtocolError = vi.fn();
    const dm = compose([healthy.protocol, recovering.protocol], { retryDelay: 1, onProtocolError });
    const receive = vi.fn();
    await dm.subscribe({}, receive);
    first.error(new Error("offline"));
    healthy.live.next(message("healthy"));
    expect(healthy.live.observed).toBe(true);
    expect(onProtocolError).toHaveBeenCalledWith(
      expect.objectContaining({ protocol: "recovering", operation: "subscribe" }),
    );
    await vi.waitFor(() => expect(recovering.live.observed).toBe(true));
    recovering.live.next(message("reconnected"));
    expect(receive.mock.calls.map(([event]) => event.content)).toEqual(["healthy", "reconnected"]);
  });

  it("returns healthy history when another backend fails and retries that backend next time", async () => {
    const healthy = memoryProtocol("healthy", [message("available")]);
    const failed = memoryProtocol("failed");
    failed.read.mockImplementation(() => throwError(() => new Error("offline")));
    const onProtocolError = vi.fn();
    const dm = compose([healthy.protocol, failed.protocol], { onProtocolError });
    const conversations = await dm.conversations();
    const page = await dm.messages({ conversationId: conversations.conversations[0].id });
    expect(page.messages[0].content).toBe("available");
    expect(healthy.read).toHaveBeenCalledTimes(1);
    expect(failed.read).toHaveBeenCalledTimes(2);
    expect(onProtocolError).toHaveBeenCalledTimes(2);
  });

  it("contains failures from the host error callback", async () => {
    const healthy = memoryProtocol("healthy", [message("available")]);
    const failed = memoryProtocol("failed");
    failed.read.mockImplementation(() => throwError(() => new Error("offline")));
    const dm = compose([healthy.protocol, failed.protocol], {
      onProtocolError: () => {
        throw new Error("host callback failed");
      },
    });
    expect((await dm.conversations()).conversations).toHaveLength(1);
  });

  it("bounds a stalled history independently of healthy protocols", async () => {
    const healthy = memoryProtocol("healthy", [message("available")]);
    const stalled = memoryProtocol("stalled");
    stalled.read.mockImplementation(() => NEVER);
    const dm = compose([healthy.protocol, stalled.protocol], { operationTimeout: 10 });
    expect((await dm.conversations()).conversations).toHaveLength(1);
  });

  it("reuses history across pages and includes live updates in cached queries", async () => {
    const custom = memoryProtocol("custom", [message("first"), message("second")]);
    const dm = compose([custom.protocol]);
    const conversationId = (await dm.conversations()).conversations[0].id;
    const first = await dm.messages({ conversationId, limit: 1 });
    await dm.messages({ conversationId, cursor: first.cursor, limit: 1 });
    expect(custom.read).toHaveBeenCalledTimes(1);
    await dm.subscribe({}, vi.fn());
    custom.live.next(message("live"));
    expect((await dm.messages({ conversationId })).messages).toHaveLength(3);
    expect(custom.read).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent history reads without cancelling another reader", async () => {
    const custom = memoryProtocol("custom");
    const history = new Subject<DmProtocolMessage>();
    custom.read.mockImplementation(() => history);
    const dm = compose([custom.protocol]);
    const first = dm.conversations();
    const second = dm.conversations();
    await vi.waitFor(() => expect(custom.read).toHaveBeenCalledTimes(1));
    history.next(message("shared"));
    history.complete();
    expect((await first).conversations).toHaveLength(1);
    expect((await second).conversations).toHaveLength(1);
  });

  it("refreshes expired history and isolates replacement account sessions", async () => {
    const custom = memoryProtocol("custom", [message("old")]);
    const dm = compose([custom.protocol], { historyMaxAge: 0 });
    await dm.conversations();
    await dm.conversations();
    expect(custom.read).toHaveBeenCalledTimes(2);
    custom.session$.next({ ...custom.session, messages$: () => of(message("new")) });
    const conversationId = (await dm.conversations()).conversations[0].id;
    expect((await dm.messages({ conversationId })).messages.map((entry) => entry.content)).toEqual(["new"]);
  });
});
