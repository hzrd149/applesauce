import { Observable, Subject } from "rxjs";
import { afterEach, expect, it, vi } from "vitest";
import { withFallback$ } from "../common/helpers.js";

afterEach(() => vi.useRealTimers());

it("continues observing relay updates after the initial fallback", async () => {
  vi.useFakeTimers();
  const relays = new Subject<string[] | undefined>();
  const values: string[][] = [];
  const subscription = withFallback$(relays, [], 100).subscribe((value) => values.push(value));

  await vi.advanceTimersByTimeAsync(100);
  expect(values).toEqual([[]]);

  relays.next(["wss://first.test/"]);
  relays.next(["wss://second.test/"]);
  expect(values).toEqual([[], ["wss://first.test/"], ["wss://second.test/"]]);
  subscription.unsubscribe();
});

it("releases relay sources and timers when unsubscribed", () => {
  vi.useFakeTimers();
  const teardown = vi.fn();
  const relays$ = new Observable<string[]>(() => teardown);
  const subscription = withFallback$(relays$, [], 100).subscribe();

  expect(vi.getTimerCount()).toBe(1);
  subscription.unsubscribe();
  expect(teardown).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
