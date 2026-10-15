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
  it("should request the inclusive boundary second again and step past it once nothing new is returned", () => {
    const window$ = new Subject<TimelineWindow>();
    const first = new Subject<NostrEvent>();
    const second = new Subject<NostrEvent>();
    const third = new Subject<NostrEvent>();
    const request = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second).mockReturnValueOnce(third);

    const sub = window$.pipe(loadBackwardBlocks(request)).subscribe();

    window$.next({ since: -Infinity, until: 100 });
    expect(request).toHaveBeenLastCalledWith(100);
    first.next(event(100));
    first.complete();

    window$.next({ since: -Infinity });
    expect(request).toHaveBeenLastCalledWith(100);
    second.next(event(100));
    second.complete();

    window$.next({ since: -Infinity });
    expect(request).toHaveBeenLastCalledWith(99);

    sub.unsubscribe();
  });

  it("should continue from the oldest event returned in a block", () => {
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
    expect(request).toHaveBeenLastCalledWith(99);

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
    expect(request).toHaveBeenLastCalledWith(90);

    sub.unsubscribe();
  });
});

describe("boundary second", () => {
  // A relay that returns the newest `limit` events within the inclusive bounds, ordering ties by insertion
  function relayPool(events: NostrEvent[]) {
    return vi.fn((_relays: string[], filters: Filter[]) =>
      of(
        ...events
          .filter((e) => e.created_at <= (filters[0].until ?? Infinity) && e.created_at >= (filters[0].since ?? 0))
          .sort((a, b) => b.created_at - a.created_at)
          .slice(0, filters[0].limit),
      ),
    );
  }

  function loadAll(request: ReturnType<typeof relayPool>, limit: number) {
    const loader = createTimelineLoader(request, ["wss://a.com/"], { kinds: [1] }, { limit });
    const received = new Set<string>();
    const sub = loader().subscribe((e) => received.add(e.id));
    for (let i = 0; i < 20; i++) loader().subscribe();
    sub.unsubscribe();
    return received;
  }

  it("should load events at a second that is cut off at the end of a block", () => {
    const events = [event(100), ...["a", "b", "c"].map((id) => ({ ...event(99), id })), event(98)];
    const received = loadAll(relayPool(events), 3);
    expect(received).toEqual(new Set(events.map((e) => e.id)));
  });

  it("should step past a second with more events than a block and keep loading older events", () => {
    const crowded = Array.from({ length: 35 }, (_, i) => ({ ...event(100), id: `crowded-${i}` }));
    const older = Array.from({ length: 10 }, (_, i) => event(99 - i));
    const request = relayPool([...crowded, ...older]);
    const received = loadAll(request, 10);

    // Relays order ties the same way every time, so only the first block of the crowded second is reachable
    expect(received).toEqual(new Set([...crowded.slice(0, 10), ...older].map((e) => e.id)));
    expect(request.mock.calls.map(([, filters]) => filters[0].until)).toEqual([undefined, 100, 99, 90, 89]);
  });
});

describe("cancelled blocks", () => {
  it("should not mark the source complete when a block is cancelled before any events", () => {
    const window$ = new Subject<TimelineWindow>();
    const request = vi.fn(() => new Subject<NostrEvent>());

    const first = window$.pipe(loadBackwardBlocks(request));
    let sub = first.subscribe();
    window$.next({ since: -Infinity, until: 100 });
    sub.unsubscribe();

    sub = first.subscribe();
    window$.next({ since: -Infinity });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith(100);
    sub.unsubscribe();
  });

  it("should keep loading a relay after an identical filter map is re-emitted mid-block", () => {
    const pending = new Subject<NostrEvent>();
    const request = vi.fn().mockReturnValueOnce(pending).mockReturnValue(of(event(90)));
    const map = { "wss://a.com/": { kinds: [1] } };
    const map$ = new BehaviorSubject(map);
    const window$ = new BehaviorSubject<TimelineWindow>({ since: -Infinity });
    const next = vi.fn();

    const sub = window$.pipe(loadBlocksFromFilterMap(request, map$)).subscribe(next);
    map$.next({ ...map });
    window$.next({ since: -Infinity });

    // The cancelled block is re-requested, then the next page continues past it
    expect(request.mock.calls.map(([, filters]) => filters[0].until)).toEqual([undefined, undefined, 90]);
    expect(next).toHaveBeenCalledWith(event(90));
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
    for (let i = 0; i < 10; i++) pages.add(loader().subscribe());

    expect(received).toEqual(
      new Set(
        Object.values(events)
          .flat()
          .map((e) => e.id),
      ),
    );
    expect(
      request.mock.calls.filter(([urls]) => urls.includes(relays[0])).map(([, filters]) => filters[0].until),
    ).toEqual([undefined, 99, 98, 97, 96, 95, 94, 93, 92, 91, 90]);
    expect(
      request.mock.calls.filter(([urls]) => urls.includes(relays[1])).map(([, filters]) => filters[0].until),
    ).toEqual([undefined, 96, 92, 91, 90]);
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
      [[relays[0]], 99],
      [[relays[1]], 96],
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
