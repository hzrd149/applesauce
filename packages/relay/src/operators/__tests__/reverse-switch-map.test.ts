import { describe, expect, it } from "vitest";
import { of, interval, timer, Subject, throwError, Observable } from "rxjs";
import { take, delay, map, switchMap, endWith } from "rxjs/operators";
import { reverseSwitchMap } from "../reverse-switch-map.js";
import { subscribeSpyTo } from "@hirez_io/observer-spy";

describe("reverseSwitchMap", () => {
  it("should switch to new observable and emit values", () => {
    const source = of(1, 2, 3);
    const spy = subscribeSpyTo(source.pipe(reverseSwitchMap((value) => of(value * 10, value * 100))));

    expect(spy.getValues()).toEqual([10, 100, 20, 200, 30, 300]);
    expect(spy.receivedComplete()).toBe(true);
  });

  it("should pass the index to the project function", () => {
    const source = of("a", "b", "c");
    const spy = subscribeSpyTo(source.pipe(reverseSwitchMap((value, index) => of(`${value}-${index}`))));

    expect(spy.getValues()).toEqual(["a-0", "b-1", "c-2"]);
    expect(spy.receivedComplete()).toBe(true);
  });

  it("should switch to new observable before unsubscribing from old one", async () => {
    let events: number[] = [];
    const spy = subscribeSpyTo(
      of(1, 2, 3, 4).pipe(
        reverseSwitchMap(
          (v) =>
            new Observable((observer) => {
              events.push(v);
              observer.next(v);

              setImmediate(() => {
                observer.complete();
              });

              return () => {
                events.push(-v);
              };
            }),
        ),
      ),
    );

    // for for things to settle down
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should have values from both observables due to reverse switching
    expect(events).toEqual([1, 2, -1, 3, -2, 4, -3, -4]);
    expect(spy.receivedComplete()).toBe(true);
  });

  it("should handle errors from the project function", () => {
    const source = of(1, 2);
    const spy = subscribeSpyTo(
      source.pipe(
        reverseSwitchMap((value) => {
          if (value === 2) {
            return throwError(() => new Error("Project error"));
          }
          return of(value);
        }),
      ),
      { expectErrors: true },
    );

    expect(spy.getValues()).toEqual([1]);
    expect(spy.receivedError()).toBe(true);
    expect(spy.getError()).toEqual(new Error("Project error"));
  });

  it("should handle errors from inner observables", () => {
    const source = of(1, 2);
    const spy = subscribeSpyTo(
      source.pipe(
        reverseSwitchMap((value) => {
          if (value === 2) {
            return throwError(() => new Error("Inner error"));
          }
          return of(value);
        }),
      ),
      { expectErrors: true },
    );

    expect(spy.getValues()).toEqual([1]);
    expect(spy.receivedError()).toBe(true);
    expect(spy.getError()).toEqual(new Error("Inner error"));
  });

  it("should complete when source completes and no inner subscription is active", () => {
    const source = of(1);
    const spy = subscribeSpyTo(source.pipe(reverseSwitchMap((value) => of(value))));

    expect(spy.getValues()).toEqual([1]);
    expect(spy.receivedComplete()).toBe(true);
  });

  it("should complete when source completes and last inner subscription completes", () => {
    const source = of(1);
    const spy = subscribeSpyTo(source.pipe(reverseSwitchMap((value) => timer(10).pipe(map(() => value)))));

    // Wait for completion
    setTimeout(() => {
      expect(spy.getValues()).toEqual([1]);
      expect(spy.receivedComplete()).toBe(true);
    }, 20);
  });

  it("should handle empty source", () => {
    const source = of();
    const spy = subscribeSpyTo(source.pipe(reverseSwitchMap((value) => of(value))));

    expect(spy.getValues()).toEqual([]);
    expect(spy.receivedComplete()).toBe(true);
  });

  it("should handle project function returning empty observable", () => {
    const source = of(1, 2);
    const spy = subscribeSpyTo(source.pipe(reverseSwitchMap((value) => of())));

    expect(spy.getValues()).toEqual([]);
    expect(spy.receivedComplete()).toBe(true);
  });

  it("should handle rapid emissions", () => {
    const source = of(1, 2, 3, 4, 5);
    const spy = subscribeSpyTo(source.pipe(reverseSwitchMap((value) => timer(5).pipe(map(() => value)))));

    // Wait for all timers to complete
    setTimeout(() => {
      expect(spy.getValues()).toEqual([5]); // Only the last value should be emitted
      expect(spy.receivedComplete()).toBe(true);
    }, 20);
  });

  it("should handle synchronous and asynchronous observables", () => {
    const source = of(1, 2);
    const spy = subscribeSpyTo(
      source.pipe(
        reverseSwitchMap((value) => {
          if (value === 1) {
            return of(value); // Synchronous
          } else {
            return timer(10).pipe(map(() => value)); // Asynchronous
          }
        }),
      ),
    );

    setTimeout(() => {
      expect(spy.getValues()).toEqual([1, 2]);
      expect(spy.receivedComplete()).toBe(true);
    }, 20);
  });
});
