import { EventStore } from "applesauce-core";
import { fakeVerifyEvent, finalizeEvent, getPublicKey, type NostrEvent } from "applesauce-core/helpers";
import { RelayGroup, type Relay, type RelayPool, type RelayReqMessage } from "applesauce-relay";
import { PrivateKeySigner } from "applesauce-signers";
import {
  createPersistentNostrOutbox,
  InMemoryStorageAdapter,
  NdrRuntime,
  type NdrRuntimeOptions,
} from "nostr-double-ratchet";
import { EMPTY, Subject, type Observable } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNdrTransport as createKehtoTransport } from "../../../kehto/services/dm/ndr.js";
import { createNdrTransport, type NdrTransport, type NdrTransportOptions } from "../index.js";

const ownerKey = new Uint8Array(32).fill(1);
const deviceKey = new Uint8Array(32).fill(2);
const ownerPubkey = getPublicKey(ownerKey);
const relays = ["wss://ndr.example.com/", "wss://backup.example.com/"];
const transports: NdrTransport[] = [];

function create(overrides: Partial<NdrTransportOptions> = {}) {
  const incoming = new Subject<NostrEvent>();
  const fetched = new Subject<NostrEvent>();
  const eventStore = new EventStore();
  const pool = {
    subscription: vi.fn((): Observable<NostrEvent> => incoming),
    request: vi.fn((..._args: Parameters<RelayPool["request"]>): Observable<NostrEvent> => fetched),
    publish: vi.fn(async (_relays: string[], _event: NostrEvent) => [{ ok: true, from: relays[0] }]),
    close: vi.fn(),
  };
  const signer = new PrivateKeySigner(ownerKey);
  const onSubscriptionError = vi.fn();
  const transport = createNdrTransport(
    { eventStore, pool: pool as unknown as RelayPool },
    { ownerPubkey, signer, relays, onSubscriptionError, ...overrides },
  );
  transports.push(transport);
  return { transport, incoming, fetched, pool, eventStore, signer, onSubscriptionError };
}

function envelope(content = "encrypted") {
  return finalizeEvent({ kind: 1060, content, tags: [], created_at: 100 }, deviceKey);
}

afterEach(() => {
  for (const transport of transports.splice(0)) transport.dispose();
  vi.useRealTimers();
});

describe("standalone NDR transport", () => {
  it("preserves the Kehto factory and upstream hook types without a Kehto context", () => {
    const { transport } = create();
    const options: NdrRuntimeOptions = { ...transport };
    expect(options.nostrFetch).toBe(transport.nostrFetch);
    expect(createKehtoTransport).toBe(createNdrTransport);
  });

  it("rejects optimistic verification flags and unsigned rumors from the shared cache", async () => {
    const { transport, eventStore, pool, incoming } = create();
    pool.request.mockReturnValue(EMPTY);
    const forged = { ...envelope(), sig: "0".repeat(128) };
    const rumor = { ...envelope("rumor"), sig: undefined } as unknown as NostrEvent;
    fakeVerifyEvent(forged);
    fakeVerifyEvent(rumor);
    eventStore.add(forged);
    eventStore.add(rumor);
    expect(eventStore.getEvent(forged.id)).toBeDefined();
    expect(await transport.nostrFetch({ kinds: [1060] })).toEqual([]);

    const receive = vi.fn();
    transport.nostrSubscribe({ kinds: [1060] }, receive);
    incoming.next(forged);
    incoming.next(envelope("valid"));
    expect(receive).toHaveBeenCalledTimes(1);
    expect(receive.mock.calls[0][0].content).toBe("valid");
  });

  it("reports synchronous pool construction errors through each hook's error contract", async () => {
    const { transport, pool, onSubscriptionError } = create();
    const failure = new Error("pool unavailable");
    pool.request.mockImplementation(() => {
      throw failure;
    });
    pool.subscription.mockImplementation(() => {
      throw failure;
    });

    await expect(transport.nostrFetch({})).rejects.toBe(failure);
    const stop = transport.nostrSubscribe({}, vi.fn());
    expect(onSubscriptionError).toHaveBeenCalledWith(failure);
    expect(stop).not.toThrow();
  });

  it("publishes device-signed envelopes but rejects owner signing without a signer", async () => {
    const { transport, pool } = create({ signer: undefined });
    const event = envelope("linked");

    await expect(transport.nostrPublish(event)).resolves.toEqual(event);
    expect(pool.publish).toHaveBeenCalledTimes(1);

    const unsigned = { kind: 37368, content: "", tags: [], created_at: 100, pubkey: "" };
    await expect(transport.nostrSign(unsigned)).rejects.toThrow("No owner signer");
  });

  it("wires the upstream runtime and durable outbox without treating enqueue as relay acceptance", async () => {
    const { transport, pool, signer } = create();
    pool.request.mockReturnValue(EMPTY);
    const sign = vi.spyOn(signer, "signEvent");
    const protocolStorage = new InMemoryStorageAdapter();
    const outboxStorage = new InMemoryStorageAdapter();
    const onPublished = vi.fn();
    const onError = vi.fn();
    const outbox = createPersistentNostrOutbox({
      storage: outboxStorage,
      publish: transport.nostrPublish,
      onPublished,
      onError,
    });
    const runtime = new NdrRuntime({
      ...transport,
      storage: protocolStorage,
      nostrEnqueue: outbox.enqueue,
      nostrPublish: outbox.publish,
      onPublishError: onError,
    });
    try {
      await runtime.initForOwner(ownerPubkey);
      expect(runtime.getState().ownerPubkey).toBe(ownerPubkey);
      const event = finalizeEvent({ kind: 30078, content: "invite", tags: [], created_at: 100 }, deviceKey);
      const wireEvent = structuredClone(event);
      await outbox.enqueue(event);
      expect(pool.publish).not.toHaveBeenCalled();
      expect(onPublished).not.toHaveBeenCalled();
      expect(await outboxStorage.list()).toHaveLength(1);

      pool.publish.mockResolvedValueOnce([{ ok: false, from: relays[0] }]);
      await outbox.retry();
      expect(onError).toHaveBeenCalledTimes(1);
      expect(await outboxStorage.list()).toHaveLength(1);
      await outbox.retry();
      expect(await outboxStorage.list()).toEqual([]);
      expect(onPublished).toHaveBeenCalledWith(expect.objectContaining({ event: wireEvent }));
      expect(pool.publish.mock.calls.map((call) => structuredClone(call[1]))).toEqual([wireEvent, wireEvent]);
      expect(sign).not.toHaveBeenCalled();
    } finally {
      runtime.close();
      await outbox.close();
    }
  });

  it("waits past the pool's early idle cutoff for a slower relay's catch-up", async () => {
    vi.useFakeTimers();
    const { transport, pool } = create({ fetchTimeoutMs: 8000 });
    const sources = relays.map(() => new Subject<RelayReqMessage>());
    const relayObjects = relays.map((url, index) => ({ url, req: () => sources[index] }) as unknown as Relay);
    const group = new RelayGroup(relayObjects);
    pool.request.mockImplementation((_relays, filter, options) => group.request(filter, options));

    const result = transport.nostrFetch({ kinds: [1060] });
    sources[0].next({ type: "EOSE", from: relays[0], id: "request" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(sources[1].observed).toBe(true);
    const lateEnvelope = envelope("slow relay");
    sources[1].next({ type: "EVENT", event: lateEnvelope, from: relays[1], id: "request" });
    sources[1].next({ type: "EOSE", from: relays[1], id: "request" });

    expect(await result).toEqual([lateEnvelope]);
    expect(sources.every((source) => !source.observed)).toBe(true);
  });

  it("returns partial results at the total fetch deadline and ignores late events", async () => {
    vi.useFakeTimers();
    const { transport, fetched, eventStore } = create({ fetchTimeoutMs: 25 });
    const result = transport.nostrFetch({});
    const first = envelope();
    fetched.next(first);
    await vi.advanceTimersByTimeAsync(25);
    expect(await result).toEqual([first]);
    expect(fetched.observed).toBe(false);
    const late = envelope("too late");
    fetched.next(late);
    expect(eventStore.getEvent(late.id)).toBeUndefined();
  });

  it("unsubscribes individual listeners and disposes owned work without closing the shared pool", async () => {
    const { transport, incoming, fetched, pool } = create();
    const first = vi.fn();
    const second = vi.fn();
    const stop = transport.nostrSubscribe({}, first);
    transport.nostrSubscribe({}, second);
    stop();
    incoming.next(envelope());
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);

    const rejected = expect(transport.nostrFetch({})).rejects.toThrow("disposed");
    transport.dispose();
    await rejected;
    expect(incoming.observed).toBe(false);
    expect(fetched.observed).toBe(false);
    expect(pool.close).not.toHaveBeenCalled();
  });

  it("does not sign or publish after the owner identity lookup exceeds its deadline", async () => {
    vi.useFakeTimers();
    const { transport, signer, pool } = create({ actionTimeoutMs: 25 });
    let finish!: (pubkey: string) => void;
    vi.spyOn(signer, "getPublicKey").mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const sign = vi.spyOn(signer, "signEvent");
    const unsigned = { kind: 37368, content: "", tags: [], created_at: 100, pubkey: "" };
    const rejected = expect(transport.nostrPublish(unsigned)).rejects.toThrow("Timeout");
    await vi.advanceTimersByTimeAsync(25);
    await rejected;
    finish(ownerPubkey);
    await vi.advanceTimersByTimeAsync(0);
    expect(sign).not.toHaveBeenCalled();
    expect(pool.publish).not.toHaveBeenCalled();
  });

  it("rejects a valid owner signature over changed content", async () => {
    const { transport, signer, pool } = create();
    const unsigned = { kind: 37368, content: "authorization", tags: [], created_at: 100, pubkey: ownerPubkey };
    vi.spyOn(signer, "signEvent").mockResolvedValue(finalizeEvent({ ...unsigned, content: "changed" }, ownerKey));
    await expect(transport.nostrPublish(unsigned)).rejects.toThrow("changed the owner event");
    expect(pool.publish).not.toHaveBeenCalled();
  });

  it("ignores late relay acceptance after the publication deadline", async () => {
    vi.useFakeTimers();
    const { transport, pool, eventStore } = create({ actionTimeoutMs: 25 });
    let accept!: (results: { ok: boolean; from: string }[]) => void;
    pool.publish.mockImplementation(() => new Promise((resolve) => (accept = resolve)));
    const event = envelope();
    const rejected = expect(transport.nostrPublish(event)).rejects.toThrow("Timeout");
    await vi.advanceTimersByTimeAsync(25);
    await rejected;
    accept([{ ok: true, from: relays[0] }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(eventStore.getEvent(event.id)).toBeUndefined();
  });
});
