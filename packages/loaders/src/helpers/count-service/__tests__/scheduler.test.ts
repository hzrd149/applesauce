import { asyncScheduler, Observable, of, Subject } from "rxjs";
import { afterEach, expect, it, vi } from "vitest";
import { createTransportScheduler } from "../scheduler.js";

afterEach(() => vi.useRealTimers());
const create = (concurrency = 2, queueCapacity = 200) =>
  createTransportScheduler({
    concurrency,
    perRelay: 1,
    perProvider: 1,
    queueCapacity,
    clock: asyncScheduler,
    admissionWindow: 0,
  });
it("atomically admits resources without a blocked relay occupying a global slot", () => {
  vi.useFakeTimers();
  const scheduler = create();
  const a = new Subject();
  const b = new Subject();
  const first = scheduler.run(["relay:a", "provider:p"], () => a).subscribe();
  const blocked = vi.fn(() => of(1));
  const second = scheduler.run(["relay:b", "provider:p"], blocked).subscribe();
  const independent = vi.fn(() => b);
  const third = scheduler.run(["relay:c", "provider:q"], independent).subscribe();
  vi.advanceTimersByTime(0);
  expect(blocked).not.toHaveBeenCalled();
  expect(independent).toHaveBeenCalledOnce();
  first.unsubscribe();
  second.unsubscribe();
  third.unsubscribe();
  expect(vi.getTimerCount()).toBe(0);
});
it("bounds the queue and removes cancelled jobs before they can dispatch", () => {
  vi.useFakeTimers();
  const scheduler = create(1, 1);
  const first = scheduler.run([], () => new Subject()).subscribe();
  vi.advanceTimersByTime(0);
  const pending = vi.fn(() => of(1));
  const second = scheduler.run([], pending).subscribe();
  const errors: unknown[] = [];
  scheduler.run([], () => of(2)).subscribe({ error: (error) => errors.push(error) });
  expect(errors).toHaveLength(1);
  second.unsubscribe();
  first.unsubscribe();
  vi.runAllTimers();
  expect(pending).not.toHaveBeenCalled();
});
it("tears down synchronous and asynchronous transports before reusing capacity", () => {
  vi.useFakeTimers();
  const scheduler = create(1);
  let active = 0;
  let peak = 0;
  const transport = () =>
    new Observable<number>((subscriber) => {
      peak = Math.max(peak, ++active);
      subscriber.next(1);
      subscriber.complete();
      return () => {
        active--;
      };
    });
  const trigger = new Subject<number>();
  scheduler.run([], () => trigger).subscribe({ next: () => scheduler.run([], transport).subscribe() });
  vi.advanceTimersByTime(0);
  trigger.next(1);
  trigger.complete();
  vi.runAllTimers();
  expect(peak).toBe(1);
  expect(active).toBe(0);
  for (let i = 0; i < 100; i++) scheduler.run([], transport).subscribe();
  vi.runAllTimers();
  expect(active).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
