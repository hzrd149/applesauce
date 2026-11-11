import { from, Subject, take, TimeoutError } from "rxjs";
import { afterEach, expect, it, vi } from "vitest";
import { idleTimeout } from "../idle-timeout.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("uses one timer for synchronous cache hydration", () => {
  vi.useFakeTimers();
  const timeouts = vi.spyOn(globalThis, "setTimeout");
  const intervals = vi.spyOn(globalThis, "setInterval");
  const values: number[] = [];
  from(Array.from({ length: 10000 }, (_, index) => index))
    .pipe(idleTimeout(100))
    .subscribe((value) => values.push(value));
  expect(values).toHaveLength(10000);
  expect(timeouts).toHaveBeenCalledOnce();
  expect(intervals).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("extends the idle deadline across multiple timer wakes", () => {
  vi.useFakeTimers();
  const source = new Subject<number>();
  const error = vi.fn();
  source.pipe(idleTimeout(100)).subscribe({ error });
  for (let index = 0; index < 5; index++) {
    vi.advanceTimersByTime(80);
    source.next(index);
    expect(error).not.toHaveBeenCalled();
  }
  vi.advanceTimersByTime(99);
  expect(error).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(error).toHaveBeenCalledExactlyOnceWith(expect.any(TimeoutError));
  expect(source.observed).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

it("times out a cache that never emits", () => {
  vi.useFakeTimers();
  const source = new Subject<number>();
  const error = vi.fn();
  source.pipe(idleTimeout(100)).subscribe({ error });
  vi.advanceTimersByTime(100);
  expect(error).toHaveBeenCalledExactlyOnceWith(expect.any(TimeoutError));
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps deadlines independent across subscriptions", () => {
  vi.useFakeTimers();
  const source = new Subject<number>();
  const timed = source.pipe(idleTimeout(100));
  const firstError = vi.fn();
  const secondError = vi.fn();
  timed.subscribe({ error: firstError });
  vi.advanceTimersByTime(50);
  timed.subscribe({ error: secondError });
  vi.advanceTimersByTime(50);
  expect(firstError).toHaveBeenCalledOnce();
  expect(secondError).not.toHaveBeenCalled();
  vi.advanceTimersByTime(50);
  expect(secondError).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["complete", "error", "unsubscribe"])("cleans up on %s", (ending) => {
  vi.useFakeTimers();
  const source = new Subject<number>();
  const subscription = source.pipe(idleTimeout(100)).subscribe({ error: () => {} });
  if (ending === "complete") source.complete();
  else if (ending === "error") source.error(new Error("cache failed"));
  else subscription.unsubscribe();
  expect(source.observed).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

it("handles synchronous downstream cancellation", () => {
  vi.useFakeTimers();
  const next = vi.fn();
  from([1, 2, 3]).pipe(idleTimeout(100), take(1)).subscribe(next);
  expect(next).toHaveBeenCalledExactlyOnceWith(1);
  expect(vi.getTimerCount()).toBe(0);
});
