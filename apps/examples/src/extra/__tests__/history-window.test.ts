import { afterEach, describe, expect, it, vi } from "vitest";
import { Subject } from "rxjs";
import { historyWindows } from "../history-window";

describe("app-owned history windows", () => {
  afterEach(() => vi.restoreAllMocks());

  it("starts with a finite day and expands the time range rather than requesting relay pages", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000_000);
    const more = new Subject<void>();
    const windows: { since: number; until: number }[] = [];
    const sub = historyWindows(more).subscribe((window) => windows.push(window));
    more.next();
    more.next();
    expect(windows).toEqual([
      { since: 1000000 - 86400, until: 1000000 },
      { since: 1000000 - 86400 * 2, until: 1000000 },
      { since: 1000000 - 86400 * 3, until: 1000000 },
    ]);
    sub.unsubscribe();
  });

  it("clamps history at the Unix epoch and starts fresh for each subscription", () => {
    vi.spyOn(Date, "now").mockReturnValue(100000);
    const more = new Subject<void>();
    const windows = historyWindows(more);
    const first: number[] = [];
    const firstSub = windows.subscribe((window) => first.push(window.since));
    more.next();
    const second: number[] = [];
    const secondSub = windows.subscribe((window) => second.push(window.since));
    expect(first).toEqual([0, 0]);
    expect(second).toEqual([0]);
    firstSub.unsubscribe();
    secondSub.unsubscribe();
  });
});
