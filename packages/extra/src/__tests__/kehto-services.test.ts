import { EventStore } from "applesauce-core";
import { finalizeEvent, kinds, unixNow } from "applesauce-core/helpers";
import { getPublicKey } from "applesauce-core/helpers/keys";
import type { RelayPool } from "applesauce-relay";
import { PrivateKeySigner } from "applesauce-signers";
import { of, Subject } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createKehtoServices, createKehtoShellAdapter } from "../kehto/index.js";
import { createKehtoState, type KehtoState } from "../kehto/foundation/state.js";
import { createCommonOptions } from "../kehto/services/common.js";
import { createCountOptions } from "../kehto/services/count.js";
import { createIdentityOptions } from "../kehto/services/identity.js";
import { createOutboxRouter } from "../kehto/services/outbox.js";
import type { KehtoContext } from "../kehto/types.js";

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
let states: KehtoState[];
async function create(ctx: Partial<KehtoContext> = {}) {
  const state = createKehtoState({
    pool: pool as unknown as RelayPool,
    eventStore: store,
    signer,
    timeout: 50,
    ...ctx,
  });
  states.push(state);
  await vi.waitFor(() => expect(state.getPubkey()).toBe(alice));
  return state;
}
const event = (key: Uint8Array, kind: number, tags: string[][] = [], content = "") =>
  store.add(finalizeEvent({ kind, created_at: unixNow(), content, tags }, key))!;

beforeEach(() => {
  store = new EventStore({ verifyEvent: () => true });
  pool = fakePool();
  states = [];
  event(aliceKey, kinds.RelayList, [["r", "wss://alice.relay.com/"]]);
  event(bobKey, kinds.RelayList, [
    ["r", "wss://bob-in.relay.com/", "read"],
    ["r", "wss://bob-out.relay.com/", "write"],
  ]);
});
afterEach(() => {
  for (const state of states) state.stop();
});

describe("identity", () => {
  it("answers profile, follows and lists from the store", async () => {
    event(aliceKey, kinds.Metadata, [], JSON.stringify({ name: "alice", about: "hi" }));
    event(aliceKey, kinds.Contacts, [["p", bob]]);
    event(aliceKey, kinds.BookmarkList, [["e", "abc"]]);
    const identity = createIdentityOptions(await create());

    expect(await identity.getProfile!(alice, {} as any)).toMatchObject({ name: "alice", about: "hi" });
    expect(await identity.getFollows!(alice, {} as any)).toEqual([bob]);
    expect(await identity.getList!("bookmarks", alice, {} as any)).toEqual(["abc"]);
    expect(await identity.getList!("unknown", alice, {} as any)).toEqual([]);
  });

  it("returns null for a missing profile after the timeout", async () => {
    const identity = createIdentityOptions(await create());
    expect(await identity.getProfile!(bob, {} as any)).toBeNull();
  });
});

describe("outbox", () => {
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

  it("signs and publishes to the user's outboxes and recipient inboxes", async () => {
    const approve = vi.fn(() => true);
    const router = createOutboxRouter(await create({ approve }), () => "win-1");
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

describe("count", () => {
  it("reports the largest relay count", async () => {
    pool.count.mockReturnValue(
      of({
        "wss://a.relay.com/": { ok: true, value: { count: 3 } },
        "wss://b.relay.com/": { ok: true, value: { count: 7 } },
        "wss://c.relay.com/": { ok: false, error: new Error("nope") },
      }),
    );
    const count = createCountOptions(await create());
    expect(await count.count({ filters: [{ kinds: [1] }], windowId: "w" })).toEqual({
      ok: true,
      count: 7,
      approximate: false,
      relays: ["wss://b.relay.com/"],
    });
    expect(count.isFilterSupported!({}, 0)).not.toBe(true);
  });
});

describe("common", () => {
  it("follows a user through the contacts action", async () => {
    event(aliceKey, kinds.Contacts, []);
    const common = createCommonOptions(await create());
    const result = await common.follow!([bob], { windowId: "w" });

    expect(result.ok).toBe(true);
    expect(result.event?.kind).toBe(kinds.Contacts);
    expect(result.event?.tags).toContainEqual(["p", bob]);
    expect(pool.publish).toHaveBeenCalledWith(["wss://alice.relay.com/"], result.event);
  });

  it("rejects invalid pubkeys", async () => {
    const common = createCommonOptions(await create());
    expect(await common.follow!(["nope"], { windowId: "w" })).toEqual({ ok: false, error: "invalid pubkey" });
  });
});

describe("registry", () => {
  it("creates every service unless disabled", async () => {
    const state = await create();
    expect(Object.keys(createKehtoServices(state)).sort()).toEqual(["common", "count", "identity", "outbox", "upload"]);
    expect(Object.keys(createKehtoServices(state, { disable: ["upload", "count"] })).sort()).toEqual([
      "common",
      "identity",
      "outbox",
    ]);
  });

  it("creates a shell adapter that exposes the current user and signer", async () => {
    const adapter = createKehtoShellAdapter(await create());
    expect(adapter.auth.getUserPubkey()).toBe(alice);
    expect(await adapter.auth.getSigner("w")?.getPublicKey()).toBe(alice);
    expect(adapter.relayPool.selectRelayTier([])).toEqual(["wss://alice.relay.com/"]);
    expect(adapter.services?.identity).toBeDefined();
  });
});
