// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { BehaviorSubject } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { createControlledObservable, createTrackedObservable } from "../../__tests__/rendering-fixtures.js";
import { use$ } from "../use-$.js";

describe("use$", () => {
  it("supports direct synchronous and asynchronous observables", () => {
    const sync = new BehaviorSubject("sync");
    const async = createControlledObservable<string>();
    const { result, rerender } = renderHook(({ source }) => use$(source), { initialProps: { source: sync } });

    expect(result.current).toBe("sync");
    rerender({ source: async.observable });
    expect(result.current).toBeUndefined();
    act(() => async.next("async"));
    expect(result.current).toBe("async");
  });

  it("replaces factory sources only when dependencies change", () => {
    const first = createTrackedObservable("first");
    const second = createTrackedObservable("second");
    const factory = vi.fn((choice: number) => (choice === 1 ? first.observable : second.observable));
    const { result, rerender, unmount } = renderHook(({ choice, noise }) => use$(() => factory(choice), [choice]), {
      initialProps: { choice: 1, noise: 0 },
    });

    expect(result.current).toBe("first");
    rerender({ choice: 1, noise: 1 });
    expect(factory).toHaveBeenCalledTimes(1);
    rerender({ choice: 2, noise: 1 });
    expect(result.current).toBe("second");
    expect(first.active).toBe(0);
    expect(second.active).toBe(1);
    unmount();
    expect(second.active).toBe(0);
  });
});
