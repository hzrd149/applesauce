import { Observable, Subject, map, of, switchMap } from "rxjs";
import { describe, expect, it } from "vitest";
import { combineLatestByKey } from "../index.js";

describe("combineLatestByKey", () => {
  it("maps record values and emits after all active keys emit", () => {
    const source = new Subject<Record<string, number>>();
    const results: Array<Record<string, number>> = [];

    source.pipe(combineLatestByKey((input$) => input$.pipe(map((value) => value * 10)))).subscribe((value) => {
      results.push(value);
    });

    source.next({ a: 1, b: 2 });
    expect(results).toEqual([{ a: 10, b: 20 }]);
  });

  it("reuses active key branches and recreates removed/re-added keys", () => {
    const source = new Subject<Record<string, number>>();
    const branchCreates = new Map<string, number>();
    const branchTeardowns = new Map<string, number>();
    const results: Array<Record<string, number>> = [];

    source
      .pipe(
        combineLatestByKey(
          (input$, key) =>
            new Observable<number>((subscriber) => {
              branchCreates.set(key, (branchCreates.get(key) ?? 0) + 1);
              const sub = input$.pipe(map((value) => value)).subscribe(subscriber);
              return () => {
                branchTeardowns.set(key, (branchTeardowns.get(key) ?? 0) + 1);
                sub.unsubscribe();
              };
            }),
        ),
      )
      .subscribe((value) => results.push(value));

    source.next({ a: 1, b: 2 });
    expect(branchCreates).toEqual(
      new Map([
        ["a", 1],
        ["b", 1],
      ]),
    );
    expect(results.at(-1)).toEqual({ a: 1, b: 2 });

    source.next({ a: 3, b: 4 });
    expect(branchCreates.get("a")).toBe(1);
    expect(branchCreates.get("b")).toBe(1);
    expect(results.at(-1)).toEqual({ a: 3, b: 4 });

    source.next({ a: 5 });
    expect(branchTeardowns.get("b")).toBe(1);
    expect(results.at(-1)).toEqual({ a: 5 });

    source.next({ a: 6, b: 7 });
    expect(branchCreates.get("b")).toBe(2);
    expect(results.at(-1)).toEqual({ a: 6, b: 7 });
  });

  it("passes key into branch mapper", () => {
    const source = new Subject<Record<string, number>>();
    const results: Array<Record<string, number>> = [];

    source
      .pipe(combineLatestByKey((input$, key) => input$.pipe(map((value) => key.length + value))))
      .subscribe((value) => results.push(value));

    source.next({ aa: 1, b: 22 });
    expect(results.at(-1)).toEqual({ aa: 3, b: 23 });
  });

  it("propagates branch errors and stops safely", () => {
    const source = new Subject<Record<string, number>>();
    const errors: Error[] = [];

    source
      .pipe(
        combineLatestByKey((input$, key) =>
          input$.pipe(
            switchMap((value) => {
              if (key === "a" && value === 2) return new Observable<number>((_s) => _s.error(new Error("boom")));
              return of(value);
            }),
          ),
        ),
      )
      .subscribe({
        error(err: Error) {
          errors.push(err);
        },
      });

    source.next({ a: 1, b: 1 });
    source.next({ a: 2, b: 1 });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe("boom");
  });
});
