import { EventStore } from "applesauce-core";
import { finalizeEvent, kinds, unixNow } from "applesauce-core/helpers";
import { getPublicKey } from "applesauce-core/helpers/keys";
import type { RelayPool } from "applesauce-relay";
import { PrivateKeySigner } from "applesauce-signers";
import { Subject } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createKehtoShellAdapter } from "../../index.js";
import type { KehtoContext } from "../../types.js";
import { createIdentityOptions } from "../identity.js";

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

  it("leaves blocks application-defined by default", async () => {
    event(aliceKey, kinds.Mutelist, [["p", bob]]);
    const identity = createIdentityOptions(await create());

    expect(identity.getBlocked).toBeUndefined();
    expect(await identity.getMutes!(alice, {} as any)).toEqual([bob]);
  });

  it.each([
    [
      "bookmarks",
      kinds.BookmarkList,
      [
        ["e", "event"],
        ["a", "address"],
        ["t", "topic"],
        ["r", "https://example.com"],
      ],
    ],
    ["pins", kinds.Pinlist, [["e", "event"]]],
    [
      "interests",
      kinds.InterestsList,
      [
        ["t", "topic"],
        ["a", "address"],
      ],
    ],
    ["communities", kinds.CommunitiesList, [["a", "address"]]],
    [
      "emojis",
      kinds.UserEmojiList,
      [
        ["emoji", "smile", "https://example.com/smile.png"],
        ["a", "address"],
      ],
    ],
  ] as const)("returns only public item values for %s", async (listType, kind, items) => {
    event(
      aliceKey,
      kind,
      [
        ...items.map((tag) => [...tag]),
        ["title", "My list"],
        ["description", "List description"],
        ["image", "https://example.com/image.png"],
        ["d", ""],
        ["unknown", "not an item"],
        ["e", ""],
      ],
      "private content",
    );
    const identity = createIdentityOptions(await create());

    expect(await identity.getList!(listType, alice, {} as any)).toEqual(items.map((tag) => tag[1]));
  });

  it("optionally uses public muted pubkeys for blocks", async () => {
    event(aliceKey, kinds.Mutelist, [
      ["p", bob],
      ["word", "spam"],
      ["t", "noise"],
    ]);
    const identity = createIdentityOptions({ ...(await create()), useMutesForBlocks: true });

    expect(await identity.getBlocked!(alice, {} as any)).toEqual([bob]);
    expect(await identity.getBlocked!(bob, {} as any)).toEqual([]);
  });

  it("prioritizes the application provider and forwards the request", async () => {
    event(aliceKey, kinds.Mutelist, [["p", bob]]);
    const getBlocked = vi.fn(async () => [alice]);
    const identity = createIdentityOptions({ ...(await create()), getBlocked, useMutesForBlocks: true });
    const message = { type: "identity.getBlocked", id: "blocks" } as any;

    expect(await identity.getBlocked!(bob, message)).toEqual([alice]);
    expect(getBlocked).toHaveBeenCalledWith(bob, message);
    expect(await identity.getMutes!(alice, {} as any)).toEqual([bob]);
  });

  it("returns null for a missing profile after the timeout", async () => {
    const identity = createIdentityOptions(await create());
    expect(await identity.getProfile!(bob, {} as any)).toBeNull();
  });
});
