import { EventStore } from "applesauce-core";
import { finalizeEvent, kinds, unixNow } from "applesauce-core/helpers";
import { getPublicKey } from "applesauce-core/helpers/keys";
import type { RelayPool } from "applesauce-relay";
import { PrivateKeySigner } from "applesauce-signers";
import { BehaviorSubject, of, Subject } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { createKehtoShellAdapter } from "../../index.js";
import type { KehtoContext } from "../../types.js";
import { createCountOptions } from "../count.js";

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

describe("count", () => {
  it("selects relays from a reactive public key without a signer", async () => {
    const pubkey = new BehaviorSubject<string | undefined>(alice);
    pool.count.mockReturnValue(of({ "wss://count.relay.com/": { ok: true, value: { count: 1 } } }));
    const count = createCountOptions({ eventStore: store, pool: pool as unknown as RelayPool, pubkey });

    await count.count({ filters: [{ kinds: [1] }], windowId: "w" });
    expect(pool.count.mock.lastCall?.[0]).toContain("wss://alice.relay.com/");

    pubkey.next(bob);
    await count.count({ filters: [{ kinds: [1] }], windowId: "w" });
    expect(pool.count.mock.lastCall?.[0]).toContain("wss://bob-in.relay.com/");
  });

  it("returns partial counts at the deadline and releases the relay subscription", async () => {
    vi.useFakeTimers();
    onTestFinished(() => vi.useRealTimers());
    const responses = new Subject<any>();
    pool.count.mockReturnValue(responses);
    const count = createCountOptions(await create());
    const result = count.count({ filters: [{ kinds: [1] }], windowId: "w" });

    responses.next({ "wss://a.relay.com/": { ok: true, value: { count: 3 } } });
    await vi.advanceTimersByTimeAsync(50);

    expect(await result).toMatchObject({ ok: true, count: 3 });
    expect(responses.observed).toBe(false);
  });

  it("bounds settings that never emit", async () => {
    vi.useFakeTimers();
    onTestFinished(() => vi.useRealTimers());
    const settings = new Subject<string>();
    const count = createCountOptions({ ...(await create()), pubkey: settings });
    const result = count.count({ filters: [{ kinds: [1] }], windowId: "w" });

    await vi.advanceTimersByTimeAsync(50);

    expect(await result).toMatchObject({ ok: false });
    expect(settings.observed).toBe(false);
    expect(pool.count).not.toHaveBeenCalled();
  });

  it("rejects broad requests before contacting relays", async () => {
    const count = createCountOptions(await create());
    expect(await count.count({ filters: [{}], windowId: "w" })).toMatchObject({ ok: false });
    expect(await count.count({ filters: [], windowId: "w" })).toMatchObject({ ok: false });
    expect(pool.count).not.toHaveBeenCalled();
  });

  it("ignores malformed counts without losing a valid zero", async () => {
    pool.count.mockReturnValue(
      of({
        "wss://a.relay.com/": { ok: true, value: { count: Infinity } },
        "wss://b.relay.com/": { ok: true, value: { count: 0 } },
      }),
    );
    const count = createCountOptions(await create());
    expect(await count.count({ filters: [{ kinds: [1] }], windowId: "w" })).toMatchObject({ ok: true, count: 0 });
  });

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
