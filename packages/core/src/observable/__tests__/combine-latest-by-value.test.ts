import { NEVER, Observable, Subject, of } from "rxjs";
import { describe, expect, it } from "vitest";
import { combineLatestByValue } from "../index.js";

describe("combineLatestByValue", () => {
  it("maps input arrays to output maps", () => {
    const source = new Subject<number[]>();
    const results: Array<Map<number, number>> = [];

    source.pipe(combineLatestByValue((value) => of(value * 10))).subscribe((value) => {
      results.push(value);
    });

    source.next([1, 2]);
    expect(results).toEqual([
      new Map([
        [1, 10],
        [2, 20],
      ]),
    ]);
  });

  it("deduplicates duplicate values in the same array", () => {
    const source = new Subject<number[]>();
    const results: Array<Map<number, number>> = [];

    source.pipe(combineLatestByValue((value) => of(value * 2))).subscribe((value) => {
      results.push(value);
    });

    source.next([1, 1, 1]);
    expect(results.at(-1)).toEqual(new Map([[1, 2]]));
  });

  it("reuses active value branches and recreates removed/re-added values", () => {
    const source = new Subject<number[]>();
    const branchCreates = new Map<number, number>();
    const branchTeardowns = new Map<number, number>();
    const results: Array<Map<number, number>> = [];

    source
      .pipe(
        combineLatestByValue(
          (value) =>
            new Observable<number>((subscriber) => {
              branchCreates.set(value, (branchCreates.get(value) ?? 0) + 1);
              subscriber.next(value);
              return () => {
                branchTeardowns.set(value, (branchTeardowns.get(value) ?? 0) + 1);
              };
            }),
        ),
      )
      .subscribe((value) => results.push(value));

    source.next([1, 2]);
    expect(branchCreates).toEqual(
      new Map([
        [1, 1],
        [2, 1],
      ]),
    );
    expect(results.at(-1)).toEqual(
      new Map([
        [1, 1],
        [2, 2],
      ]),
    );

    source.next([1, 2]);
    expect(branchCreates.get(1)).toBe(1);
    expect(branchCreates.get(2)).toBe(1);
    expect(results.at(-1)).toEqual(
      new Map([
        [1, 1],
        [2, 2],
      ]),
    );

    source.next([1]);
    expect(branchTeardowns.get(2)).toBe(1);
    expect(results.at(-1)).toEqual(new Map([[1, 1]]));

    source.next([1, 2]);
    expect(branchCreates.get(2)).toBe(2);
    expect(results.at(-1)).toEqual(
      new Map([
        [1, 1],
        [2, 2],
      ]),
    );
  });

  it("passes value into branch mapper", () => {
    const source = new Subject<string[]>();
    const results: Array<Map<string, number>> = [];

    source.pipe(combineLatestByValue((value) => of(value.length))).subscribe((value) => results.push(value));

    source.next(["aa", "b"]);
    expect(results.at(-1)).toEqual(
      new Map([
        ["aa", 2],
        ["b", 1],
      ]),
    );
  });

  it("waits for all active values before first emission", () => {
    const source = new Subject<number[]>();
    const results: Array<Map<number, number>> = [];

    source
      .pipe(combineLatestByValue((value) => (value === 2 ? NEVER : of(value))))
      .subscribe((value) => results.push(value));

    source.next([1, 2]);
    expect(results).toEqual([]);

    source.next([1]);
    expect(results.at(-1)).toEqual(new Map([[1, 1]]));
  });

  it("propagates value branch errors", () => {
    const source = new Subject<number[]>();
    const errors: Error[] = [];

    source
      .pipe(
        combineLatestByValue(
          (value) => new Observable<number>((subscriber) => subscriber.error(new Error(`${value} failed`))),
        ),
      )
      .subscribe({
        error(err: Error) {
          errors.push(err);
        },
      });

    source.next([1, 2]);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe("1 failed");
  });

  it("tears down active value branches on unsubscribe", () => {
    const source = new Subject<number[]>();
    let branchTeardowns = 0;

    const sub = source
      .pipe(
        combineLatestByValue(
          (_value) =>
            new Observable<number>((subscriber) => {
              subscriber.next(1);
              return () => {
                branchTeardowns += 1;
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
    const results: Array<Map<number, number>> = [];

    source.pipe(combineLatestByValue((value) => of(value * 10))).subscribe((value) => results.push(value));

    source.next([1, 2, 3]);
    source.next([1, 2, 3]);

    expect(results).toEqual([
      new Map([
        [1, 10],
        [2, 20],
        [3, 30],
      ]),
      new Map([
        [1, 10],
        [2, 20],
        [3, 30],
      ]),
    ]);
  });
});
