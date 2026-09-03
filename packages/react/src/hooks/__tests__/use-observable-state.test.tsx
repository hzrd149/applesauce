// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { BehaviorSubject } from "rxjs";
import { describe, expect, it } from "vitest";
import { createControlledObservable } from "../../__tests__/rendering-fixtures.js";
import { useObservableState } from "../use-observable-state.js";

describe("useObservableState", () => {
  it("renders a synchronous first value immediately", () => {
    const source = new BehaviorSubject("ready");
    const { result } = renderHook(() => useObservableState(source));

    expect(result.current).toBe("ready");
  });

  it("renders undefined until an asynchronous source emits", () => {
    const source = createControlledObservable<string>();
    const { result } = renderHook(() => useObservableState(source.observable));

    expect(result.current).toBeUndefined();
    act(() => source.next("ready"));
    expect(result.current).toBe("ready");
  });
});
