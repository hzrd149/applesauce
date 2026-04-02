import { describe, expect, it } from "vitest";
import { of, timeout } from "rxjs";
import { TestScheduler } from "rxjs/testing";
import { timeoutWithIgnore } from "../timeout-with-ignore.js";

describe("timeoutWithIgnore", () => {
  it("matches timeout() behavior when nothing is ignored", () => {
    const testScheduler = new TestScheduler((actual, expected) => {
      expect(actual).toEqual(expected);
    });

    testScheduler.run(({ cold, expectObservable }) => {
      const source$ = cold("--a--b-----c|");
      const config = { first: 4, each: 4, with: () => of("t") };

      expectObservable(source$.pipe(timeout(config))).toBe("--a--b---(t|)", { a: "a", b: "b", t: "t" });
      expectObservable(source$.pipe(timeoutWithIgnore({ ...config, ignore: () => false }))).toBe("--a--b---(t|)", {
        a: "a",
        b: "b",
        t: "t",
      });
    });
  });

  it("still times out on first non-ignored value even if ignored values are emitted", () => {
    const testScheduler = new TestScheduler((actual, expected) => {
      expect(actual).toEqual(expected);
    });

    testScheduler.run(({ cold, expectObservable }) => {
      const source$ = cold("--i--i--n|");
      const config = { first: 7, each: 7, with: () => of("t") };

      expectObservable(source$.pipe(timeoutWithIgnore({ ...config, ignore: ["i"] }))).toBe("--i--i-(t|)", {
        i: "i",
        t: "t",
      });
    });
  });

  it("does not reset each-timeout when ignored values are emitted between valid values", () => {
    const testScheduler = new TestScheduler((actual, expected) => {
      expect(actual).toEqual(expected);
    });

    testScheduler.run(({ cold, expectObservable }) => {
      const source$ = cold("--n--i--i--i---n|");
      const config = { first: 5, each: 5, with: () => of("t") };

      expectObservable(source$.pipe(timeoutWithIgnore({ ...config, ignore: ["i"] }))).toBe("--n--i-(t|)", {
        n: "n",
        i: "i",
        t: "t",
      });
    });
  });
});
