import { EventStore } from "applesauce-core";
import { finalizeEvent, kinds, unixNow } from "applesauce-core/helpers";
import { getPublicKey } from "applesauce-core/helpers/keys";
import type { RelayPool } from "applesauce-relay";
import { PrivateKeySigner } from "applesauce-signers";
import { BehaviorSubject, Subject } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createKehtoServices, createKehtoShellAdapter } from "../index.js";
import type { KehtoContext } from "../types.js";

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

describe("registry", () => {
  it("creates every service unless disabled", async () => {
    const state = await create();
    expect(Object.keys(createKehtoServices(state)).sort()).toEqual([
      "common",
      "count",
      "dm",
      "identity",
      "lists",
      "outbox",
      "resource",
      "upload",
    ]);
    expect(
      Object.keys(createKehtoServices(state, { disable: ["upload", "count", "lists", "resource", "dm"] })).sort(),
    ).toEqual(["common", "identity", "outbox"]);
  });

  it("keeps service creation lazy and stops shell snapshots without owning the host loader", async () => {
    const signer$ = new BehaviorSubject<PrivateKeySigner | undefined>(signer);
    const fallbackRelays = new BehaviorSubject(["wss://fallback.relay.com/"]);
    const context = await create({ signer: signer$, fallbackRelays });
    const loader = vi.fn();
    store.eventLoader = loader;
    createKehtoServices(context);
    expect(signer$.observed).toBe(false);
    expect(fallbackRelays.observed).toBe(false);

    const adapter = createKehtoShellAdapter(context);
    adapters.push(adapter);
    await vi.waitFor(() => expect(adapter.auth.getUserPubkey()).toBe(alice));
    const cleanup = vi.fn();
    adapter.relayPool.trackSubscription("test", cleanup);
    signer$.next(new PrivateKeySigner(bobKey));
    expect(adapter.auth.getUserPubkey()).toBeNull();
    expect(adapter.auth.getSigner()).toBeNull();
    await vi.waitFor(() => expect(adapter.auth.getUserPubkey()).toBe(bob));

    adapter.stop();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(signer$.observed).toBe(false);
    expect(fallbackRelays.observed).toBe(false);
    expect(store.eventLoader).toBe(loader);
  });

  it("creates a shell adapter that exposes the current user and signer", async () => {
    const adapter = createKehtoShellAdapter(await create());
    adapters.push(adapter);
    await vi.waitFor(() => expect(adapter.auth.getUserPubkey()).toBe(alice));
    expect(await adapter.auth.getSigner("w")?.getPublicKey()).toBe(alice);
    expect(adapter.relayPool.selectRelayTier([])).toEqual(["wss://alice.relay.com/"]);
    expect(adapter.services?.identity).toBeDefined();
  });
});
