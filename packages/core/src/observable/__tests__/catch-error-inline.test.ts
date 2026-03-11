import { describe, expect, it } from "vitest";
import { concat, lastValueFrom, of, throwError, toArray } from "rxjs";
import { catchErrorInline } from "../catch-error-inline.js";

describe("catchErrorInline", () => {
  it("passes through values when source does not error", async () => {
    const result = await lastValueFrom(of(1, 2, 3).pipe(catchErrorInline(), toArray()));
    expect(result).toEqual([1, 2, 3]);
  });

  it("emits the error as a value when source throws an Error", async () => {
    const err = new Error("boom");
    const result = await lastValueFrom(throwError(() => err).pipe(catchErrorInline(), toArray()));
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(err);
    expect((result[0] as Error).message).toBe("boom");
  });

  it("emits values then the error as a value when source emits then errors", async () => {
    const err = new Error("oops");
    const source = concat(
      of("a", "b"),
      throwError(() => err),
    );
    const result = await lastValueFrom(source.pipe(catchErrorInline(), toArray()));
    expect(result).toEqual(["a", "b", err]);
  });

  it("wraps non-Error thrown values in Error using err.message", async () => {
    const result = await lastValueFrom(throwError(() => ({ message: "custom" })).pipe(catchErrorInline(), toArray()));
    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(Error);
    expect((result[0] as Error).message).toBe("custom");
  });

  it("wraps thrown primitives in Error when they have no .message", async () => {
    const result = await lastValueFrom(throwError(() => "string").pipe(catchErrorInline(), toArray()));
    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(Error);
    // new Error(undefined) yields message "" in JS
    expect((result[0] as Error).message).toBe("");
  });
});
