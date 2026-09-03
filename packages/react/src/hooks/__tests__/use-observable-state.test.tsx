// @vitest-environment jsdom

import { act, render, renderHook, screen } from "@testing-library/react";
import { StrictMode, useEffect, useLayoutEffect } from "react";
import { BehaviorSubject, Observable } from "rxjs";
import { describe, expect, it } from "vitest";
import {
  createControlledObservable,
  createTrackedObservable,
  ErrorBoundary,
} from "../../__tests__/rendering-fixtures.js";
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

  it("releases the old source and adopts the replacement immediately", () => {
    const oldSource = createTrackedObservable("old");
    const replacement = createTrackedObservable<string>();
    const { result, rerender } = renderHook(({ source }) => useObservableState(source), {
      initialProps: { source: oldSource.observable },
    });

    expect(result.current).toBe("old");
    rerender({ source: replacement.observable });
    expect(result.current).toBeUndefined();
    expect(oldSource.active).toBe(0);
    act(() => oldSource.next("stale"));
    expect(result.current).toBeUndefined();
    act(() => replacement.next("fresh"));
    expect(result.current).toBe("fresh");
  });

  it("subscribes to a replacement before a later sibling emits in the same commit", () => {
    const oldSource = createControlledObservable<string>();
    const replacement = createControlledObservable<string>();
    const order: string[] = [];

    function Consumer({ source }: { source: Observable<string> }) {
      const value = useObservableState(source);
      useLayoutEffect(() => void order.push("consumer-layout"), [source]);
      useEffect(() => void order.push("consumer-passive"), [source]);
      return <span>{value ?? "empty"}</span>;
    }

    function Emitter({ source }: { source: ReturnType<typeof createControlledObservable<string>> }) {
      useLayoutEffect(() => {
        order.push("emitter-layout");
        source.next("fresh");
      }, [source]);
      return null;
    }

    function Parent({ replacementCommit }: { replacementCommit: boolean }) {
      return (
        <>
          <Consumer source={replacementCommit ? replacement.observable : oldSource.observable} />
          {replacementCommit && <Emitter source={replacement} />}
        </>
      );
    }

    const view = render(<Parent replacementCommit={false} />);
    order.length = 0;
    view.rerender(<Parent replacementCommit />);

    expect(order).toEqual(["consumer-layout", "emitter-layout", "consumer-passive"]);
    expect(screen.getByText("fresh")).toBeTruthy();
  });

  it("routes subscription-time and active errors to an error boundary", () => {
    const early = new Observable<string>((subscriber) => subscriber.error(new Error("early")));
    const late = createControlledObservable<string>();
    const Probe = ({ source }: { source: Observable<string> }) => <span>{useObservableState(source)}</span>;
    const { rerender } = render(
      <ErrorBoundary resetKey="early" fallback={<span>caught</span>}>
        <Probe source={early} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("caught")).toBeTruthy();

    rerender(
      <ErrorBoundary resetKey="late" fallback={<span>caught</span>}>
        <Probe source={late.observable} />
      </ErrorBoundary>,
    );
    act(() => late.error(new Error("late")));
    expect(screen.getByText("caught")).toBeTruthy();
  });

  it("does not route errors from a replaced source", () => {
    const stale = createControlledObservable<string>();
    const active = createControlledObservable<string>();
    const Probe = ({ source }: { source: Observable<string> }) => <span>{useObservableState(source)}</span>;
    const { rerender } = render(
      <ErrorBoundary fallback={<span>stale-caught</span>}>
        <Probe source={stale.observable} />
      </ErrorBoundary>,
    );

    rerender(
      <ErrorBoundary fallback={<span>stale-caught</span>}>
        <Probe source={active.observable} />
      </ErrorBoundary>,
    );
    act(() => stale.error(new Error("stale")));
    expect(screen.queryByText("stale-caught")).toBeNull();
    act(() => active.next("active"));
    expect(screen.getByText("active")).toBeTruthy();
  });

  it("tears down every subscription exactly once on replacement and unmount", () => {
    const first = createTrackedObservable("first");
    const second = createTrackedObservable("second");
    const { rerender, unmount } = renderHook(({ source }) => useObservableState(source), {
      initialProps: { source: first.observable },
      wrapper: StrictMode,
    });

    rerender({ source: second.observable });
    unmount();
    expect(first.active + second.active).toBe(0);
    expect([...first.subscriptions, ...second.subscriptions].every(({ teardowns }) => teardowns === 1)).toBe(true);
  });
});
