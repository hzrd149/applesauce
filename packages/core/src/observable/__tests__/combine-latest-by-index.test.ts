import { NEVER, Observable, Subject, map, of, switchMap } from "rxjs";
import { describe, expect, it } from "vitest";
import { combineLatestByIndex } from "../index.js";

describe("combineLatestByIndex", () => {
  it("maps input arrays to output arrays", () => {
    const source = new Subject<number[]>();
    const results: number[][] = [];

    source.pipe(combineLatestByIndex(map((n) => n * 10))).subscribe((value) => results.push(value));

    source.next([1, 2]);
    expect(results).toEqual([[10, 20]]);
  });

  it("supports duplicate values because branches are index-based", () => {
    const source = new Subject<number[]>();
    const results: number[][] = [];

    source.pipe(combineLatestByIndex(map((n) => n * 2))).subscribe((value) => results.push(value));

    source.next([1, 1, 1]);
    expect(results.at(-1)).toEqual([2, 2, 2]);
  });

  it("only creates/destroys branches when indices are added/removed", () => {
    const source = new Subject<number[]>();
    let branchCreates = 0;
    let branchTeardowns = 0;
    const results: number[][] = [];

    const branchOperator = (input$: Observable<number>) =>
      new Observable<number>((subscriber) => {
        branchCreates += 1;
        const sub = input$.pipe(map((v) => v * 10)).subscribe(subscriber);
        return () => {
          branchTeardowns += 1;
          sub.unsubscribe();
        };
      });

    source.pipe(combineLatestByIndex(branchOperator)).subscribe((value) => results.push(value));

    source.next([1, 2]);
    expect(branchCreates).toBe(2);
    expect(results.at(-1)).toEqual([10, 20]);

    source.next([3, 4]);
    expect(branchCreates).toBe(2);
    expect(branchTeardowns).toBe(0);
    expect(results.at(-1)).toEqual([30, 40]);

    source.next([5]);
    expect(branchTeardowns).toBe(1);
    expect(results.at(-1)).toEqual([50]);

    source.next([6, 7, 8]);
    expect(branchCreates).toBe(4);
    expect(results.at(-1)).toEqual([60, 70, 80]);
  });

  it("passes index to branch mapper", () => {
    const source = new Subject<number[]>();
    const results: number[][] = [];

    source
      .pipe(
        combineLatestByIndex<number, number>((input$: Observable<number>, index) =>
          input$.pipe(map((value) => value * (index + 1))),
        ),
      )
      .subscribe((value: number[]) => results.push(value));

    source.next([2, 2, 2]);
    expect(results.at(-1)).toEqual([2, 4, 6]);
  });

  it("waits for all active indices before first emission", () => {
    const source = new Subject<number[]>();
    const results: number[][] = [];

    source
      .pipe(
        combineLatestByIndex<number, number>((input$: Observable<number>, index) =>
          input$.pipe(
            // Index 1 does not emit on its first source value.
            index === 1 ? switchMap((value) => (value < 10 ? NEVER : of(value))) : map((value) => value),
          ),
        ),
      )
      .subscribe((value: number[]) => results.push(value));

    source.next([1, 2]);
    expect(results).toEqual([]);

    source.next([10, 20]);
    expect(results.at(-1)).toEqual([10, 20]);
  });

  it("propagates index branch errors", () => {
    const source = new Subject<number[]>();
    const errors: Error[] = [];

    source
      .pipe(
        combineLatestByIndex<number, number>(
          (input$, index) =>
            new Observable<number>((subscriber) => {
              const sub = input$.subscribe({
                next(value) {
                  if (index === 0 && value === 2) {
                    subscriber.error(new Error("index failed"));
                    return;
                  }
                  subscriber.next(value);
                },
                error(err) {
                  subscriber.error(err);
                },
                complete() {
                  subscriber.complete();
                },
              });
              return () => sub.unsubscribe();
            }),
        ),
      )
      .subscribe({
        error(err: Error) {
          errors.push(err);
        },
      });

    source.next([1, 1]);
    source.next([2, 1]);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe("index failed");
  });

  it("tears down active index branches on unsubscribe", () => {
    const source = new Subject<number[]>();
    let branchTeardowns = 0;

    const sub = source
      .pipe(
        combineLatestByIndex<number, number>(
          (input$) =>
            new Observable<number>((subscriber) => {
              const inner = input$.pipe(map((value) => value)).subscribe(subscriber);
              return () => {
                branchTeardowns += 1;
                inner.unsubscribe();
              };
            }),
        ),
      )
      .subscribe();

    source.next([1, 2, 3]);
    sub.unsubscribe();

    expect(branchTeardowns).toBe(3);
  });

  it("emits once per source update for synchronous branches", () => {
    const source = new Subject<number[]>();
    const results: number[][] = [];

    source
      .pipe(combineLatestByIndex<number, number>((input$) => input$.pipe(map((value) => value * 10))))
      .subscribe((value: number[]) => results.push(value));

    source.next([1, 2, 3]);

    expect(results).toEqual([[10, 20, 30]]);
  });
});
