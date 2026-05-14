import { NostrEvent } from "applesauce-core/helpers/event";
import { Subject } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { TimelineWindow, loadBackwardBlocks } from "../timeline-loader.js";

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
});
