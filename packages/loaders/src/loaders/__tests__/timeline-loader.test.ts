import { NostrEvent } from "applesauce-core/helpers/event";
import { BehaviorSubject, Subject, of, throwError } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { TimelineWindow, loadBackwardBlocks, loadBlocksFromFilterMap } from "../timeline-loader.js";

function event(created_at: number): NostrEvent {
  return { created_at } as NostrEvent;
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
