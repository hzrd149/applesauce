import { EventStore } from "applesauce-core";
import { finalizeEvent, kinds, unixNow } from "applesauce-core/helpers";
import { getPublicKey } from "applesauce-core/helpers/keys";
import type { RelayPool } from "applesauce-relay";
import { PrivateKeySigner } from "applesauce-signers";
import { Subject } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createKehtoShellAdapter } from "../../index.js";
import type { KehtoContext } from "../../types.js";
import { createListsOptions } from "../lists.js";

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

describe("remaining write services", () => {
  it("adds and removes list items while preserving unrelated tags", async () => {
    event(aliceKey, kinds.BookmarkList, [["title", "Saved"]]);
    const lists = createListsOptions(await create());
    const item = { itemType: "event" as const, value: "a".repeat(64) };
    const added = await lists.add!({ kind: kinds.BookmarkList }, [item], {}, { windowId: "w" });
    expect(added).toMatchObject({ ok: true, added: 1 });
    expect(added.event?.tags).toContainEqual(["title", "Saved"]);
    expect(await lists.remove!({ kind: kinds.BookmarkList }, [item], {}, { windowId: "w" })).toMatchObject({
      ok: true,
      removed: 1,
    });
  });
});

describe("list privacy and resource integrity", () => {
  it("keeps private bookmarks encrypted and counts duplicate items once", async () => {
    const lists = createListsOptions(await create());
    const item = { itemType: "event" as const, value: "b".repeat(64), visibility: "private" as const };
    const added = await lists.add!({ kind: kinds.BookmarkList }, [item, item], {}, { windowId: "w" });
    expect(added).toMatchObject({ ok: true, added: 1, skipped: 1 });
    expect(added.event?.content).not.toContain(item.value);
    expect(added.event?.tags).not.toContainEqual(["e", item.value]);
    expect(await lists.remove!({ kind: kinds.BookmarkList }, [item], {}, { windowId: "w" })).toMatchObject({
      ok: true,
      removed: 1,
    });
  });
});
