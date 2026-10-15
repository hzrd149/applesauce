import { Filter } from "applesauce-core/helpers/filter";
import { NostrEvent } from "applesauce-core/helpers/event";
import { BehaviorSubject, Subject, Subscription, defer, of, throwError } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import {
  TimelineWindow,
  createTimelineLoader,
  loadBackwardBlocks,
  loadBlocksFromRelays,
  loadBlocksFromFilterMap,
} from "../timeline-loader.js";

function event(created_at: number): NostrEvent {
  return { created_at, id: String(created_at), kind: 1, pubkey: "a".repeat(64), tags: [], content: "", sig: "" };
}

describe("loadBackwardBlocks", () => {
  it("should advance past a singleton event returned at the inclusive until boundary", () => {
    const window$ = new Subject<TimelineWindow>();
    const first = new Subject<NostrEvent>();
    const second = new Subject<NostrEvent>();
    const request = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);

    const sub = window$.pipe(loadBackwardBlocks(request)).subscribe();

    window$.next({ since: -Infinity, until: 100 });
    expect(request).toHaveBeenLastCalledWith(100);
    first.next(event(100));
    first.complete();

    window$.next({ since: -Infinity });
    expect(request).toHaveBeenLastCalledWith(99);

    sub.unsubscribe();
  });

  it("should advance past the oldest event returned in a block", () => {
    const window$ = new Subject<TimelineWindow>();
    const first = new Subject<NostrEvent>();
    const second = new Subject<NostrEvent>();
    const request = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);

    const sub = window$.pipe(loadBackwardBlocks(request)).subscribe();

    window$.next({ since: -Infinity, until: 100 });
    expect(request).toHaveBeenLastCalledWith(100);
    first.next(event(100));
    first.next(event(99));
    first.complete();

    window$.next({ since: -Infinity });
    expect(request).toHaveBeenLastCalledWith(98);

    sub.unsubscribe();
  });

  it("should load until the cursor reaches the window since", () => {
    const window$ = new Subject<TimelineWindow>();
    const first = new Subject<NostrEvent>();
    const second = new Subject<NostrEvent>();
    const request = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);

    const sub = window$.pipe(loadBackwardBlocks(request)).subscribe();

    window$.next({ since: -Infinity, until: 100 });
    first.next(event(90));
    first.complete();

    // Still inside the loaded range
    window$.next({ since: 95 });
    expect(request).toHaveBeenCalledTimes(1);

    // Past the oldest loaded event
    window$.next({ since: 89 });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith(89);

    sub.unsubscribe();
  });
});

describe("loadBlocksFromFilterMap", () => {
  it("should keep loading from other relays when one relay fails", () => {
    const pool = vi.fn((relays: string[]) =>
      relays[0] === "wss://a.com/" ? throwError(() => new Error("All relays failed")) : of(event(100)),
    );
    const window$ = new BehaviorSubject<TimelineWindow>({ since: -Infinity });
    const next = vi.fn();
    const error = vi.fn();

    const sub = window$
      .pipe(loadBlocksFromFilterMap(pool, { "wss://a.com/": { kinds: [1] }, "wss://b.com/": { kinds: [1] } }))
      .subscribe({ next, error });

    expect(next).toHaveBeenCalledWith(event(100));
    expect(error).not.toHaveBeenCalled();
    sub.unsubscribe();
  });

  it("should not error when every relay fails", () => {
    const pool = vi.fn(() => throwError(() => new Error("All relays failed")));
    const window$ = new BehaviorSubject<TimelineWindow>({ since: -Infinity });
    const error = vi.fn();
    const complete = vi.fn();

    window$
      .pipe(loadBlocksFromFilterMap(pool, { "wss://a.com/": { kinds: [1] }, "wss://b.com/": { kinds: [1] } }))
      .subscribe({ error, complete });

    expect(error).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalled();
  });
});

describe("per-relay timeline cursors", () => {
  const relays = ["wss://a.com/", "wss://b.com/"];

  function cappedPool() {
    const events = Object.fromEntries(
      relays.map((relay, r) => [relay, Array.from({ length: 10 }, (_, i) => ({ ...event(100 - i), id: `${r}-${i}` }))]),
    );
    const request = vi.fn((urls: string[], filters: Filter[]) =>
      of(
        ...urls.flatMap((relay) =>
          events[relay]
            .filter((e) => e.created_at <= (filters[0].until ?? Infinity))
            .slice(0, Math.min(filters[0].limit ?? Infinity, relay === relays[0] ? 2 : 5)),
        ),
      ),
    );
    return { events, request };
  }

  it("loads all history despite different relay caps and exhausts relays independently", () => {
    const { events, request } = cappedPool();
    const loader = createTimelineLoader(request, relays, { kinds: [1] }, { limit: 5 });
    const received = new Set<string>();
    const sub = loader().subscribe((e) => received.add(e.id));
    const pages = new Subscription();
    for (let i = 0; i < 6; i++) pages.add(loader().subscribe());

    expect(received).toEqual(
      new Set(
        Object.values(events)
          .flat()
          .map((e) => e.id),
      ),
    );
    expect(
      request.mock.calls.filter(([urls]) => urls.includes(relays[0])).map(([, filters]) => filters[0].until),
    ).toEqual([undefined, 98, 96, 94, 92, 90]);
    expect(
      request.mock.calls.filter(([urls]) => urls.includes(relays[1])).map(([, filters]) => filters[0].until),
    ).toEqual([undefined, 95, 90]);
    pages.unsubscribe();
    sub.unsubscribe();
  });

  it("delivers every window from a cold source to every relay through one subscription", () => {
    const { request } = cappedPool();
    const subscribed = vi.fn();
    defer(() => {
      subscribed();
      return of({ since: -Infinity }, { since: -Infinity });
    })
      .pipe(loadBlocksFromRelays(request, relays, { kinds: [1] }, { limit: 5 }))
      .subscribe();

    expect(subscribed).toHaveBeenCalledTimes(1);
    expect(request.mock.calls.map(([urls, filters]) => [urls, filters[0].until])).toEqual([
      [[relays[0]], undefined],
      [[relays[1]], undefined],
      [[relays[0]], 98],
      [[relays[1]], 95],
    ]);
  });

  it("allows a fast relay to advance while another relay is still loading", () => {
    const window$ = new Subject<TimelineWindow>();
    const slow = new Subject<NostrEvent>();
    const request = vi.fn((urls: string[]) => (urls[0] === relays[0] ? slow : of(event(100))));
    const sub = window$.pipe(loadBlocksFromRelays(request, relays, { kinds: [1] })).subscribe();
    window$.next({ since: -Infinity });
    window$.next({ since: -Infinity });

    expect(request.mock.calls.map(([urls]) => urls)).toEqual([[relays[0]], [relays[1]], [relays[1]]]);
    sub.unsubscribe();
  });

  it("deduplicates events shared by relays in the public loader", () => {
    const shared = { ...event(100), id: "shared" };
    const next = vi.fn();
    const sub = createTimelineLoader(() => of(shared), relays, { kinds: [1] })().subscribe(next);
    expect(next).toHaveBeenCalledTimes(1);
    sub.unsubscribe();
  });
});
