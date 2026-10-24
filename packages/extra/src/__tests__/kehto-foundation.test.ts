import { EventStore } from "applesauce-core";
import { finalizeEvent, kinds, unixNow, type NostrEvent } from "applesauce-core/helpers";
import type { RelayPool } from "applesauce-relay";
import { getPublicKey } from "applesauce-core/helpers/keys";
import { PrivateKeySigner } from "applesauce-signers";
import { BehaviorSubject, Subject } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publishThroughStore, subscribeThroughStore } from "../kehto/foundation/pool.js";
import { getStoredOutboxes, selectReadRelays, selectRelayTier } from "../kehto/foundation/relays.js";
import { createKehtoSigner, signForNapplet } from "../kehto/foundation/signer.js";
import { createKehtoState, type KehtoState } from "../kehto/foundation/state.js";
import type { KehtoContext } from "../kehto/types.js";

const alice = new PrivateKeySigner(new Uint8Array(32).fill(1));
const bob = new PrivateKeySigner(new Uint8Array(32).fill(2));
const pk = (signer: PrivateKeySigner) => getPublicKey(signer.key);

/** A fake pool whose req() messages are pushed by the test */
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

let store: EventStore;
let pool: ReturnType<typeof fakePool>;
let states: KehtoState[];
const create = (ctx: Partial<KehtoContext> = {}) => {
  const state = createKehtoState({ pool: pool as unknown as RelayPool, eventStore: store, ...ctx });
  states.push(state);
  return state;
};
const relayList = (key: Uint8Array, tags: string[][]) =>
  finalizeEvent({ kind: kinds.RelayList, created_at: unixNow(), content: "", tags }, key);

beforeEach(() => {
  store = new EventStore({ verifyEvent: () => true });
  pool = fakePool();
  states = [];
});
afterEach(() => {
  for (const state of states) state.stop();
});

describe("createKehtoState", () => {
  it("follows an observable signer and resolves its pubkey", async () => {
    const signer$ = new BehaviorSubject<PrivateKeySigner | undefined>(alice);
    const state = create({ signer: signer$ });
    await vi.waitFor(() => expect(state.getPubkey()).toBe(pk(alice)));

    signer$.next(bob);
    expect(state.getSigner()).toBe(bob);
    await vi.waitFor(() => expect(state.getPubkey()).toBe(pk(bob)));

    signer$.next(undefined);
    expect(state.getPubkey()).toBeUndefined();
  });

  it("uses the latest fallback relays", () => {
    const relays$ = new BehaviorSubject(["wss://a.relay.com/"]);
    const state = create({ fallbackRelays: relays$ });
    relays$.next(["wss://b.relay.com/"]);
    expect(state.getFallbackRelays()).toEqual(["wss://b.relay.com/"]);
  });

  it("wires an event loader only when the store has none, and removes it on stop", () => {
    const state = create({ lookupRelays: ["wss://lookup.relay.com/"] });
    expect(store.eventLoader).toBeDefined();
    state.stop();
    expect(store.eventLoader).toBeUndefined();

    const existing = vi.fn();
    store.eventLoader = existing;
    create().stop();
    expect(store.eventLoader).toBe(existing);
  });
});

describe("signForNapplet", () => {
  it("restamps created_at after approval", async () => {
    const state = create({ signer: alice, approve: () => true });
    const event = await signForNapplet(state, { kind: 1, content: "hi", tags: [], created_at: 1 });
    expect(event.created_at).toBeGreaterThan(1);
    expect(event.pubkey).toBe(pk(alice));
  });

  it("throws when the host denies the request", async () => {
    const approve = vi.fn(() => false);
    const state = create({ signer: alice, approve });
    await expect(signForNapplet(state, { kind: 1, content: "", tags: [], created_at: 1 }, "win")).rejects.toThrow(
      "User denied",
    );
    expect(approve).toHaveBeenCalledWith({
      windowId: "win",
      template: { kind: 1, content: "", tags: [], created_at: 1 },
    });
  });

  it("returns null without a signer", () => {
    expect(createKehtoSigner(create())).toBeNull();
  });
});

describe("relay selection", () => {
  it("reads from the authors' stored outboxes and publishes to the user's outboxes", async () => {
    store.add(relayList(bob.key, [["r", "wss://bob.relay.com/", "write"]]));
    store.add(relayList(alice.key, [["r", "wss://alice.relay.com/"]]));
    const state = create({ signer: alice, fallbackRelays: ["wss://fallback.relay.com/"] });
    await vi.waitFor(() => expect(state.getPubkey()).toBe(pk(alice)));

    expect(getStoredOutboxes(state, pk(bob))).toEqual(["wss://bob.relay.com/"]);
    expect(selectReadRelays(state, [{ authors: [pk(bob)] }])).toEqual(["wss://bob.relay.com/"]);
    expect(selectRelayTier(state, [])).toEqual(["wss://alice.relay.com/"]);
  });

  it("uses the fallback relays when nothing is known", () => {
    const state = create({ fallbackRelays: ["wss://fallback.relay.com/"] });
    expect(selectRelayTier(state, [])).toEqual(["wss://fallback.relay.com/"]);
    expect(selectReadRelays(state, [{ kinds: [1] }])).toEqual(["wss://fallback.relay.com/"]);
  });
});

describe("subscribeThroughStore", () => {
  const note = (content: string): NostrEvent =>
    finalizeEvent({ kind: 1, created_at: unixNow(), content, tags: [] }, alice.key);

  it("emits stored events, adds relay events to the store and sends EOSE once every relay finishes", () => {
    const stored = store.add(note("stored"))!;
    const items: (NostrEvent | "EOSE")[] = [];
    const sub = subscribeThroughStore(create(), ["wss://a/", "wss://b/"], [{ kinds: [1] }]).subscribe((i) =>
      items.push(i),
    );

    const live = note("live");
    pool.req$.next({ type: "EVENT", from: "wss://a/", id: "x", event: live });
    pool.req$.next({ type: "EOSE", from: "wss://a/", id: "x" });
    expect(items).toEqual([stored, live]);
    pool.req$.next({ type: "EOSE", from: "wss://b/", id: "x" });
    expect(items.at(-1)).toBe("EOSE");
    expect(store.hasEvent(live.id)).toBe(true);
    sub.unsubscribe();
  });

  it("sends EOSE after the timeout when relays never finish", () => {
    vi.useFakeTimers();
    const items: unknown[] = [];
    const sub = subscribeThroughStore(create({ timeout: 100 }), ["wss://a/"], [{ kinds: [1] }]).subscribe((i) =>
      items.push(i),
    );
    vi.advanceTimersByTime(100);
    expect(items).toEqual(["EOSE"]);
    sub.unsubscribe();
    vi.useRealTimers();
  });
});

describe("publishThroughStore", () => {
  it("throws when no relay accepts the event", async () => {
    pool.publish.mockResolvedValueOnce([{ from: "wss://a/", ok: false, message: "blocked" }] as any);
    const event = finalizeEvent({ kind: 1, created_at: unixNow(), content: "", tags: [] }, alice.key);
    await expect(publishThroughStore(create(), ["wss://a/"], event)).rejects.toThrow("blocked");
    expect(store.hasEvent(event.id)).toBe(true);
  });
});
