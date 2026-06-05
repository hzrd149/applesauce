import { Token } from "@cashu/cashu-ts";
import { EventStore } from "applesauce-core";
import { User } from "applesauce-core/casts";
import type { RelayPool } from "applesauce-relay";
import { EMPTY, firstValueFrom, of } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FakeUser } from "../../__tests__/fake-user.js";
import type { Couch } from "../../helpers/couch.js";
import { WALLET_KIND } from "../../helpers/wallet.js";
import { computeTokenRelayCoverage, NutWallet } from "../nut-wallet.js";
import type { WalletToken } from "../../casts/wallet-token.js";
import { WalletStatus } from "../types.js";

const signer = new FakeUser();

/** A minimal in-memory couch for tests */
function memoryCouch(): Couch {
  let tokens: Token[] = [];
  return {
    store: (token: Token) => {
      tokens.push(token);
      return () => {
        tokens = tokens.filter((t) => t !== token);
      };
    },
    clear: () => {
      tokens = [];
    },
    getAll: () => tokens,
  };
}

/** A mock relay pool that records calls and never touches the network */
function mockPool() {
  return {
    status$: of({}),
    publish: vi.fn().mockResolvedValue([]),
    request: vi.fn().mockReturnValue(EMPTY),
    sync: vi.fn().mockReturnValue(EMPTY),
    subscription: vi.fn().mockReturnValue(EMPTY),
    relay: vi.fn().mockReturnValue({ getSupported: vi.fn().mockResolvedValue([]) }),
  } as unknown as RelayPool & {
    publish: ReturnType<typeof vi.fn>;
    request: ReturnType<typeof vi.fn>;
    sync: ReturnType<typeof vi.fn>;
    subscription: ReturnType<typeof vi.fn>;
  };
}

let eventStore: EventStore;
let pool: ReturnType<typeof mockPool>;
let couch: Couch;

beforeEach(() => {
  eventStore = new EventStore();
  pool = mockPool();
  couch = memoryCouch();
  User.cache.clear();
});

describe("NutWallet.create", () => {
  it("publishes a wallet event to the configured relays", async () => {
    const wallet = await NutWallet.create(
      { pubkey: signer.pubkey, signer, pool, eventStore, couch },
      { mints: ["https://mint.example.com"], relays: ["wss://relay.example.com"] },
    );

    expect(pool.publish).toHaveBeenCalledTimes(1);
    const [relays, event] = pool.publish.mock.calls[0];
    expect(relays).toContain("wss://relay.example.com/");
    expect(event.kind).toBe(WALLET_KIND);
    expect(event.pubkey).toBe(signer.pubkey);

    // The wallet should be saved to the store
    expect(eventStore.getReplaceable(WALLET_KIND, signer.pubkey)).toBeTruthy();

    wallet.stop();
  });

  it("starts loading from the relay pool", async () => {
    const wallet = await NutWallet.create(
      { pubkey: signer.pubkey, signer, pool, eventStore, couch, relays: ["wss://relay.example.com"] },
      { mints: ["https://mint.example.com"], relays: ["wss://relay.example.com"] },
    );

    expect(pool.subscription).toHaveBeenCalled();
    expect(pool.sync).toHaveBeenCalled();

    wallet.stop();
  });
});

describe("settings", () => {
  it("setMints publishes an updated wallet event", async () => {
    const wallet = await NutWallet.create(
      { pubkey: signer.pubkey, signer, pool, eventStore, couch, relays: ["wss://relay.example.com"] },
      { mints: ["https://a.example.com"], relays: ["wss://relay.example.com"] },
    );
    pool.publish.mockClear();

    await wallet.setMints(["https://a.example.com", "https://b.example.com"]);

    expect(pool.publish).toHaveBeenCalledTimes(1);
    const [, event] = pool.publish.mock.calls[0];
    expect(event.kind).toBe(WALLET_KIND);

    wallet.stop();
  });
});

describe("status", () => {
  it("reports idle before start and a status after loading", async () => {
    const wallet = new NutWallet({
      pubkey: signer.pubkey,
      signer,
      pool,
      eventStore,
      couch,
      relays: ["wss://relay.example.com"],
    });

    expect(await firstValueFrom(wallet.status$)).toBe(WalletStatus.Idle);

    await wallet.start();
    // With a mock pool the initial request completes immediately, so the wallet is loaded.
    // No wallet event exists in the store, so the status is "missing".
    expect(await firstValueFrom(wallet.status$)).toBe(WalletStatus.Missing);

    wallet.stop();
  });

  it("exposes per-relay status including negentropy support", async () => {
    pool.relay = vi.fn().mockReturnValue({ getSupported: vi.fn().mockResolvedValue([77]) }) as RelayPool["relay"];

    const wallet = new NutWallet({
      pubkey: signer.pubkey,
      signer,
      pool,
      eventStore,
      couch,
      relays: ["wss://relay.example.com"],
    });
    await wallet.start();

    const statuses = await firstValueFrom(wallet.relayStatus$);
    expect(statuses).toHaveLength(1);
    expect(statuses[0].url).toBe("wss://relay.example.com");
    expect(statuses[0].connected).toBe(false);

    wallet.stop();
  });

  it("tracks busy state during operations", async () => {
    const wallet = await NutWallet.create(
      { pubkey: signer.pubkey, signer, pool, eventStore, couch, relays: ["wss://relay.example.com"] },
      { mints: ["https://mint.example.com"], relays: ["wss://relay.example.com"] },
    );

    const states: boolean[] = [];
    const sub = wallet.busy$.subscribe((busy) => states.push(busy));
    await wallet.setMints(["https://mint.example.com", "https://b.example.com"]);
    sub.unsubscribe();

    // Should have toggled busy true then back to false
    expect(states).toContain(true);
    expect(states[states.length - 1]).toBe(false);

    wallet.stop();
  });
});

describe("computeTokenRelayCoverage", () => {
  const token = (id: string, seen: string[]) => ({ id, seen: new Set(seen) }) as unknown as WalletToken;

  it("reports which target relays are storing each token", () => {
    const a = "wss://a.example.com";
    const b = "wss://b.example.com";
    const coverage = computeTokenRelayCoverage([token("1", [a, b]), token("2", [a])], [a, b]);

    expect(coverage.total).toBe(2);
    expect(coverage.relays).toHaveLength(2);
    // relay a stores both tokens, relay b stores one
    expect(Object.values(coverage.perRelay).sort()).toEqual([1, 2]);

    const token2 = coverage.tokens.find((t) => t.token.id === "2")!;
    expect(token2.stored).toHaveLength(1);
    expect(token2.missing).toHaveLength(1);
  });

  it("falls back to the union of seen relays when no wallet relays are given", () => {
    const coverage = computeTokenRelayCoverage([token("1", ["wss://a.example.com"]), token("2", ["wss://b.example.com"])], []);
    expect(coverage.relays).toHaveLength(2);
  });
});

describe("start/stop", () => {
  it("is idempotent and tears down subscriptions", async () => {
    const wallet = new NutWallet({
      pubkey: signer.pubkey,
      signer,
      pool,
      eventStore,
      couch,
      relays: ["wss://relay.example.com"],
    });

    await wallet.start();
    await wallet.start();
    expect(pool.subscription).toHaveBeenCalledTimes(1);

    wallet.stop();
    // Restarting after stop works
    await wallet.start();
    expect(pool.subscription).toHaveBeenCalledTimes(2);

    wallet.stop();
  });
});
