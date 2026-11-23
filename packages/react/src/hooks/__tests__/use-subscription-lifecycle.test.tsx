// @vitest-environment jsdom

import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { StrictMode, Suspense } from "react";
import { renderToString } from "react-dom/server";
import { Observable, share, timer } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTrackedObservable } from "../../__tests__/rendering-fixtures.js";
import { use$ } from "../use-$.js";

describe("use$ subscription lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.runAllTimers();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function Consumer({ source }: { source: Observable<string> }) {
    return <span>{use$(source)}</span>;
  }

  for (const strict of [false, true]) {
    it(`shares one cleanup timer across 500 mounts (Strict Mode: ${strict})`, () => {
      const sources = Array.from({ length: 500 }, () => createTrackedObservable("ready"));
      const scheduleTimeout = vi.spyOn(globalThis, "setTimeout");
      const children = sources.map((source, index) => <Consumer key={index} source={source.observable} />);
      const { unmount } = render(strict ? <StrictMode>{children}</StrictMode> : <>{children}</>);

      expect(screen.getAllByText("ready")).toHaveLength(500);
      expect(scheduleTimeout).toHaveBeenCalledTimes(1);
      if (!strict) expect(sources.every((source) => source.subscriptions.length === 1)).toBe(true);

      act(() => vi.advanceTimersByTime(2000));
      expect(sources.every((source) => source.active === 1)).toBe(true);
      expect(vi.getTimerCount()).toBe(0);

      unmount();
      expect(sources.every((source) => source.active === 0)).toBe(true);
      expect(sources.flatMap((source) => source.subscriptions).every(({ teardowns }) => teardowns === 1)).toBe(true);
    });
  }

  it("reuses the scheduled timer across sequential commits and restarts only after it expires", () => {
    const scheduleTimeout = vi.spyOn(globalThis, "setTimeout");

    for (let index = 0; index < 50; index++) {
      const source = createTrackedObservable("ready");
      const { unmount } = render(<Consumer source={source.observable} />);
      expect(source.subscriptions).toHaveLength(1);
      unmount();
      expect(source.active).toBe(0);
    }

    expect(scheduleTimeout).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(vi.getTimerCount()).toBe(0);

    const source = createTrackedObservable("later");
    render(<Consumer source={source.observable} />);
    expect(scheduleTimeout).toHaveBeenCalledTimes(2);
  });

  it("does not trigger a shared model's keep-warm timer during normal mount", () => {
    const source = createTrackedObservable("ready");
    const shared = source.observable.pipe(share({ resetOnRefCountZero: () => timer(60_000) }));
    const scheduleInterval = vi.spyOn(globalThis, "setInterval");
    const { result, unmount } = renderHook(() => use$(shared));

    expect(result.current).toBe("ready");
    expect(source.subscriptions).toHaveLength(1);
    expect(scheduleInterval).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(2000));
    expect(source.active).toBe(1);
    expect(scheduleInterval).not.toHaveBeenCalled();

    unmount();
    expect(scheduleInterval).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(source.active).toBe(0);
  });

  it("sweeps abandoned renders after a full interval and resumes a suspended tree with fresh values", async () => {
    const first = createTrackedObservable("first");
    const later = createTrackedObservable("later");
    let resume!: () => void;
    let suspended = true;
    const pending = new Promise<void>((resolve) => {
      resume = resolve;
    });

    function Suspender() {
      if (suspended) throw pending;
      return null;
    }

    function Tree({ source }: { source: Observable<string> }) {
      return (
        <Suspense fallback={<span>waiting</span>}>
          <Consumer source={source} />
          <Suspender />
        </Suspense>
      );
    }

    const firstView = render(<Tree source={first.observable} />);
    expect(first.active).toBeGreaterThan(0);
    act(() => vi.advanceTimersByTime(999));
    const laterView = render(<Tree source={later.observable} />);
    expect(later.active).toBeGreaterThan(0);
    act(() => vi.advanceTimersByTime(1000));
    expect(first.active).toBeGreaterThan(0);
    expect(later.active).toBeGreaterThan(0);
    act(() => vi.advanceTimersByTime(1));
    expect(first.active + later.active).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    firstView.unmount();
    await act(async () => {
      suspended = false;
      resume();
      await pending;
    });
    expect(screen.getByText("later")).toBeTruthy();
    expect(later.active).toBe(1);
    act(() => later.next("fresh"));
    expect(screen.getByText("fresh")).toBeTruthy();
    laterView.unmount();
    expect(later.active).toBe(0);
    expect(later.subscriptions.every(({ teardowns }) => teardowns === 1)).toBe(true);
  });

  it("releases server-render subscriptions immediately without scheduling cleanup", () => {
    const source = createTrackedObservable("server");
    const scheduleTimeout = vi.spyOn(globalThis, "setTimeout");

    expect(renderToString(<Consumer source={source.observable} />)).toContain("server");
    expect(source.active).toBe(0);
    expect(source.subscriptions.every(({ teardowns }) => teardowns === 1)).toBe(true);
    expect(scheduleTimeout).not.toHaveBeenCalled();
  });
});
