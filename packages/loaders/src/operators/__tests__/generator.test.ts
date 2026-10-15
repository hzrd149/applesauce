import { describe, expect, it } from "vitest";
import { EMPTY, lastValueFrom, Observable, of, toArray } from "rxjs";
import { TestScheduler } from "rxjs/testing";
import { fromGenerator, generator } from "../generator.js";

let testScheduler = new TestScheduler((actual, expected) => {
  expect(actual).toEqual(expected);
});

describe("generator", () => {
  it("should work with normal generator functions", () => {
    testScheduler.run(({ expectObservable }) => {
      function* normalGenerator(value: number) {
        yield of(value + 1);
        yield of(value + 2);
        yield of(value + 3);
        yield value + 4;
      }

      const source$ = of(1).pipe(generator(normalGenerator));

      // Define expected marble diagram
      const expectedMarble = "(abcd|)";
      const expectedValues = {
        a: 2,
        b: 3,
        c: 4,
        d: 5,
      };

      expectObservable(source$).toBe(expectedMarble, expectedValues);
    });
  });

  it("should work with async generator functions", async () => {
    async function* asyncGenerator(value: string) {
      yield of(`${value}-1`);
      yield of(`${value}-2`);
      yield of(`${value}-3`);
      yield `${value}-4`;
    }

    const source$ = of("test").pipe(generator(asyncGenerator));

    const expectedValues = ["test-1", "test-2", "test-3", "test-4"];

    expect(await lastValueFrom(source$.pipe(toArray()))).toEqual(expectedValues);
  });
});

describe("fromGenerator", () => {
  const pending = (state: { active: number }) =>
    new Observable<number>(() => {
      state.active++;
      return () => state.active--;
    });

  it("should tear down a pending stage that follows a synchronous stage", () => {
    const state = { active: 0 };
    function* stages() {
      yield EMPTY;
      yield pending(state);
    }

    const sub = fromGenerator<number>(stages()).subscribe();
    expect(state.active).toBe(1);

    sub.unsubscribe();
    expect(state.active).toBe(0);
  });

  it("should tear down a pending stage in an async generator", async () => {
    const state = { active: 0 };
    async function* stages() {
      yield EMPTY;
      yield pending(state);
    }

    const sub = fromGenerator<number>(stages()).subscribe();
    await new Promise((r) => setTimeout(r, 0));
    expect(state.active).toBe(1);

    sub.unsubscribe();
    expect(state.active).toBe(0);
  });

  it("should not start another stage after unsubscribe", async () => {
    const state = { active: 0 };
    let started = false;
    async function* stages() {
      yield EMPTY;
      started = true;
      yield pending(state);
    }

    const sub = fromGenerator<number>(stages()).subscribe();
    sub.unsubscribe();
    await new Promise((r) => setTimeout(r, 0));
    expect(started).toBe(false);
    expect(state.active).toBe(0);
  });
});
