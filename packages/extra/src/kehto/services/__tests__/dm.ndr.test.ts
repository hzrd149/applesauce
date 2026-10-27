import { EventStore } from "applesauce-core";
import { finalizeEvent, getPublicKey, unixNow, type NostrEvent } from "applesauce-core/helpers";
import type { RelayPool } from "applesauce-relay";
import { PrivateKeySigner } from "applesauce-signers";
import { NdrRuntime, Session, type NdrRuntimeOptions } from "nostr-double-ratchet";
import { EMPTY, Subject, type Observable } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNdrTransport, type KehtoNdrTransport } from "../dm/ndr.js";

const aliceKey = new Uint8Array(32).fill(1);
const bobKey = new Uint8Array(32).fill(2);
const alice = getPublicKey(aliceKey);
const relays = ["wss://ndr.example.com/"];
const transports: KehtoNdrTransport[] = [];

function create() {
  const incoming = new Subject<NostrEvent>();
  const fetched = new Subject<NostrEvent>();
  const eventStore = new EventStore();
  const pool = {
    subscription: vi.fn(() => incoming),
    request: vi.fn((): Observable<NostrEvent> => fetched),
    publish: vi.fn(async (_relays: string[], _event: NostrEvent) => [{ ok: true, from: relays[0] }]),
  };
  const signer = new PrivateKeySigner(aliceKey);
  const options = { signer, ownerPubkey: alice, relays, onSubscriptionError: vi.fn() };
  const context = { eventStore, pool: pool as unknown as RelayPool };
  const transport = createNdrTransport(context, options);
  transports.push(transport);
  return { transport, pool, eventStore, incoming, fetched, signer, options, context };
}

function event(content = "encrypted") {
  return finalizeEvent({ kind: 1060, content, tags: [], created_at: unixNow() }, bobKey);
}

afterEach(() => {
  for (const transport of transports.splice(0)) transport.dispose();
  vi.useRealTimers();
});

describe("NDR transport", () => {
  it("matches the published runtime options and initializes without an owner secret key", async () => {
    const { transport, pool } = create();
    pool.request.mockReturnValue(EMPTY);
    const options: NdrRuntimeOptions = { ...transport, appKeysFetchTimeoutMs: 20, appKeysFastTimeoutMs: 10 };
    const runtime = new NdrRuntime(options);
    try {
      await runtime.initForOwner(alice);
      expect(runtime.getState().ownerPubkey).toBe(alice);
      expect(runtime.getState().currentDevicePubkey).toBeTruthy();
      await runtime.ensureCurrentDeviceRegistered(alice, 20);
      await runtime.republishInvite();
      expect(runtime.getState().canSendPrivateMessages).toBe(true);
    } finally {
      runtime.close();
    }
  });

  it("delivers verified cached and incoming envelopes once per subscription", () => {
    const { transport, eventStore, incoming } = create();
    const envelope = event();
    eventStore.add(envelope);
    const received = vi.fn();
    const stop = transport.nostrSubscribe({ kinds: [1060] }, received);
    incoming.next(envelope);
    incoming.next({ ...event("invalid"), sig: "0".repeat(128) });
    incoming.next(event("next"));

    expect(received).toHaveBeenCalledTimes(2);
    expect(eventStore.getEvent(envelope.id)).toBeDefined();
    stop();
    expect(incoming.observed).toBe(false);
    transport.nostrSubscribe({ kinds: [1060] }, received)();
    expect(received).toHaveBeenCalledTimes(4);
  });

  it("reports subscription failures", () => {
    const { transport, incoming, options } = create();
    transport.nostrSubscribe({ kinds: [1060] }, vi.fn());
    incoming.error(new Error("offline"));
    expect(options.onSubscriptionError).toHaveBeenCalledWith(expect.objectContaining({ message: "offline" }));
  });

  it("merges cached and fetched envelopes and releases the finite request", async () => {
    const { transport, eventStore, fetched } = create();
    const cached = event();
    const next = event("next");
    eventStore.add(cached);
    const result = transport.nostrFetch({ kinds: [1060] });
    fetched.next(cached);
    fetched.next(next);
    fetched.complete();
    expect(await result).toEqual([cached, next]);
    expect(eventStore.getEvent(next.id)).toBeDefined();
    expect(fetched.observed).toBe(false);
  });

  it("bounds fetching even when a relay keeps sending events", async () => {
    vi.useFakeTimers();
    const { transport, fetched } = create();
    const result = transport.nostrFetch({ kinds: [1060] });
    fetched.next(event());
    await vi.advanceTimersByTimeAsync(4000);
    expect(await result).toHaveLength(1);
    expect(fetched.observed).toBe(false);
  });

  it("preserves device signatures and caches only accepted publications", async () => {
    const { transport, signer, pool, eventStore } = create();
    const sign = vi.spyOn(signer, "signEvent");
    const envelope = event();
    expect(await transport.nostrPublish(envelope)).toBe(envelope);
    expect(sign).not.toHaveBeenCalled();
    expect(pool.publish).toHaveBeenCalledWith(relays, envelope);
    expect(eventStore.getEvent(envelope.id)).toBeDefined();

    pool.publish.mockResolvedValue([{ from: relays[0], ok: false }]);
    const rejected = event("rejected");
    await expect(transport.nostrPublish(rejected)).rejects.toThrow("No relay accepted");
    expect(eventStore.getEvent(rejected.id)).toBeUndefined();
  });

  it("signs owner events without changing their timestamps or content", async () => {
    const { transport } = create();
    const unsigned = { kind: 37368, content: "authorization", tags: [], created_at: 100, pubkey: alice };
    const signed = await transport.nostrSign(unsigned);
    expect(signed).toMatchObject(unsigned);
    await expect(transport.nostrSign({ ...unsigned, pubkey: getPublicKey(bobKey) })).rejects.toThrow("mismatch");
  });

  it("rejects a changed signer identity and invalid device signatures before publishing", async () => {
    const { transport, signer, pool } = create();
    vi.spyOn(signer, "getPublicKey").mockResolvedValue(getPublicKey(bobKey));
    await expect(
      transport.nostrPublish({ kind: 37368, content: "", tags: [], created_at: 100, pubkey: alice }),
    ).rejects.toThrow("mismatch");
    await expect(transport.nostrPublish({ ...event(), sig: "0".repeat(128) })).rejects.toThrow("Invalid signed");
    expect(pool.publish).not.toHaveBeenCalled();
  });

  it("cancels pending fetches and live subscriptions on disposal", async () => {
    const { transport, incoming, fetched } = create();
    transport.nostrSubscribe({ kinds: [1060] }, vi.fn());
    const pending = expect(transport.nostrFetch({ kinds: [1060] })).rejects.toThrow("disposed");
    transport.dispose();
    transport.dispose();
    await pending;
    expect(incoming.observed).toBe(false);
    expect(fetched.observed).toBe(false);
    expect(() => transport.nostrFetch({})).toThrow("disposed");
    expect(() => transport.nostrSubscribe({}, vi.fn())).toThrow("disposed");
    expect(() => transport.nostrPublish(event())).toThrow("disposed");
  });

  it("does not publish after a pending signing operation times out", async () => {
    vi.useFakeTimers();
    const { transport, signer, pool } = create();
    const unsigned = { kind: 37368, content: "", tags: [], created_at: 100, pubkey: alice };
    let finish!: (value: NostrEvent) => void;
    vi.spyOn(signer, "signEvent").mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const pending = expect(transport.nostrPublish(unsigned)).rejects.toThrow("Timeout");
    await vi.advanceTimersByTimeAsync(60000);
    await pending;
    finish(finalizeEvent(unsigned, aliceKey));
    await vi.advanceTimersByTimeAsync(0);
    expect(pool.publish).not.toHaveBeenCalled();
  });

  it("does not publish after disposal while the signer is answering", async () => {
    const { transport, signer, pool } = create();
    const unsigned = { kind: 37368, content: "", tags: [], created_at: 100, pubkey: alice };
    let finish!: (value: NostrEvent) => void;
    vi.spyOn(signer, "signEvent").mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const result = transport.nostrPublish(unsigned);
    await vi.waitFor(() => expect(signer.signEvent).toHaveBeenCalled());
    const rejected = expect(result).rejects.toThrow("disposed");
    transport.dispose();
    await rejected;
    finish(finalizeEvent(unsigned, aliceKey));
    await Promise.resolve();
    expect(pool.publish).not.toHaveBeenCalled();
  });

  it("ignores late publication acknowledgements after disposal", async () => {
    const { transport, pool, eventStore } = create();
    let accept!: (results: { ok: boolean; from: string }[]) => void;
    pool.publish.mockImplementation(() => new Promise((resolve) => (accept = resolve)));
    const envelope = event();
    const result = transport.nostrPublish(envelope);
    const rejected = expect(result).rejects.toThrow("disposed");
    transport.dispose();
    await rejected;
    accept([{ ok: true, from: relays[0] }]);
    await Promise.resolve();
    expect(eventStore.getEvent(envelope.id)).toBeUndefined();
  });

  it("rejects finite request errors instead of reporting an empty history", async () => {
    const { transport, fetched } = create();
    const result = transport.nostrFetch({ kinds: [1060] });
    const rejected = expect(result).rejects.toThrow("offline");
    fetched.error(new Error("offline"));
    await rejected;
  });

  it("exchanges actual double-ratchet encrypted messages through the transport", async () => {
    const { transport, incoming } = create();
    const secret = new Uint8Array(32).fill(3);
    const sender = Session.init(getPublicKey(bobKey), aliceKey, true, secret);
    const receiver = Session.init(alice, bobKey, false, secret);
    const received = vi.fn();
    receiver.onEvent(received);
    const stop = transport.nostrSubscribe({ kinds: [1060] }, (envelope) => receiver.receiveEvent(envelope));
    try {
      const { event: envelope } = sender.sendEvent({
        kind: 14,
        content: "private hello",
        tags: [],
        created_at: unixNow(),
      });
      expect(envelope.content).not.toContain("private hello");
      await transport.nostrPublish(envelope);
      incoming.next(envelope);
      expect(received).toHaveBeenCalledTimes(1);
      expect(received.mock.calls[0][0].content).toBe("private hello");
    } finally {
      stop();
      sender.close();
      receiver.close();
    }
  });

  it("requires explicit relays and positive finite deadlines", () => {
    const { context, options } = create();
    expect(() => createNdrTransport(context, { ...options, relays: [] })).toThrow("explicit");
    expect(() => createNdrTransport(context, { ...options, actionTimeoutMs: Infinity })).toThrow("deadlines");
  });
});
