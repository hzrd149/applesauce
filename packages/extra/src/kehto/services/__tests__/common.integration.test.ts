import { EventStore } from "applesauce-core";
import { finalizeEvent, kinds, unixNow } from "applesauce-core/helpers";
import { getPublicKey } from "applesauce-core/helpers/keys";
import type { RelayPool } from "applesauce-relay";
import { PrivateKeySigner } from "applesauce-signers";
import { BehaviorSubject, Subject } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createKehtoShellAdapter } from "../../index.js";
import type { KehtoContext } from "../../types.js";
import { createCommonOptions } from "../common.js";

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

  it("uses a shared account stream without a signer dependency", async () => {
    const account$ = new BehaviorSubject({ signer, pubkey: alice });
    const common = createCommonOptions({
      eventStore: store,
      pool: pool as unknown as RelayPool,
      account$,
      timeout: 50,
    });

    const first = await common.follow!([bob], { windowId: "w" });
    expect(first.event?.pubkey).toBe(alice);

    account$.next({ signer: new PrivateKeySigner(bobKey), pubkey: bob });
    const second = await common.follow!([alice], { windowId: "w" });
    expect(second.event?.pubkey).toBe(bob);
  });

  it("rejects invalid pubkeys", async () => {
    const common = createCommonOptions(await create());
    expect(await common.follow!(["nope"], { windowId: "w" })).toEqual({ ok: false, error: "invalid pubkey" });
  });
});
