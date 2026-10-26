import { EventStore } from "applesauce-core";
import { finalizeEvent, kinds, unixNow } from "applesauce-core/helpers";
import { getPublicKey } from "applesauce-core/helpers/keys";
import type { RelayPool } from "applesauce-relay";
import { PrivateKeySigner } from "applesauce-signers";
import { BehaviorSubject, Subject } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createKehtoIdentityService,
  createKehtoOutboxService,
  createKehtoCountService,
  createKehtoCommonService,
  createKehtoListsService,
  createKehtoResourceService,
  createKehtoUploadService,
  createKehtoDmService,
  createKehtoShellAdapter,
} from "../index.js";
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
  it("includes only the services supplied by the app", async () => {
    const context = await create();
    const services = {
      identity: createKehtoIdentityService(context),
      outbox: createKehtoOutboxService(context),
    };
    const adapter = createKehtoShellAdapter(context, { services });
    adapters.push(adapter);
    expect(Object.keys(adapter.services!).sort()).toEqual(["identity", "outbox"]);
    expect(adapter.services!.dm).toBeUndefined();
    expect(adapter.upload).toBeUndefined();
    expect(services.identity.descriptor.name).toBe("identity");
    expect(services.outbox.descriptor.name).toBe("outbox");
  });

  it("includes no implicit services", async () => {
    const context = await create();
    for (const options of [undefined, { services: {} }]) {
      const adapter = createKehtoShellAdapter(context, options);
      adapters.push(adapter);
      expect(adapter.services).toEqual({});
      expect(adapter.common).toBeUndefined();
      expect(adapter.lists).toBeUndefined();
      expect(adapter.upload).toBeUndefined();
    }
  });

  it("keeps service creation lazy and stops shell snapshots without owning the host loader", async () => {
    const signer$ = new BehaviorSubject<PrivateKeySigner | undefined>(signer);
    const fallbackRelays = new BehaviorSubject(["wss://fallback.relay.com/"]);
    const context = await create({ signer: signer$, fallbackRelays });
    const loader = vi.fn();
    store.eventLoader = loader;
    const constructors = [
      createKehtoIdentityService,
      createKehtoOutboxService,
      createKehtoCountService,
      createKehtoCommonService,
      createKehtoListsService,
      createKehtoResourceService,
      createKehtoUploadService,
      createKehtoDmService,
    ];
    for (const construct of constructors) construct(context);
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
    expect(adapter.services).toEqual({});
  });
});

describe("shell composition", () => {
  it("keeps transport hooks when a host adds scoped relay support", async () => {
    const openScopedRelay = vi.fn();
    const adapter = createKehtoShellAdapter(await create(), { overrides: { relayPool: { openScopedRelay } } });
    adapters.push(adapter);
    expect(adapter.relayPool.openScopedRelay).toBe(openScopedRelay);
    expect(adapter.relayPool.getRelayPool()).toBeDefined();
    const cleanup = vi.fn();
    adapter.relayPool.trackSubscription("test", cleanup);
    adapter.relayPool.untrackSubscription("test");
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("advertises app services and unregisters them once", async () => {
    const replacement = {
      descriptor: { name: "lists", version: "1.0.0" },
      handleMessage: vi.fn(),
      onUnregistered: vi.fn(),
    };
    const link = { descriptor: { name: "link", version: "1.0.0" }, handleMessage: vi.fn() };
    const adapter = createKehtoShellAdapter(await create(), {
      services: { lists: replacement, link },
    });
    adapters.push(adapter);
    expect(adapter.services?.lists).toBe(replacement);
    expect(adapter.services?.upload).toBeUndefined();
    expect(adapter.upload).toBeUndefined();
    expect(adapter.link?.isAvailable()).toBe(true);
    adapter.stop();
    adapter.stop();
    expect(replacement.onUnregistered).toHaveBeenCalledOnce();
  });

  it("can release transport snapshots after the runtime unregisters services", async () => {
    const replacement = {
      descriptor: { name: "lists", version: "1.0.0" },
      handleMessage: vi.fn(),
      onUnregistered: vi.fn(),
    };
    const adapter = createKehtoShellAdapter(await create(), { services: { lists: replacement } });
    adapters.push(adapter);
    replacement.onUnregistered();
    adapter.stop({ services: false });
    expect(replacement.onUnregistered).toHaveBeenCalledOnce();
  });
});
