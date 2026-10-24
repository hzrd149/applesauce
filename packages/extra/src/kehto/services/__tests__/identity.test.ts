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

  it("returns null for a missing profile after the timeout", async () => {
    const identity = createIdentityOptions(await create());
    expect(await identity.getProfile!(bob, {} as any)).toBeNull();
  });
});
