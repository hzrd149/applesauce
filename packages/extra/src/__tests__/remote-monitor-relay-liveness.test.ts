import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventStore } from "applesauce-core";
import { finalizeEvent, type NostrEvent } from "applesauce-core/helpers/event";
import { getPublicKey } from "applesauce-core/helpers/keys";
import { ignoreUnhealthyRelays, type RelayPool } from "applesauce-relay";
import { defer, of, Subject } from "rxjs";
import { RemoteMonitorRelayLiveness, type Nip66Monitor } from "../remote-monitor-relay-liveness.js";

const a = new Uint8Array(32).fill(7);
const b = new Uint8Array(32).fill(8);
const stranger = new Uint8Array(32).fill(9);
const relay = "wss://relay.example/";
const source = "wss://monitor.example/";
let store: EventStore;
let instances: RemoteMonitorRelayLiveness[];
const monitor = (key: Uint8Array, negatives = false): Nip66Monitor => ({
  pubkey: getPublicKey(key),
  relays: [source],
  // Test-only explicit-negative format; this is not a standard NIP-66 tag.
  interpretReport: negatives
    ? (report, capability) =>
        report.event.tags.some((tag) => tag[0] === `failed-${capability}`)
          ? "offline"
          : report.rttRead !== undefined
            ? "online"
            : "unknown"
    : undefined,
});
function create(monitors = [monitor(a)], options: Partial<ConstructorParameters<typeof RemoteMonitorRelayLiveness>[1]> = {}) {
  const tracker = new RemoteMonitorRelayLiveness(store, { monitors, maxAge: 60_000, ...options });
  instances.push(tracker);
  return tracker;
}
function report(key: Uint8Array, tags: string[][] = [["rtt-read", "10"]], offset = 0, url = relay) {
  return finalizeEvent(
    { kind: 30166, created_at: Math.floor(Date.now() / 1000) + offset, content: "", tags: [["d", url], ...tags] },
    key,
  );
}
function announce(key: Uint8Array, frequency: number) {
  return finalizeEvent(
    { kind: 10166, created_at: Math.floor(Date.now() / 1000), content: "", tags: [["frequency", String(frequency)]] },
    key,
  );
}
const flush = () => vi.advanceTimersByTimeAsync(50);
beforeEach(() => {
  vi.useFakeTimers({ now: 1_800_000_000_000 });
  store = new EventStore();
  instances = [];
});
afterEach(() => {
  for (const instance of instances) instance.destroy();
  store.dispose();
  vi.useRealTimers();
});

describe("NIP-66 positive observations", () => {
  it("preserves unknown relays and accepts fresh signed reports from configured monitors", async () => {
    const tracker = create();
    expect(tracker.filter([relay])).toEqual([relay]);
    expect(tracker.getState(relay).state).toBe("unknown");
    store.add(report(a));
    await flush();
    expect(tracker.getState(relay).state).toBe("online");
    expect(tracker.getState(relay).observations[0].monitor).toBe(getPublicKey(a));
    expect(tracker.unhealthy).toEqual([]);
  });

  it("does not turn absent RTTs, old reports, or an offline client into monitor negatives", async () => {
    const tracker = create();
    store.add(report(a, [["rtt-open", "10"]]));
    await flush();
    expect(tracker.getState(relay).state).toBe("unknown");
    expect(tracker.filter([relay, "wss://unmonitored.example/"])).toHaveLength(2);
    expect("recordFailure" in tracker).toBe(false);
  });

  it("expires observations to unknown and emits expiry without new network data", async () => {
    const tracker = create();
    const statuses: string[] = [];
    const sub = tracker.state(relay).subscribe((state) => statuses.push(state.state));
    store.add(report(a));
    await flush();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(statuses).toEqual(["unknown", "online", "unknown"]);
    expect(tracker.getState(relay).observations).toEqual([]);
    sub.unsubscribe();
  });

  it("uses announced cadence while capping observation lifetime", async () => {
    const tracker = create();
    store.add(announce(a, 5));
    store.add(report(a));
    await flush();
    expect(tracker.getState(relay).observations[0].expiresAt).toBe(
      tracker.getState(relay).observations[0].observedAt + 15_000,
    );
    await vi.advanceTimersByTimeAsync(15_000);
    expect(tracker.getState(relay).state).toBe("unknown");
  });

  it("handles wall-clock jumps even when a timer has not executed", async () => {
    const tracker = create();
    store.add(report(a));
    await flush();
    vi.setSystemTime(Date.now() + 120_000);
    expect(tracker.getState(relay).state).toBe("unknown");
    expect(tracker.online).toEqual([]);
  });

  it("scopes observations to the requested capability and network", async () => {
    const tracker = create();
    store.add(
      report(a, [
        ["rtt-read", "0"],
        ["n", "tor"],
      ]),
    );
    await flush();
    expect(tracker.getState(relay).state).toBe("unknown");
    const tor = create([monitor(a)], { network: "tor" });
    await flush();
    expect(tor.getState(relay).state).toBe("online");
    const writes = create([monitor(a)], { network: "tor", capability: "write" });
    await flush();
    expect(writes.getState(relay).state).toBe("unknown");
  });

  it("does not use clearnet reports to classify onion relays", async () => {
    const url = "ws://relayexample.onion/";
    const tracker = create();
    store.add(report(a, [["rtt-read", "10"]], 0, url));
    await flush();
    expect(tracker.getState(url).state).toBe("unknown");
  });

  it("ignores untrusted publishers, invalid signatures, and implausible future events", async () => {
    const tracker = create();
    store.add(report(stranger));
    const forged = JSON.parse(JSON.stringify(report(a))) as NostrEvent;
    forged.sig = "0".repeat(128);
    store.add(forged);
    store.add(report(a, [["rtt-read", "10"]], 3600));
    await flush();
    expect(tracker.getState(relay).state).toBe("unknown");
  });

  it("normalizes both state queries and filter hints", async () => {
    const tracker = create();
    store.add(report(a, undefined, 0, "wss://RELAY.example"));
    await flush();
    expect(tracker.getState(relay).state).toBe("online");
  });

  it("does not accept malformed or negative RTT as a positive check", async () => {
    const tracker = create();
    for (const [i, value] of ["NaN", "-1", "10bad", ""].entries())
      store.add(report(a, [["rtt-read", value]], 0, `wss://bad${i}.example/`));
    await flush();
    expect(tracker.online).toEqual([]);
  });
});

describe("explicit negative consensus", () => {
  it("requires both configured publishers by default and preserves unmonitored hints", async () => {
    const tracker = create([monitor(a, true), monitor(b, true)]);
    store.add(report(a, [["failed-read", "true"]]));
    await flush();
    expect(tracker.getState(relay).state).toBe("unknown");
    store.add(report(b, [["failed-read", "true"]]));
    await flush();
    expect(tracker.unhealthy).toEqual([relay]);
    expect(tracker.filter([relay, "wss://unmonitored.example/"])).toEqual(["wss://unmonitored.example/"]);
  });

  it("supports explicit single-monitor trust and restores eligibility on expiry", async () => {
    const tracker = create([monitor(a, true)]);
    const results: string[][] = [];
    const sub = of([relay])
      .pipe(ignoreUnhealthyRelays(tracker))
      .subscribe((value) => results.push(value));
    store.add(report(a, [["failed-read", "true"]]));
    await flush();
    expect(results[results.length - 1]).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(results[results.length - 1]).toEqual([relay]);
    sub.unsubscribe();
  });

  it("lets any fresh positive veto conflicting negatives", async () => {
    const tracker = create([monitor(a, true), monitor(b, true)], { offlineQuorum: 1 });
    store.add(report(a, [["failed-read", "true"]]));
    store.add(report(b));
    await flush();
    expect(tracker.getState(relay).state).toBe("online");
  });

  it("does not count a publisher twice through different URL aliases", async () => {
    const tracker = create([monitor(a, true), monitor(b, true)]);
    store.add(report(a, [["failed-read", "true"]], 0, "wss://RELAY.example"));
    store.add(report(a, [["failed-read", "true"]]));
    await flush();
    expect(tracker.getState(relay).observations).toHaveLength(1);
    expect(tracker.unhealthy).toEqual([]);
  });

  it("uses the latest revision and responds to removal from the store", async () => {
    const tracker = create([monitor(a, true)]);
    const negative = report(a, [["failed-read", "true"]]);
    store.add(negative);
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    const positive = report(a);
    store.add(positive);
    await flush();
    expect(tracker.getState(relay).state).toBe("online");
    store.remove(positive);
    await flush();
    expect(tracker.getState(relay).state).toBe("unknown");
  });

  it("turns decoder errors into unknown evidence", async () => {
    const tracker = create([
      {
        ...monitor(a),
        interpretReport: () => {
          throw new Error("Unknown provider schema");
        },
      },
    ]);
    store.add(report(a));
    await flush();
    expect(tracker.getState(relay).state).toBe("unknown");
  });
});

describe("monitor subscriptions and lifecycle", () => {
  it("subscribes only to configured monitor events and detaches idempotently", async () => {
    const messages = new Subject<NostrEvent>();
    const pool = { subscription: vi.fn(() => messages) } as unknown as RelayPool;
    const tracker = create();
    tracker.connectToPool(pool);
    tracker.connectToPool(pool);
    expect(pool.subscription).toHaveBeenCalledTimes(1);
    messages.next(report(a));
    await flush();
    expect(tracker.online).toEqual([relay]);
    expect(messages.observers).toHaveLength(1);
    tracker.disconnectFromPool(pool);
    expect(messages.observers).toHaveLength(0);
    expect((pool.subscription as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual([source]);
  });

  it("fails open for unavailable negative sources and recovers from monitor transport errors", async () => {
    let messages = new Subject<NostrEvent>();
    const pool = { subscription: vi.fn(() => defer(() => messages)) } as unknown as RelayPool;
    const tracker = create([monitor(a, true)]);
    tracker.connectToPool(pool);
    messages.next(report(a, [["failed-read", "true"]]));
    await flush();
    expect(tracker.unhealthy).toEqual([relay]);
    messages.error(new Error("Client network unavailable"));
    await flush();
    expect(tracker.unhealthy).toEqual([]);
    messages = new Subject<NostrEvent>();
    await vi.advanceTimersByTimeAsync(5000);
    messages.next(report(a, [["failed-read", "true"]]));
    await flush();
    expect(tracker.unhealthy).toEqual([relay]);
  });

  it("releases retry and expiry timers on destruction", async () => {
    const messages = new Subject<NostrEvent>();
    const pool = { subscription: vi.fn(() => messages) } as unknown as RelayPool;
    const tracker = create();
    tracker.connectToPool(pool);
    messages.next(report(a));
    await flush();
    tracker.destroy();
    expect(messages.observers).toHaveLength(0);
    store.dispose(); // The shared store owns its model keep-warm timers.
    expect(vi.getTimerCount()).toBe(0);
    expect(() => tracker.connectToPool(pool)).toThrow("destroyed");
  });

  it("validates identities, quorum, and observation lifetimes", () => {
    expect(() => create([])).toThrow(RangeError);
    expect(() => create([monitor(a), monitor(a)])).toThrow(RangeError);
    expect(() => create([monitor(a)], { offlineQuorum: 2 })).toThrow(RangeError);
    expect(() => create([monitor(a)], { maxAge: Infinity })).toThrow(RangeError);
  });
});

describe("stale reports", () => {
  const other = "wss://other.example/";
  // A report for the relay older than the 60s lifetime, plus a fresh report showing the monitor is still active
  const staleAndActive = (key: Uint8Array) => {
    store.add(report(key, [["rtt-read", "10"]], -120));
    store.add(report(key, [["rtt-read", "10"]], 0, other));
  };

  it("counts an active monitor's expired report as offline when enabled", async () => {
    const tracker = create([monitor(a), monitor(b)], { staleAsOffline: true });
    staleAndActive(a);
    staleAndActive(b);
    await flush();
    expect(tracker.getState(relay).state).toBe("offline");
    expect(tracker.filter([relay, other])).toEqual([other]);
  });

  it("ignores expired reports by default", async () => {
    const tracker = create([monitor(a), monitor(b)]);
    staleAndActive(a);
    staleAndActive(b);
    await flush();
    expect(tracker.getState(relay).state).toBe("unknown");
  });

  it("ignores expired reports from a monitor that stopped reporting entirely", async () => {
    const tracker = create([monitor(a)], { staleAsOffline: true });
    store.add(report(a, [["rtt-read", "10"]], -120));
    await flush();
    expect(tracker.getState(relay).state).toBe("unknown");
  });

  it("still requires the offline quorum and lets a fresh positive win", async () => {
    const tracker = create([monitor(a), monitor(b)], { staleAsOffline: true });
    staleAndActive(a);
    store.add(report(b));
    await flush();
    expect(tracker.getState(relay).state).toBe("online");
  });

  it("requests reports without a time window so expired reports can be seen", () => {
    const tracker = create([monitor(a)], { staleAsOffline: true });
    const subscription = vi.fn(() => of());
    tracker.connectToPool({ subscription } as unknown as RelayPool);
    const filters = (subscription.mock.calls[0] as unknown[])[1] as { kinds: number[]; since?: number }[];
    expect(filters.find((f) => f.kinds.includes(30166))?.since).toBeUndefined();
  });
});
