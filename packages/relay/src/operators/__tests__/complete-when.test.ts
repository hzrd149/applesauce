import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { describe, expect, it } from "vitest";
import { EMPTY, catchError, filter, ignoreElements, map, of, throwError, tap } from "rxjs";

import { completeWhen } from "../complete-when.js";

describe("completeWhen", () => {
  it("should forward source completion to the completion operator pipeline", () => {
    let sawComplete = false;

    const source = of(1, 2, 3);
    const spy = subscribeSpyTo(
      source.pipe(
        completeWhen((messages$) =>
          messages$.pipe(
            tap({
              complete: () => {
                sawComplete = true;
              },
            }),
            ignoreElements(),
          ),
        ),
      ),
    );

    expect(spy.getValues()).toEqual([1, 2, 3]);
    expect(spy.receivedComplete()).toBe(true);
    expect(sawComplete).toBe(true);
  });

  it("should forward source errors to the completion operator pipeline", () => {
    let sawError = false;

    const source = throwError(() => new Error("boom"));
    const spy = subscribeSpyTo(
      source.pipe(
        completeWhen((messages$) =>
          messages$.pipe(
            tap({
              error: () => {
                sawError = true;
              },
            }),
            ignoreElements(),
          ),
        ),
        catchError(() => EMPTY),
      ),
    );

    expect(spy.receivedComplete()).toBe(true);
    expect(sawError).toBe(true);
  });

  it("should complete when the completion operator emits a truthy value", () => {
    const source = of(1, 2, 3, 4, 5);
    const spy = subscribeSpyTo(
      source.pipe(
        completeWhen((messages$) =>
          messages$.pipe(
            filter((v) => v === 3),
            map(() => true),
          ),
        ),
      ),
    );

    expect(spy.getValues()).toEqual([1, 2]);
    expect(spy.receivedComplete()).toBe(true);
  });

  it("should not complete when check returns false", () => {
    const source = of(1, 2, 3);
    const spy = subscribeSpyTo(
      source.pipe(
        completeWhen(
          (messages$) =>
            messages$.pipe(
              filter((v) => v === 2),
              map(() => 2),
            ),
          (v) => v > 10,
        ),
      ),
    );

    expect(spy.getValues()).toEqual([1, 2, 3]);
    expect(spy.receivedComplete()).toBe(true);
  });
});
