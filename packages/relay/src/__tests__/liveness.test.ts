import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BehaviorSubject, firstValueFrom, of, Subject, throwError } from "rxjs";
import { RelayGroupError } from "../group.js";
import { RelayPool } from "../pool.js";
import type { Relay } from "../relay.js";
import { RelayConnectionError, RelayFirstResponseTimeoutError } from "../relay.js";
import { ignoreUnhealthyRelays } from "../operators/liveness.js";
import { RelayLiveness } from "../liveness.js";

const relay = "wss://relay.example.com/";
let liveness: RelayLiveness;

beforeEach(() => {
  vi.useFakeTimers();
  liveness = new RelayLiveness({ backoffBaseDelay: 1000, backoffMaxDelay: 60_000 });
});

afterEach(() => {
  liveness.destroy();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("recordFailure", () => {
  it("should clear the backoff once it ends", () => {
    liveness.recordFailure(relay);
    expect(liveness.isInBackoff(relay)).toBe(true);

    vi.advanceTimersByTime(1000);
    expect(liveness.getState(relay)?.backoffUntil).toBeUndefined();
  });

  it("should not let an earlier backoff timer end a newer backoff", () => {
    liveness.recordFailure(relay);
    vi.advanceTimersByTime(500);
    liveness.recordSuccess(relay);
    vi.advanceTimersByTime(100);
    liveness.recordFailure(relay);

    // The first failure's timer would fire here, 400ms before the second backoff ends
    vi.advanceTimersByTime(500);
    expect(liveness.isInBackoff(relay)).toBe(true);
  });
});

describe("revive", () => {
  it("should put a revived relay in backoff for the max delay", () => {
    liveness = new RelayLiveness({
      backoffBaseDelay: 1000,
      backoffMaxDelay: 60_000,
      maxFailuresBeforeDead: 1,
      minFailureDuration: 0,
    });
    liveness.recordSuccess("wss://other.example/");
    liveness.recordFailure(relay);
    expect(liveness.getState(relay)?.state).toBe("dead");

    liveness.revive(relay);
    expect(liveness.getState(relay)?.state).toBe("offline");
    expect(liveness.isInBackoff(relay)).toBe(true);

    vi.advanceTimersByTime(60_000);
    expect(liveness.isInBackoff(relay)).toBe(false);
  });
});

describe("conservative failure evidence", () => {
  it("never permanently excludes relays during a shared client outage", () => {
    for (let i = 0; i < 12; i++) {
      liveness.recordFailure(relay);
      vi.advanceTimersByTime(60_000);
    }
    expect(liveness.getState(relay)?.state).toBe("offline");
    expect(liveness.filter([relay])).toEqual([relay]);
  });

  it("requires elapsed failure history and another recently reachable relay", () => {
    liveness.destroy();
    liveness = new RelayLiveness({
      backoffBaseDelay: 1000,
      minFailureDuration: 10_000,
      maxFailuresBeforeDead: 2,
      deadRetryDelay: 5000,
    });
    liveness.recordSuccess("wss://other.example/");
    liveness.recordFailure(relay);
    vi.advanceTimersByTime(1000);
    liveness.recordFailure(relay);
    expect(liveness.getState(relay)?.state).toBe("offline");
    vi.advanceTimersByTime(9000);
    liveness.recordSuccess("wss://other.example/");
    liveness.recordFailure(relay);
    expect(liveness.dead).toEqual([relay]);
    vi.advanceTimersByTime(5000);
    expect(liveness.filter([relay])).toEqual([relay]);
    expect(liveness.dead).toEqual([]);
  });

  it("accepts success even when a relay was classified dead", () => {
    liveness.destroy();
    liveness = new RelayLiveness({ minFailureDuration: 0, maxFailuresBeforeDead: 1 });
    liveness.recordSuccess("wss://other.example/");
    liveness.recordFailure(relay);
    expect(liveness.dead).toEqual([relay]);
    liveness.recordSuccess(relay);
    expect(liveness.unhealthy).toEqual([]);
    expect(liveness.getState(relay)?.failureCount).toBe(0);
  });

  it("ignores offline and recovery-grace failures and clears outage history", () => {
    liveness.recordFailure(relay);
    liveness.setNetworkAvailable(false);
    vi.advanceTimersByTime(1000);
    liveness.recordFailure(relay);
    expect(liveness.getState(relay)?.failureCount).toBe(1);
    liveness.setNetworkAvailable(true);
    expect(liveness.filter([relay])).toEqual([relay]);
    liveness.recordFailure(relay);
    expect(liveness.getState(relay)?.failureCount).toBe(0);
    vi.advanceTimersByTime(15_000);
    liveness.recordFailure(relay);
    expect(liveness.getState(relay)?.failureCount).toBe(1);
  });

  it("does not treat policy errors or arbitrary request deadlines as offline evidence", () => {
    liveness.recordRequestFailure(relay, new Error("restricted"));
    liveness.recordRequestFailure(relay, { name: "TimeoutError" });
    expect(liveness.getState(relay)).toBeUndefined();
    liveness.recordRequestFailure(relay, new RelayConnectionError(relay));
    expect(liveness.isInBackoff(relay)).toBe(true);
  });

  it("starts a new failure streak after a long gap", () => {
    liveness.recordFailure(relay);
    vi.advanceTimersByTime(31 * 60_000);
    liveness.recordFailure(relay);
    expect(liveness.getState(relay)?.failureCount).toBe(1);
  });
});

describe("reactive eligibility and persistence", () => {
  it("canonicalizes URL aliases and emits only when exclusion changes", () => {
    const outputs: string[][] = [];
    const sub = of(["wss://relay.example.com"])
      .pipe(ignoreUnhealthyRelays(liveness))
      .subscribe((urls) => outputs.push(urls));
    liveness.recordFailure(relay);
    liveness.recordSuccess("wss://other.example/");
    expect(outputs).toEqual([["wss://relay.example.com"], []]);
    vi.advanceTimersByTime(1000);
    expect(outputs.at(-1)).toEqual(["wss://relay.example.com"]);
    sub.unsubscribe();
  });

  it("restores bounded cooldowns, downgrades historical dead states, and reinstalls timers", async () => {
    const state = {
      state: "dead",
      failureCount: 9,
      lastFailureTime: Date.now(),
      lastSuccessTime: 0,
      backoffUntil: Date.now() + 1_000_000,
    };
    liveness.destroy();
    liveness = new RelayLiveness({
      backoffMaxDelay: 1000,
      storage: { getItem: (key) => (key === "known" ? [relay, "invalid"] : state), setItem: vi.fn() },
    });
    await liveness.load();
    expect(liveness.getState(relay)?.state).toBe("offline");
    expect(liveness.unhealthy).toEqual([relay]);
    vi.advanceTimersByTime(1000);
    expect(liveness.unhealthy).toEqual([]);
  });

  it("persists the first relay in the known index and removes reset entries", async () => {
    const data = new Map();
    liveness.destroy();
    liveness = new RelayLiveness({
      storage: {
        getItem: (key) => data.get(key),
        setItem: async (key, value) => {
          data.set(key, value);
        },
      },
    });
    liveness.recordFailure(relay);
    await liveness.save();
    expect(data.get("known")).toEqual([relay]);
    liveness.reset(relay);
    await liveness.save();
    expect(data.get("known")).toEqual([]);
  });

  it("clears pending timers on reset and destroy", () => {
    liveness.recordFailure(relay);
    liveness.reset(relay);
    expect(vi.getTimerCount()).toBe(0);
    liveness.recordFailure(relay);
    liveness.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("pool lifecycle", () => {
  it("attaches existing members once and detaches every relay observer", () => {
    const pool = new RelayPool();
    const instance = {
      url: relay,
      connected: false,
      open$: new Subject(),
      close$: new Subject(),
      message$: new Subject(),
      attempts$: new BehaviorSubject(2),
    };
    pool.relays.set(relay, instance as unknown as Relay);
    liveness.connectToPool(pool);
    liveness.connectToPool(pool);
    expect(instance.open$.observers).toHaveLength(1);
    expect(liveness.getState(relay)).toBeUndefined();
    instance.attempts$.next(3);
    expect(liveness.getState(relay)?.failureCount).toBe(1);
    instance.open$.next({});
    expect(liveness.getState(relay)?.failureCount).toBe(1);
    instance.message$.next(["EOSE", "sub"]);
    expect(liveness.getState(relay)?.state).toBe("online");
    liveness.disconnectFromPool(pool);
    expect(instance.open$.observers).toHaveLength(0);
    expect(instance.close$.observers).toHaveLength(0);
    expect(instance.message$.observers).toHaveLength(0);
    expect(instance.attempts$.observers).toHaveLength(0);
  });
});

describe("platform recovery and asynchronous evidence", () => {
  it("suppresses hidden failures and retries on foreground without manufacturing success", () => {
    liveness.destroy();
    const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
    const browser = Object.assign(new EventTarget(), { navigator: { onLine: true } });
    vi.stubGlobal("window", browser);
    vi.stubGlobal("document", doc);
    liveness = new RelayLiveness();
    liveness.recordFailure(relay);
    doc.visibilityState = "hidden";
    vi.advanceTimersByTime(60_000);
    liveness.recordFailure(relay);
    expect(liveness.getState(relay)?.failureCount).toBe(1);
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(liveness.filter([relay])).toEqual([relay]);
    expect(liveness.getState(relay)?.lastSuccessTime).toBe(0);
    liveness.recordFailure(relay);
    expect(liveness.getState(relay)?.failureCount).toBe(0);
    vi.advanceTimersByTime(15_000);
    browser.dispatchEvent(new Event("offline"));
    liveness.recordFailure(relay);
    expect(liveness.getState(relay)?.failureCount).toBe(0);
    browser.dispatchEvent(new Event("online"));
    vi.advanceTimersByTime(15_000);
    liveness.recordFailure(relay);
    expect(liveness.getState(relay)?.failureCount).toBe(1);
    liveness.destroy();
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(liveness.getState(relay)?.failureCount).toBe(1);
  });

  it("does not overwrite live evidence while storage loads", async () => {
    liveness.destroy();
    let resolve!: (value: unknown) => void;
    liveness = new RelayLiveness({
      storage: {
        getItem: (key) =>
          key === "known"
            ? [relay]
            : new Promise((r) => {
                resolve = r;
              }),
        setItem: vi.fn(),
      },
    });
    const loading = liveness.load();
    await Promise.resolve();
    liveness.recordSuccess(relay);
    resolve({ state: "dead", failureCount: 10, lastFailureTime: Date.now(), lastSuccessTime: 0 });
    await loading;
    expect(liveness.getState(relay)?.state).toBe("online");
  });

  it("ignores a failed request when newer traffic proves reachability", () => {
    const startedAt = Date.now();
    liveness.recordSuccess(relay);
    vi.advanceTimersByTime(100);
    liveness.recordSuccess(relay); // Online snapshot is throttled; fresh evidence is still retained.
    liveness.recordRequestFailure(relay, new RelayConnectionError(relay), startedAt);
    expect(liveness.unhealthy).toEqual([]);
  });

  it("counts the relay's auth-aware first response timeout", () => {
    liveness.recordRequestFailure(relay, new RelayFirstResponseTimeoutError(relay));
    expect(liveness.getState(relay)?.failureCount).toBe(1);
  });

  it("rejects unsafe configuration before installing timers", () => {
    expect(() => new RelayLiveness({ deadRetryDelay: Infinity })).toThrow(RangeError);
    expect(() => new RelayLiveness({ maxFailuresBeforeDead: 0 })).toThrow(RangeError);
    expect(() => new RelayLiveness({ backoffBaseDelay: -1 })).toThrow(RangeError);
  });
});

it("classifies only the requested relay inside aggregate pool errors", () => {
  const other = "wss://other.example/";
  const aggregate = new RelayGroupError([
    [relay, new RelayFirstResponseTimeoutError(relay)],
    [other, new Error("restricted")],
  ]);
  liveness.recordRequestFailure(other, aggregate);
  expect(liveness.getState(other)).toBeUndefined();
  liveness.recordRequestFailure("wss://relay.example.com", aggregate);
  expect(liveness.getState(relay)?.failureCount).toBe(1);
});

it("classifies failures returned by the real pool request wrapper", async () => {
  const pool = new RelayPool();
  const instance = { url: relay, req: () => throwError(() => new RelayFirstResponseTimeoutError(relay)) };
  pool.relays.set(relay, instance as unknown as Relay);
  const error = await firstValueFrom(pool.request([relay], {})).catch((error) => error);
  expect(error).toBeInstanceOf(RelayGroupError);
  liveness.recordRequestFailure(relay, error);
  expect(liveness.getState(relay)?.failureCount).toBe(1);
});

it("rearms cooldown expiry after the wall clock moves backward", () => {
  liveness.recordFailure(relay);
  vi.setSystemTime(Date.now() - 10_000);
  vi.advanceTimersByTime(1000);
  expect(liveness.isInBackoff(relay)).toBe(true);
  expect(vi.getTimerCount()).toBe(1);
  vi.advanceTimersByTime(10_000);
  expect(liveness.unhealthy).toEqual([]);
});
