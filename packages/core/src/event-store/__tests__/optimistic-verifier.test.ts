import { finalizeEvent, generateSecretKey, verifiedSymbol, type NostrEvent } from "nostr-tools/pure";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventStore } from "../event-store.js";
import { OptimisticEventVerifier } from "../optimistic-verifier.js";
import { addSeenRelay } from "../../helpers/relays.js";

const secret = generateSecretKey();
const url = "wss://relay.example.com/";
const day = Math.floor(Date.now() / 86_400_000);
const trusted = JSON.stringify({ version: 1, days: Array.from({ length: 14 }, (_, i) => [day - i, 1000]) });
function event(content = "hello") {
  const e = finalizeEvent({ kind: 1, content, tags: [], created_at: 1 }, secret);
  addSeenRelay(e, url);
  return e;
}
const drain = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

afterEach(() => vi.restoreAllMocks());

describe("OptimisticEventVerifier", () => {
  it("works directly with EventStore and rejects invalid signatures despite cached symbols", () => {
    const store = new EventStore({ verifyEvent: new OptimisticEventVerifier().verifyEvent });
    expect(store.add(event())).not.toBeNull();
    const bad = event("bad");
    bad.sig = "0".repeat(128);
    expect(bad[verifiedSymbol]).toBe(true);
    expect(store.add(bad)).toBeNull();
  });

  it("persists only distinct successful signature checks", async () => {
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() };
    const verify = new OptimisticEventVerifier({ storage }).verifyEvent;
    const e = event();
    verify(e);
    await drain();
    expect(verify(e)).toBe(true);
    const second = event("second");
    expect(verify(second)).toBe(true);
    expect(verify(second)).toBe(true);
    await drain();
    expect(JSON.parse(storage.setItem.mock.calls.at(-1)![1]).days).toEqual([[day, 1]]);
  });

  it("samples only after hydration and never marks skipped signatures verified", async () => {
    const storage = { getItem: () => trusted, setItem: vi.fn() };
    const verify = new OptimisticEventVerifier({ storage }).verifyEvent;
    const bad = event();
    bad.sig = "0".repeat(128);
    const clean = JSON.parse(JSON.stringify(bad)) as NostrEvent;
    addSeenRelay(clean, url);
    // Prime hydration with a valid delivery.
    expect(verify(event("prime"))).toBe(true);
    await drain();
    vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
      (array as Uint32Array)[0] = 0xffffffff;
      return array;
    });
    expect(verify(clean)).toBe(true);
    expect(Reflect.get(clean, verifiedSymbol)).toBeUndefined();
    clean.content = "tampered";
    expect(verify(clean)).toBe(false);
    // Hash failures reset sampling to 100%.
    expect(verify(bad)).toBe(false);
  });

  it("fully verifies without provenance or with stale or corrupt storage", async () => {
    for (const raw of [trusted, "broken", JSON.stringify({ version: 1, days: [[day - 31, 10000]] })]) {
      const verify = new OptimisticEventVerifier({ storage: { getItem: () => raw, setItem: () => {} } }).verifyEvent;
      verify(event("prime"));
      await drain();
      const bad = JSON.parse(JSON.stringify(event())) as NostrEvent;
      bad.sig = "0".repeat(128);
      if (raw !== trusted) addSeenRelay(bad, url);
      expect(verify(bad)).toBe(false);
    }
  });

  it("survives storage errors", async () => {
    const verifier = new OptimisticEventVerifier({
      storage: {
        getItem: () => {
          throw new Error("unavailable");
        },
        setItem: async () => {
          throw new Error("quota");
        },
      },
    });
    const verify = verifier.verifyEvent;
    expect(verify(event())).toBe(true);
    await drain();
    expect(verify(event("next"))).toBe(true);
    await drain();
  });
});

it("publishes detached snapshots, trust, history, and discovered relays", () => {
  const verifier = new OptimisticEventVerifier();
  const snapshots: ReturnType<typeof verifier.getRelayState>[] = [];
  const scores: number[] = [];
  const histories: unknown[] = [];
  const relays: (readonly string[])[] = [];
  const subscriptions = [
    verifier.relays$.subscribe((value) => relays.push(value)),
    verifier.relay$(url).subscribe((value) => snapshots.push(value)),
    verifier.trust$(url).subscribe((value) => scores.push(value)),
    verifier.history$(url).subscribe((value) => histories.push(value)),
  ];
  expect(snapshots.at(-1)?.verified).toBe(0);
  verifier.verifyEvent(event("observed"));
  expect(snapshots.at(-1)?.verified).toBe(1);
  expect(histories).toHaveLength(2);
  expect(relays).toEqual([[], [url]]);
  expect(scores).toEqual([0]); // One day needs twenty checks to qualify.
  const snapshot = verifier.getRelayState(url);
  (snapshot.history[0] as { verified: number }).verified = 999;
  expect(verifier.getRelayState(url).verified).toBe(1);
  const bad = event("invalid");
  bad.sig = "0".repeat(128);
  expect(verifier.verifyEvent(bad)).toBe(false);
  expect(snapshots.at(-1)?.verified).toBe(0);
  subscriptions.forEach((subscription) => subscription.unsubscribe());
});

it("publishes hydrated trust and expires history at UTC day boundaries", async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(day * 86_400_000 + 1000);
    const verifier = new OptimisticEventVerifier({ storage: { getItem: () => trusted, setItem: () => {} } });
    const values: ReturnType<typeof verifier.getRelayState>[] = [];
    const subscription = verifier.relay$(url).subscribe((state) => values.push(state));
    expect(values.at(-1)?.ready).toBe(false);
    await drain();
    expect(values.at(-1)?.trust).toBe(1);
    expect(values.at(-1)?.verificationProbability).toBe(0.1);
    vi.advanceTimersByTime(31 * 86_400_000);
    expect(values.at(-1)?.trust).toBe(0);
    expect(values.at(-1)?.history).toEqual([]);
    subscription.unsubscribe();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it("uses configurable volume, daily qualification, and sampling thresholds", () => {
  vi.useFakeTimers();
  try {
    const verifier = new OptimisticEventVerifier({
      verifiedEventsForTrust: 4,
      daysForTrust: 2,
      verifiedEventsPerDay: 2,
      historyDays: 2,
      minimumVerificationRate: 0.25,
    });
    // Force full checks while building evidence.
    vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
      (array as Uint32Array)[0] = 0;
      return array;
    });
    verifier.verifyEvent(event("one"));
    expect(verifier.getRelayState(url).trust).toBe(0);
    verifier.verifyEvent(event("two"));
    expect(verifier.getRelayState(url).trust).toBe(0.5);
    expect(verifier.getRelayState(url).verificationProbability).toBe(0.5);
    vi.setSystemTime(Date.now() + 86_400_000);
    verifier.verifyEvent(event("three"));
    verifier.verifyEvent(event("four"));
    expect(verifier.getRelayState(url).trust).toBe(1);
    expect(verifier.getRelayState(url).verificationProbability).toBe(0.25);
    vi.setSystemTime(Date.now() + 86_400_000);
    expect(verifier.getRelayState(url).verified).toBe(2);
    expect(verifier.getRelayState(url).trust).toBe(0.5);
  } finally {
    vi.useRealTimers();
  }
});

it("can require every uncached signature to be verified", async () => {
  const verifier = new OptimisticEventVerifier({
    storage: { getItem: () => trusted, setItem: () => {} },
    minimumVerificationRate: 1,
  });
  verifier.getRelayState(url);
  await drain();
  expect(verifier.getRelayState(url).trust).toBe(1);
  const bad = event("strict");
  bad.sig = "0".repeat(128);
  expect(verifier.verifyEvent(bad)).toBe(false);
});

it.each([
  { minimumVerificationRate: 0 },
  { minimumVerificationRate: -1 },
  { minimumVerificationRate: 1.1 },
  { minimumVerificationRate: NaN },
  { verifiedEventsForTrust: 0 },
  { verifiedEventsForTrust: Infinity },
  { daysForTrust: 1.5 },
  { daysForTrust: 31 },
  { verifiedEventsPerDay: -1 },
  { historyDays: 0 },
  { cacheSize: Number.MAX_SAFE_INTEGER + 1 },
])("rejects invalid options %j", (options) => {
  expect(() => new OptimisticEventVerifier(options)).toThrow(RangeError);
});
