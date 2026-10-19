import { BehaviorSubject, Subject } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeURL } from "applesauce-core/helpers/url";
import { ignoreUnhealthyMailboxes, ignoreUnhealthyRelays, ignoreUnhealthyRelaysOnPointers } from "../liveness.js";

vi.mock("applesauce-core/helpers/url", async (importOriginal) => {
  const actual = await importOriginal<typeof import("applesauce-core/helpers/url")>();
  return { ...actual, normalizeURL: vi.fn(actual.normalizeURL) };
});

beforeEach(() => vi.clearAllMocks());

function tracker(unhealthy: string[] = []) {
  return { unhealthy$: new BehaviorSubject(unhealthy), seen: new Set<string>() };
}

describe("liveness operator filtering", () => {
  it("normalizes exclusions once per health update and relay eligibility once per distinct hint", () => {
    const liveness = tracker(["WSS://DEAD.example:443/", "not a url"]);
    const source = new Subject<{ id: number; relays: string[] }[]>();
    const outputs: { id: number; relays: string[] }[][] = [];
    const sub = source.pipe(ignoreUnhealthyRelaysOnPointers(liveness)).subscribe((value) => outputs.push(value));
    const hints = ["wss://live.example", "wss://dead.example/", "not a url", "wss://live.example"];
    const pointers = Array.from({ length: 1000 }, (_, id) => ({ id, relays: hints }));
    source.next(pointers);
    expect(outputs[0][0].relays).toEqual(["wss://live.example", "wss://live.example"]);
    expect(outputs[0]).toHaveLength(1000);
    expect(vi.mocked(normalizeURL)).toHaveBeenCalledTimes(5);
    source.next(pointers);
    expect(vi.mocked(normalizeURL)).toHaveBeenCalledTimes(5);
    expect(outputs[1]).toEqual(outputs[0]);
    expect(pointers[0].relays).toBe(hints);
    expect(hints).toHaveLength(4);
    expect(liveness.seen).toEqual(new Set(hints));
    liveness.unhealthy$.next([]);
    expect(outputs.at(-1)?.[0].relays).toEqual(hints);
    expect(vi.mocked(normalizeURL)).toHaveBeenCalledTimes(5);
    sub.unsubscribe();
  });

  it("skips all normalization when there are no exclusions and preserves copies and seen hints", () => {
    const liveness = tracker();
    const source = new Subject<string[]>();
    const outputs: string[][] = [];
    const sub = source.pipe(ignoreUnhealthyRelays(liveness)).subscribe((value) => outputs.push(value));
    const input = ["invalid relay", "wss://a.example/", "wss://a.example/"];
    source.next(input);
    expect(outputs[0]).toEqual(input);
    expect(outputs[0]).not.toBe(input);
    expect(normalizeURL).not.toHaveBeenCalled();
    liveness.seen.clear();
    source.next(input);
    expect(liveness.seen).toEqual(new Set(input));
    sub.unsubscribe();
  });

  it("invalidates cached decisions even when the unhealthy array is mutated and re-emitted", () => {
    const unhealthy = ["wss://a.example/"];
    const liveness = tracker(unhealthy);
    const source = new Subject<string[]>();
    const outputs: string[][] = [];
    const sub = source.pipe(ignoreUnhealthyRelays(liveness)).subscribe((value) => outputs.push(value));
    const input = ["wss://a.example", "wss://b.example", "not a url"];
    source.next(input);
    expect(outputs.at(-1)).toEqual(["wss://b.example", "not a url"]);
    unhealthy[0] = "wss://b.example/";
    unhealthy.push("not a url");
    liveness.unhealthy$.next(unhealthy);
    expect(outputs.at(-1)).toEqual(["wss://a.example"]);
    unhealthy.length = 0;
    liveness.unhealthy$.next(unhealthy);
    expect(outputs.at(-1)).toEqual(input);
    sub.unsubscribe();
  });

  it("shares decisions across inboxes and outboxes while preserving optional fields", () => {
    const liveness = tracker(["wss://dead.example/"]);
    const source = new Subject<{ name: string; inboxes?: string[]; outboxes?: string[] }>();
    const outputs: { name: string; inboxes?: string[]; outboxes?: string[] }[] = [];
    const sub = source.pipe(ignoreUnhealthyMailboxes(liveness)).subscribe((value) => outputs.push(value));
    const empty = { name: "empty" };
    source.next(empty);
    expect(outputs[0]).toBe(empty);
    source.next({
      name: "both",
      inboxes: ["wss://live.example", "wss://dead.example/"],
      outboxes: ["wss://live.example"],
    });
    expect(outputs.at(-1)).toEqual({ name: "both", inboxes: ["wss://live.example"], outboxes: ["wss://live.example"] });
    expect(normalizeURL).toHaveBeenCalledTimes(3);
    source.next({ name: "inboxes", inboxes: [] });
    expect(outputs.at(-1)).toEqual({ name: "inboxes", inboxes: [], outboxes: undefined });
    sub.unsubscribe();
  });

  it("preserves pointers without hints and filters replaced or mutated hint arrays", () => {
    const liveness = tracker(["wss://dead.example/"]);
    const source = new Subject<{ id: number; relays?: string[] }[]>();
    const outputs: { id: number; relays?: string[] }[][] = [];
    const sub = source.pipe(ignoreUnhealthyRelaysOnPointers(liveness)).subscribe((value) => outputs.push(value));
    const noHints = { id: 1 };
    const hints = ["wss://live.example"];
    source.next([noHints, { id: 2, relays: hints }]);
    expect(outputs[0][0]).toBe(noHints);
    hints.push("wss://dead.example/", "wss://second.example/");
    source.next([noHints, { id: 2, relays: hints }]);
    expect(outputs.at(-1)?.[1].relays).toEqual(["wss://live.example", "wss://second.example/"]);
    sub.unsubscribe();
  });

  it("keeps independent caches per subscription and releases upstream subscriptions", () => {
    const liveness = tracker(["wss://dead.example/"]);
    const source = new Subject<string[]>();
    const operator = ignoreUnhealthyRelays(liveness);
    const first: string[][] = [],
      second: string[][] = [];
    const a = source.pipe(operator).subscribe((value) => first.push(value));
    const b = source.pipe(operator).subscribe((value) => second.push(value));
    source.next(["wss://live.example"]);
    expect(first).toEqual(second);
    expect(normalizeURL).toHaveBeenCalledTimes(4);
    a.unsubscribe();
    b.unsubscribe();
    expect(source.observed).toBe(false);
    expect(liveness.unhealthy$.observed).toBe(false);
  });

  it("bounds eligibility caching without changing results after eviction", () => {
    const liveness = tracker(["wss://dead.example/"]);
    const source = new Subject<string[]>();
    const outputs: string[][] = [];
    const sub = source.pipe(ignoreUnhealthyRelays(liveness)).subscribe((value) => outputs.push(value));
    const relays = Array.from({ length: 1100 }, (_, i) => `wss://live-${i}.example/`);
    source.next(relays);
    expect(outputs[0]).toEqual(relays);
    vi.mocked(normalizeURL).mockClear();
    source.next([relays[0], "wss://dead.example/"]);
    expect(outputs.at(-1)).toEqual([relays[0]]);
    expect(normalizeURL).toHaveBeenCalledTimes(2);
    sub.unsubscribe();
  });
});
