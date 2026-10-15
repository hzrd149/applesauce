import { Filter } from "applesauce-core/helpers/filter";
import { NostrEvent } from "applesauce-core/helpers/event";
import { unixNow } from "applesauce-core/helpers/time";
import {
  BehaviorSubject,
  EMPTY,
  Subject,
  Subscription,
  defer,
  exhaustMap,
  lastValueFrom,
  of,
  throwError,
  toArray,
} from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TimelineWindow,
  createOutboxTimelineLoader,
  createTimelineLoader,
  loadBackwardBlocks,
  loadBlocksFromRelay,
  loadBlocksFromRelays,
  loadForwardBlocks,
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

describe("loadForwardBlocks", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // A relay that returns the newest `limit` events within the inclusive bounds
  function forwardRequest(events: NostrEvent[], limit: number) {
    return vi.fn((since?: number, until?: number) =>
      of(
        ...events
          .filter((e) => e.created_at >= (since ?? 0) && e.created_at <= (until ?? Infinity))
          .sort((a, b) => b.created_at - a.created_at)
          .slice(0, limit),
      ),
    );
  }

  it("should load every event in the gap since the newest loaded time", () => {
    vi.useFakeTimers({ now: 1000_000 });
    const events: NostrEvent[] = [];
    const request = forwardRequest(events, 10);
    const window$ = new Subject<TimelineWindow>();
    const received = new Set<string>();
    const sub = window$.pipe(loadForwardBlocks(request)).subscribe((e) => received.add(e.id));

    window$.next({ since: -Infinity });
    events.push(...Array.from({ length: 100 }, (_, i) => event(1001 + i)));
    vi.setSystemTime(1200_000);
    window$.next({ until: Infinity });

    expect(received).toEqual(new Set(events.map((e) => e.id)));
    expect(request.mock.calls[0]).toEqual([1000, 1200]);
    sub.unsubscribe();
  });

  it("should load newer events after an empty forward block", () => {
    vi.useFakeTimers({ now: 1000_000 });
    const events: NostrEvent[] = [];
    const request = forwardRequest(events, 10);
    const window$ = new Subject<TimelineWindow>();
    const next = vi.fn();
    const sub = window$.pipe(loadForwardBlocks(request)).subscribe(next);

    window$.next({ since: -Infinity });
    vi.setSystemTime(1100_000);
    window$.next({ until: Infinity });
    expect(next).not.toHaveBeenCalled();

    events.push(event(1150));
    vi.setSystemTime(1200_000);
    window$.next({ until: Infinity });
    expect(next).toHaveBeenCalledWith(event(1150));
    expect(request.mock.calls).toEqual([
      [1000, 1100],
      [1100, 1200],
      [1100, 1150],
      [1100, 1149],
    ]);
    sub.unsubscribe();
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
    const request = vi
      .fn()
      .mockReturnValueOnce(pending)
      .mockReturnValue(of(event(90)));
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

  it("should not error when every relay fails and retry them on the next window", () => {
    const pool = vi.fn(() => throwError(() => new Error("All relays failed")));
    const window$ = new BehaviorSubject<TimelineWindow>({ since: -Infinity });
    const error = vi.fn();

    const sub = window$
      .pipe(loadBlocksFromFilterMap(pool, { "wss://a.com/": { kinds: [1] }, "wss://b.com/": { kinds: [1] } }))
      .subscribe({ error });
    window$.next({ since: -Infinity });

    expect(error).not.toHaveBeenCalled();
    expect(pool).toHaveBeenCalledTimes(4);
    sub.unsubscribe();
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

describe("loader call completion", () => {
  const relays = ["wss://a.com/", "wss://b.com/"];
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("should complete once every relay and the cache finish their blocks", async () => {
    const blocks = Object.fromEntries([...relays, "cache"].map((key) => [key, new Subject<NostrEvent>()]));
    const loader = createTimelineLoader(
      (urls: string[]) => blocks[urls[0]],
      relays,
      { kinds: [1] },
      {
        cache: () => blocks.cache,
      },
    );
    const complete = vi.fn();
    loader().subscribe({ complete });

    for (const key of [...relays, "cache"]) {
      await flush();
      expect(complete).not.toHaveBeenCalled();
      blocks[key].next({ ...event(100), id: key });
      blocks[key].complete();
    }

    await flush();
    expect(complete).toHaveBeenCalled();
  });

  it("should join a block that is already loading", async () => {
    const block = new Subject<NostrEvent>();
    const request = vi.fn(() => block);
    const loader = createTimelineLoader(request, [relays[0]], { kinds: [1] });
    const first = vi.fn();
    const second = vi.fn();

    loader().subscribe({ complete: first });
    loader().subscribe({ complete: second });
    expect(request).toHaveBeenCalledTimes(1);

    block.complete();
    await flush();
    expect(first).toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
  });

  it("should complete right away once every relay is exhausted", async () => {
    const request = vi.fn(() => EMPTY);
    const loader = createTimelineLoader(request, relays, { kinds: [1] });

    await lastValueFrom(loader(), { defaultValue: undefined });
    await lastValueFrom(loader(), { defaultValue: undefined });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("should load one page per trigger when used with exhaustMap", async () => {
    const events = Array.from({ length: 30 }, (_, i) => event(100 - i));
    const request = vi.fn((_urls: string[], filters: Filter[]) =>
      of(...events.filter((e) => e.created_at <= (filters[0].until ?? Infinity)).slice(0, filters[0].limit)),
    );
    const loader = createTimelineLoader(request, [relays[0]], { kinds: [1] }, { limit: 10 });
    const pages$ = new Subject<void>();
    const pages: number[] = [];
    pages$.pipe(exhaustMap(() => loader().pipe(toArray()))).subscribe((page) => pages.push(page.length));

    for (let i = 0; i < 3; i++) {
      pages$.next();
      await flush();
    }

    // Each page after the first overlaps the oldest event of the previous page, which is deduplicated
    expect(pages).toEqual([10, 9, 9]);
  });

  it("should wait for an outbox map that arrives after the call", async () => {
    const outboxes$ = new Subject<Record<string, { pubkey: string }[]>>();
    const request = vi.fn(() => of(event(100)));
    const loader = createOutboxTimelineLoader(request, outboxes$, { kinds: [1] });
    const next = vi.fn();
    const complete = vi.fn();

    loader().subscribe({ next, complete });
    await flush();
    expect(complete).not.toHaveBeenCalled();

    outboxes$.next({ [relays[0]]: [{ pubkey: "a".repeat(64) }] });
    await flush();
    expect(next).toHaveBeenCalledWith(event(100));
    expect(complete).toHaveBeenCalled();
  });
});

describe("per-filter timeline cursors", () => {
  const relay = "wss://a.com/";
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  // A relay that applies `limit` and the inclusive bounds to each filter separately, like NIP-01 requires
  function filterPool(events: NostrEvent[]) {
    return vi.fn((_relays: string[], filters: Filter[]) =>
      of(
        ...filters.flatMap((f) =>
          events
            .filter(
              (e) =>
                f.kinds!.includes(e.kind) &&
                e.created_at <= (f.until ?? Infinity) &&
                e.created_at >= (f.since ?? -Infinity),
            )
            .sort((a, b) => b.created_at - a.created_at)
            .slice(0, f.limit)
            .map((e) => ({ ...e })),
        ),
      ),
    );
  }

  const dense = Array.from({ length: 100 }, (_, i) => event(1000 - i));
  const sparse = { ...event(10), id: "sparse", kind: 2 };

  it("should load a dense filter completely when a sparse filter on the same relay reaches further back", async () => {
    const request = filterPool([...dense, sparse]);
    const loader = createTimelineLoader(request, [relay], [{ kinds: [1] }, { kinds: [2] }], { limit: 10 });
    const received = new Set<string>();

    for (let i = 0; i < 15; i++)
      await lastValueFrom(loader().pipe(toArray())).then((p) => p.forEach((e) => received.add(e.id)));

    expect(received).toEqual(new Set([...dense, sparse].map((e) => e.id)));
    // The exhausted sparse filter is dropped from later requests
    expect(request.mock.calls.at(-1)![1]).toEqual([{ kinds: [1], until: expect.any(Number), limit: 10 }]);
  });

  it("should fill the forward gap for every filter on the same relay", async () => {
    vi.useFakeTimers({ now: 1000_000, toFake: ["Date"] });
    const events: NostrEvent[] = [];
    const request = filterPool(events);
    const window$ = new Subject<TimelineWindow>();
    const received = new Set<string>();
    const sub = window$
      .pipe(loadBlocksFromRelay(request, relay, [{ kinds: [1] }, { kinds: [2] }], { limit: 10 }))
      .subscribe((e) => received.add(e.id));

    window$.next({ since: 1000 });
    events.push(...Array.from({ length: 50 }, (_, i) => event(1001 + i)), { ...event(1002), id: "sparse", kind: 2 });
    vi.setSystemTime(1100_000);
    window$.next({ until: Infinity });
    await flush();

    expect(received).toEqual(new Set(events.map((e) => e.id)));
    sub.unsubscribe();
    vi.useRealTimers();
  });

  it("should keep filter fields that have no merge rule", () => {
    const request = vi.fn(() => EMPTY);
    loadOnce(loadBlocksFromRelay(request, relay, { kinds: [1], search: "nostr" }));
    expect(request).toHaveBeenCalledWith([relay], [{ kinds: [1], search: "nostr" }]);
  });
});

/** Applies a block operator to a single window and unsubscribes */
function loadOnce(op: ReturnType<typeof loadBlocksFromRelay>) {
  new BehaviorSubject<TimelineWindow>({ since: -Infinity }).pipe(op).subscribe().unsubscribe();
}

describe("relay errors", () => {
  const relays = ["wss://a.com/", "wss://b.com/"];

  it("should keep loading other relays and retry the failed relay on the next call", async () => {
    let fail = true;
    const request = vi.fn((urls: string[]) => {
      if (urls[0] === relays[0] && fail) {
        fail = false;
        return throwError(() => new Error("Connection failed"));
      }
      return of({ ...event(100), id: urls[0] });
    });
    const loader = createTimelineLoader(request, relays, { kinds: [1] });

    const first = await lastValueFrom(loader().pipe(toArray()));
    expect(first.map((e) => e.id)).toEqual([relays[1]]);

    const second = await lastValueFrom(loader().pipe(toArray()));
    expect(second.map((e) => e.id)).toEqual([relays[0]]);
    expect(request.mock.calls.filter(([urls]) => urls[0] === relays[0]).map(([, f]) => f[0].until)).toEqual([
      undefined,
      undefined,
    ]);
  });
});

describe("timeline that starts in the past", () => {
  it("should load forward from the window until of the first call", async () => {
    const now = unixNow();
    const start = now - 100 * 3600;
    const events = [event(start - 3600), event(start + 5 * 3600), event(start + 30 * 3600)];
    const request = vi.fn((_relays: string[], filters: Filter[]) =>
      of(
        ...events.filter(
          (e) => e.created_at <= (filters[0].until ?? Infinity) && e.created_at >= (filters[0].since ?? -Infinity),
        ),
      ),
    );
    const loader = createTimelineLoader(request, ["wss://a.com/"], { kinds: [1] });

    const first = await lastValueFrom(loader({ since: start - 24 * 3600, until: start }).pipe(toArray()));
    expect(first.map((e) => e.created_at)).toEqual([start - 3600]);

    const second = await lastValueFrom(loader({ until: start + 10 * 3600 }).pipe(toArray()));
    expect(second.map((e) => e.created_at)).toEqual([start + 5 * 3600]);

    const third = await lastValueFrom(loader({ until: start + 50 * 3600 }).pipe(toArray()));
    expect(third.map((e) => e.created_at)).toEqual([start + 30 * 3600]);
  });
});
