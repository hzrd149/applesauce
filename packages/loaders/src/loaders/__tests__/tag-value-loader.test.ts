import { NostrEvent } from "applesauce-core/helpers/event";
import { EMPTY, Observable, of, Subject, throwError } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cacheTagValueLoader, createTagValueLoader, relaysTagValueLoader } from "../tag-value-loader.js";

const relay = "wss://one.test/";
const other = "wss://two.test/";
const event = (value: string, id = value): NostrEvent => ({
  id,
  pubkey: "a".repeat(64),
  sig: "b".repeat(128),
  kind: 7,
  created_at: 1,
  content: "+",
  tags: [["e", value]],
});

describe("tag value loader", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("preserves zero since in cache and relay filters", () => {
    const cache = vi.fn(() => []);
    const request = vi.fn(() => EMPTY);
    cacheTagValueLoader(cache, "e", { since: 0 })([{ value: "a" }]).subscribe();
    relaysTagValueLoader(request, "e", { since: 0 })([{ value: "a", relays: [relay] }]).subscribe();
    expect(cache).toHaveBeenCalledWith([{ since: 0, "#e": ["a"] }]);
    expect(request).toHaveBeenCalledWith([relay], [{ since: 0, "#e": ["a"] }]);
  });

  it("deduplicates values per relay while preserving routing", () => {
    const request = vi.fn(() => EMPTY);
    relaysTagValueLoader(
      request,
      "e",
    )([
      { value: "a", relays: [relay] },
      { value: "a", relays: [relay, other] },
      { value: "b", relays: [other] },
    ]).subscribe();
    expect(request.mock.calls).toEqual([
      [[relay], [{ "#e": ["a"] }]],
      [[other], [{ "#e": ["a", "b"] }]],
    ]);
  });

  it("delivers synchronous results to every matching consumer and deduplicates sources", () => {
    const a = event("a");
    const b = event("b");
    const request = vi.fn(() => of(a, { ...a }, b));
    const loader = createTagValueLoader(request, "e", {
      bufferSize: 3,
      extraRelays: [relay],
      cacheRequest: () => [a, b],
    });
    const values: NostrEvent[][] = [[], [], []];
    loader({ value: "a" }).subscribe((e) => values[0].push(e));
    loader({ value: "a" }).subscribe((e) => values[1].push(e));
    loader({ value: "b" }).subscribe((e) => values[2].push(e));
    expect(values).toEqual([[a], [a], [b]]);
    loader.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns previously fetched events on a later explicit request", () => {
    const a = event("a");
    const loader = createTagValueLoader(() => of(a), "e", { bufferSize: 1, extraRelays: [relay] });
    const values: NostrEvent[] = [];
    loader({ value: "a" }).subscribe();
    loader({ value: "a" }).subscribe((e) => values.push(e));
    expect(values).toEqual([a]);
    loader.stop();
  });

  it("flushes on time and aborts started requests", () => {
    const controller = new AbortController();
    let active = 0;
    const request = vi.fn(
      () =>
        new Observable<NostrEvent>(() => {
          active++;
          return () => {
            active--;
          };
        }),
    );
    const loader = createTagValueLoader(request, "e", {
      bufferTime: 10,
      extraRelays: [relay],
      signal: controller.signal,
    });
    let complete = false;
    loader({ value: "a" }).subscribe({
      complete: () => {
        complete = true;
      },
    });
    expect(request).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10);
    expect(active).toBe(1);
    controller.abort();
    expect(active).toBe(0);
    expect(complete).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("continues storing a started request after its consumer leaves", () => {
    const source = new Subject<NostrEvent>();
    const add = vi.fn((e: NostrEvent) => e);
    const loader = createTagValueLoader(() => source, "e", {
      bufferSize: 1,
      extraRelays: [relay],
      eventStore: { add },
    });
    const sub = loader({ value: "a" }).subscribe();
    sub.unsubscribe();
    source.next(event("a"));
    expect(add).toHaveBeenCalledTimes(1);
    source.complete();
    loader.stop();
  });
});

describe("tag value loader source failures", () => {
  it.each(["sync", "async"])("keeps healthy relays running after a %s relay failure", (mode) => {
    const failure = new Error("relay unavailable");
    const healthy = new Subject<NostrEvent>();
    const onError = vi.fn();
    const loader = createTagValueLoader(
      (relays) => {
        if (relays[0] === relay) {
          if (mode === "sync") throw failure;
          return throwError(() => failure);
        }
        return healthy;
      },
      "e",
      { bufferSize: 1, onError },
    );
    const values: NostrEvent[] = [];
    let complete = false;
    loader({ value: "a", relays: [relay, other] }).subscribe({
      next: (e) => values.push(e),
      complete: () => {
        complete = true;
      },
    });
    expect(complete).toBe(false);
    healthy.next(event("a"));
    healthy.complete();
    expect(values).toEqual([event("a")]);
    expect(complete).toBe(true);
    expect(onError).toHaveBeenCalledWith(failure, { source: "relay", relay });
    loader.stop();
  });

  it.each(["sync", "async"])("still queries relays after a %s cache failure", (mode) => {
    const failure = new Error("cache unavailable");
    const onError = vi.fn();
    const loader = createTagValueLoader(() => of(event("a")), "e", {
      bufferSize: 1,
      extraRelays: [relay],
      onError,
      cacheRequest: () => {
        if (mode === "sync") throw failure;
        return throwError(() => failure);
      },
    });
    const values: NostrEvent[] = [];
    loader({ value: "a" }).subscribe((e) => values.push(e));
    expect(values).toEqual([event("a")]);
    expect(onError).toHaveBeenCalledWith(failure, { source: "cache" });
    loader.stop();
  });

  it("reports all failed sources and completes without events", () => {
    const onError = vi.fn();
    const loader = createTagValueLoader(() => throwError(() => new Error("offline")), "e", {
      bufferSize: 1,
      extraRelays: [relay, other],
      onError,
    });
    let complete = false;
    loader({ value: "a" }).subscribe({
      complete: () => {
        complete = true;
      },
    });
    expect(complete).toBe(true);
    expect(onError).toHaveBeenCalledTimes(2);
    loader.stop();
  });
});
