import { Observable, Subject, filter, map, of } from "rxjs";
import { describe, expect, expectTypeOf, it } from "vitest";
import { combineLatestBy } from "../combine-latest-by.js";

describe("combineLatestBy", () => {
  it("should subscribe to the source only once per subscription", () => {
    let subscribeCount = 0;
    let unsubscribeCount = 0;
    const values: Array<{ latest: number; doubled: number }> = [];
    const sourceSubject = new Subject<number>();

    const source = new Observable<number>((subscriber) => {
      subscribeCount++;
      const sub = sourceSubject.subscribe(subscriber);

      return () => {
        sub.unsubscribe();
        unsubscribeCount++;
      };
    });

    const sub = source
      .pipe(
        combineLatestBy({
          latest: map((value) => value),
          doubled: map((value) => value * 2),
        }),
      )
      .subscribe((value) => values.push(value));

    sourceSubject.next(1);
    sourceSubject.next(2);

    expect(subscribeCount).toBe(1);
    expect(values).toEqual([
      { latest: 1, doubled: 2 },
      { latest: 2, doubled: 2 },
      { latest: 2, doubled: 4 },
    ]);

    sub.unsubscribe();
    expect(unsubscribeCount).toBe(1);
  });

  it("should follow combineLatest semantics across branches", () => {
    const source = new Subject<number>();
    const values: Array<{ latest: number; even: number }> = [];

    const sub = source
      .pipe(
        combineLatestBy({
          latest: map((value) => value),
          even: filter((value) => value % 2 === 0),
        }),
      )
      .subscribe((value) => values.push(value));

    source.next(1);
    expect(values).toEqual([]);

    source.next(2);
    expect(values).toEqual([{ latest: 2, even: 2 }]);

    source.next(3);
    expect(values).toEqual([
      { latest: 2, even: 2 },
      { latest: 3, even: 2 },
    ]);

    sub.unsubscribe();
  });

  it("should teardown branch subscriptions when unsubscribed", () => {
    const source = new Observable<number>((subscriber) => {
      subscriber.next(1);

      return () => {
        teardownCount++;
      };
    });

    let teardownCount = 0;

    const sub = source
      .pipe(
        combineLatestBy({
          latest: map((value) => value),
          doubled: map((value) => value * 2),
        }),
      )
      .subscribe();

    sub.unsubscribe();
    expect(teardownCount).toBe(1);
  });

  it("should handle synchronous cold sources without dropping branch values", () => {
    const values: Array<{ latest: number; doubled: number }> = [];

    of(1)
      .pipe(
        combineLatestBy({
          latest: map((value) => value),
          doubled: map((value) => value * 2),
        }),
      )
      .subscribe((value) => values.push(value));

    expect(values).toEqual([{ latest: 1, doubled: 2 }]);
  });

  it("should support array operators and emit tuple-like values", () => {
    const source = new Subject<number>();
    const values: Array<readonly [number, number]> = [];
    const operators = [map((value: number) => value), map((value: number) => value * 2)] as const;

    const sub = source.pipe(combineLatestBy(operators)).subscribe((value) => values.push(value));

    source.next(1);
    source.next(2);

    expect(values).toEqual([
      [1, 2],
      [2, 2],
      [2, 4],
    ]);

    sub.unsubscribe();
  });

  it("should subscribe upstream once when using array operators", () => {
    let subscribeCount = 0;
    let unsubscribeCount = 0;
    const values: Array<readonly [number, number]> = [];
    const sourceSubject = new Subject<number>();
    const operators = [map((value: number) => value), map((value: number) => value * 2)] as const;

    const source = new Observable<number>((subscriber) => {
      subscribeCount++;
      const sub = sourceSubject.subscribe(subscriber);

      return () => {
        sub.unsubscribe();
        unsubscribeCount++;
      };
    });

    const sub = source.pipe(combineLatestBy(operators)).subscribe((value) => values.push(value));

    sourceSubject.next(1);
    sourceSubject.next(2);

    expect(subscribeCount).toBe(1);
    expect(values).toEqual([
      [1, 2],
      [2, 2],
      [2, 4],
    ]);

    sub.unsubscribe();
    expect(unsubscribeCount).toBe(1);
  });

  it("should support synchronous cold sources with array operators", () => {
    const values: Array<readonly [number, number]> = [];
    const operators = [map((value: number) => value), map((value: number) => value * 2)] as const;

    of(1)
      .pipe(combineLatestBy(operators))
      .subscribe((value) => values.push(value));

    expect(values).toEqual([[1, 2]]);
  });

  it("should infer output types for object and array branches", () => {
    const object$ = of(1).pipe(
      combineLatestBy({
        latest: map((value) => value),
        isEven: map((value) => value % 2 === 0),
        str: map((value) => String(value)),
      }),
    );

    const tuple$ = of(1).pipe(
      combineLatestBy([map((value: number) => value), map((value: number) => value.toString())]),
    );

    expectTypeOf(object$).toEqualTypeOf<Observable<{ latest: number; isEven: boolean; str: string }>>();
    expectTypeOf(tuple$).toEqualTypeOf<Observable<[number, string]>>();
  });
});
