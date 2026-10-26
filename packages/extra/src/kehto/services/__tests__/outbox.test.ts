import { EventStore } from "applesauce-core";
import { finalizeEvent, kinds, unixNow } from "applesauce-core/helpers";
import { getPublicKey } from "applesauce-core/helpers/keys";
import type { RelayPool } from "applesauce-relay";
import { PrivateKeySigner } from "applesauce-signers";
import { BehaviorSubject, Subject } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createKehtoShellAdapter } from "../../index.js";
import type { KehtoContext } from "../../types.js";
import { createOutboxRouter } from "../outbox.js";

const aliceKey = new Uint8Array(32).fill(1);
const bobKey = new Uint8Array(32).fill(2);
const alice = getPublicKey(aliceKey);
const bob = getPublicKey(bobKey);
const signer = new PrivateKeySigner(aliceKey);

function fakePool() {
  return {
    req: vi.fn(() => new Subject()),
    request: vi.fn(),
    publish: vi.fn(async (relays: string[]) => relays.map((from) => ({ from, ok: true }))),
    count: vi.fn(),
  };
}

let store: EventStore;
let pool: ReturnType<typeof fakePool>;
let adapters: ReturnType<typeof createKehtoShellAdapter>[];
async function create(ctx: Partial<KehtoContext> = {}): Promise<KehtoContext> {
  return { pool: pool as unknown as RelayPool, eventStore: store, signer, timeout: 50, ...ctx };
}
const event = (key: Uint8Array, kind: number, tags: string[][] = [], content = "") =>
  store.add(finalizeEvent({ kind, created_at: unixNow(), content, tags }, key))!;

beforeEach(() => {
  store = new EventStore({ verifyEvent: () => true });
  pool = fakePool();
  adapters = [];
  event(aliceKey, kinds.RelayList, [["r", "wss://alice.relay.com/"]]);
  event(bobKey, kinds.RelayList, [
    ["r", "wss://bob-in.relay.com/", "read"],
    ["r", "wss://bob-out.relay.com/", "write"],
  ]);
});
afterEach(() => {
  for (const adapter of adapters) adapter.stop();
});

describe("outbox", () => {
  it("resolves no relays when relay lists and fallbacks are absent", async () => {
    const router = createOutboxRouter(await create({ eventStore: new EventStore() }));

    expect((await router.resolveRelays({ authors: [bob] })).relays).toEqual([]);
    expect((await router.resolveRelays({ pubkey: bob, direction: "write" })).relays).toEqual([]);
  });

  it("plans reads from author outboxes and writes to recipient inboxes", async () => {
    const router = createOutboxRouter(await create());
    expect(await router.resolveRelays({ authors: [bob] })).toEqual({
      relays: ["wss://bob-out.relay.com/"],
      source: "nip65",
    });
    expect((await router.resolveRelays({ pubkey: bob, direction: "write" })).relays).toEqual([
      "wss://bob-in.relay.com/",
    ]);
  });

  it("reroutes live reads when an author's relay list changes without replaying events", async () => {
    const router = createOutboxRouter(await create());
    const note = event(bobKey, kinds.ShortTextNote, [], "hello");
    const sink = { event: vi.fn(), closed: vi.fn() };
    const subscription = router.subscribe([{ authors: [bob], kinds: [1] }], {}, sink);

    await vi.waitFor(() =>
      expect(pool.req).toHaveBeenCalledWith(["wss://bob-out.relay.com/"], [{ authors: [bob], kinds: [1] }]),
    );
    store.add(
      finalizeEvent(
        {
          kind: kinds.RelayList,
          created_at: unixNow() + 1,
          content: "",
          tags: [["r", "wss://new-out.relay.com/", "write"]],
        },
        bobKey,
      ),
    );

    await vi.waitFor(() =>
      expect(pool.req).toHaveBeenLastCalledWith(["wss://new-out.relay.com/"], [{ authors: [bob], kinds: [1] }]),
    );
    expect(sink.event).toHaveBeenCalledTimes(1);
    expect(sink.event.mock.calls[0][0].event.id).toBe(note.id);

    subscription.close();
    event(bobKey, kinds.ShortTextNote, [], "after close");
    expect(sink.event).toHaveBeenCalledTimes(1);
  });

  it("limits relays per author and reroutes live reads when the host changes the limit", async () => {
    const carolKey = new Uint8Array(32).fill(3);
    const carol = getPublicKey(carolKey);
    event(carolKey, kinds.RelayList, [
      ["r", "wss://one.relay.com/", "write"],
      ["r", "wss://two.relay.com/", "write"],
      ["r", "wss://three.relay.com/", "write"],
    ]);
    const maxRelaysPerUser = new BehaviorSubject(1);
    const router = createOutboxRouter(await create({ relaySelection: { maxRelaysPerUser } }));

    expect((await router.resolveRelays({ authors: [carol] })).relays).toHaveLength(1);
    const subscription = router.subscribe([{ authors: [carol] }], {}, { event: vi.fn(), closed: vi.fn() });
    await vi.waitFor(() => expect(pool.req).toHaveBeenLastCalledWith([expect.any(String)], [{ authors: [carol] }]));

    maxRelaysPerUser.next(3);
    await vi.waitFor(() => expect(pool.req.mock.lastCall?.[0]).toHaveLength(3));

    subscription.close();
    expect(maxRelaysPerUser.observed).toBe(false);
  });

  it("switches inbox relays with the account and releases settings subscriptions on close", async () => {
    const signer$ = new BehaviorSubject<PrivateKeySigner | undefined>(signer);
    const fallbackRelays = new BehaviorSubject(["wss://fallback.relay.com/"]);
    const context = await create({ signer: signer$, fallbackRelays });
    const router = createOutboxRouter(context);
    const subscription = router.subscribe([{ kinds: [1] }], {}, { event: vi.fn(), closed: vi.fn() });

    await vi.waitFor(() =>
      expect(pool.req).toHaveBeenLastCalledWith(
        ["wss://alice.relay.com/", "wss://fallback.relay.com/"],
        [{ kinds: [1] }],
      ),
    );
    signer$.next(new PrivateKeySigner(bobKey));
    await vi.waitFor(() =>
      expect(pool.req).toHaveBeenLastCalledWith(
        ["wss://bob-in.relay.com/", "wss://fallback.relay.com/"],
        [{ kinds: [1] }],
      ),
    );
    fallbackRelays.next(["wss://new-fallback.relay.com/"]);
    expect(pool.req).toHaveBeenLastCalledWith(
      ["wss://bob-in.relay.com/", "wss://new-fallback.relay.com/"],
      [{ kinds: [1] }],
    );
    signer$.next(undefined);
    expect(pool.req).toHaveBeenLastCalledWith(["wss://new-fallback.relay.com/"], [{ kinds: [1] }]);

    subscription.close();
    expect(signer$.observed).toBe(false);
    expect(fallbackRelays.observed).toBe(false);
  });

  it("keeps the requesting window and account when approval switches the signer", async () => {
    const signer$ = new BehaviorSubject<PrivateKeySigner | undefined>(signer);
    let windowId = "first-window";
    const approve = vi.fn(() => {
      signer$.next(new PrivateKeySigner(bobKey));
      return true;
    });
    const router = createOutboxRouter({ ...(await create({ signer: signer$, approve })), getWindowId: () => windowId });
    const pending = router.publish({ kind: 1, content: "hello", tags: [], created_at: 0 });
    windowId = "second-window";
    const result = await pending;

    expect(result.ok).toBe(true);
    expect(result.event?.pubkey).toBe(alice);
    expect(approve).toHaveBeenCalledWith(expect.objectContaining({ windowId: "first-window" }));
    expect(pool.publish).toHaveBeenCalledWith(["wss://alice.relay.com/"], expect.objectContaining({ pubkey: alice }));
  });

  it("signs and publishes to the user's outboxes and recipient inboxes", async () => {
    const approve = vi.fn(() => true);
    const router = createOutboxRouter({ ...(await create({ approve })), getWindowId: () => "win-1" });
    const result = await router.publish({ kind: 1, content: "hi", tags: [], created_at: 0 }, { toInboxes: [bob] });

    expect(result).toMatchObject({
      ok: true,
      relays: { "wss://alice.relay.com/": true, "wss://bob-in.relay.com/": true },
    });
    expect(approve).toHaveBeenCalledWith(expect.objectContaining({ windowId: "win-1" }));
    expect(store.hasEvent(result.eventId!)).toBe(true);
  });

  it("reports a denied publish without publishing", async () => {
    const router = createOutboxRouter(await create({ approve: () => false }));
    expect(await router.publish({ kind: 1, content: "", tags: [], created_at: 0 })).toEqual({
      ok: false,
      error: "User denied",
    });
    expect(pool.publish).not.toHaveBeenCalled();
  });

  it("finds events already in the store", async () => {
    const note = event(bobKey, kinds.ShortTextNote, [], "hello");
    const router = createOutboxRouter(await create());
    expect((await router.getEvent!(note.id)).result?.event).toBe(note);
  });
});
