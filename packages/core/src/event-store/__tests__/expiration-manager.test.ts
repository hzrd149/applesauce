import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { unixNow } from "../../helpers";
import { ExpirationManager } from "../expiration-manager.js";

let expirationManager: ExpirationManager;
const user = new FakeUser();

beforeEach(() => {
  vi.useFakeTimers();
  expirationManager = new ExpirationManager();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("track", () => {
  it("should track events with expiration tags", () => {
    const event = user.note("test", { tags: [["expiration", String(unixNow() + 1000)]] });
    expirationManager.track(event);

    // Event should not be expired yet
    expect(expirationManager.check(event)).toBe(false);
  });

  it("should identify expired events", () => {
    const event = user.note("test", { tags: [["expiration", String(unixNow() - 1000)]] });
    expirationManager.track(event);

    // Event should be expired
    expect(expirationManager.check(event)).toBe(true);
  });

  it("should ignore events without expiration tags", () => {
    const event = user.note("test");
    expirationManager.track(event);

    // Event without expiration should not be expired
    expect(expirationManager.check(event)).toBe(false);
  });

  it("should handle events with invalid expiration tags", () => {
    const event = user.note("test", { tags: [["expiration", "invalid"]] });
    expirationManager.track(event);

    // Event with invalid expiration should not be expired
    expect(expirationManager.check(event)).toBe(false);
  });
});

describe("remove", () => {
  it("should remove events from tracking", () => {
    const event = user.note("test", { tags: [["expiration", String(unixNow() + 1000)]] });
    expirationManager.track(event);

    expirationManager.forget(event.id);

    // After removal, check should still work but event won't be tracked for expiration
    // The check method doesn't depend on tracking, so it will still check the expiration tag
    expect(expirationManager.check(event)).toBe(false);
  });
});

describe("expired$ stream", () => {
  it("should emit event IDs when they expire", async () => {
    const event = user.note("test", { tags: [["expiration", String(unixNow() + 1)]] });
    expirationManager.track(event);

    const spy = subscribeSpyTo(expirationManager.expired$);

    // Wait for expiration
    await vi.advanceTimersByTimeAsync(1100);

    // Should emit the expired event ID
    expect(spy.getValues()).toContain(event.id);
  });

  it("should not emit events that are not expired", async () => {
    const event = user.note("test", { tags: [["expiration", String(unixNow() + 2)]] });
    const spy = subscribeSpyTo(expirationManager.expired$);

    expirationManager.track(event);

    // Should not emit since event hasn't expired
    expect(spy.getValues()).not.toContain(event.id);
  });
});

describe("dispose", () => {
  it("cancels the pending timer so no timers leak", () => {
    const event = user.note("test", { tags: [["expiration", String(unixNow() + 1000)]] });
    expirationManager.track(event);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    expirationManager.dispose();

    expect(vi.getTimerCount()).toBe(0);
  });

  it("completes the expired$ stream", () => {
    const spy = subscribeSpyTo(expirationManager.expired$);

    expirationManager.dispose();

    expect(spy.receivedComplete()).toBe(true);
  });

  it("works with the `using` keyword via Symbol.dispose", () => {
    let completed = false;
    {
      using manager = new ExpirationManager();
      manager.expired$.subscribe({ complete: () => (completed = true) });
      expect(completed).toBe(false);
    }
    // Exiting the block calls manager[Symbol.dispose]() which completes expired$
    expect(completed).toBe(true);
  });

  it("does not emit after disposal when a tracked expiration would have fired", async () => {
    const event = user.note("test", { tags: [["expiration", String(unixNow() + 1)]] });
    const spy = subscribeSpyTo(expirationManager.expired$);
    expirationManager.track(event);

    expirationManager.dispose();
    await vi.advanceTimersByTimeAsync(2000);

    expect(spy.getValues()).not.toContain(event.id);
  });
});

describe("far-future expirations", () => {
  const MAX_TIMER_DELAY = 2_147_483_647;

  it("clamps the scheduled delay to the 32-bit timer limit (D1-a)", () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const event = user.note("test", { tags: [["expiration", String(unixNow() + 365 * 24 * 60 * 60)]] });

    expirationManager.track(event);

    expect(setTimeoutSpy).toHaveBeenCalled();
    for (const call of setTimeoutSpy.mock.calls) {
      expect(call[1]).toBeLessThanOrEqual(MAX_TIMER_DELAY);
    }
  });

  it("still expires a far-future event via chunked re-arm (D1-b)", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const event = user.note("test", { tags: [["expiration", String(unixNow() + 365 * 24 * 60 * 60)]] });
    expirationManager.track(event);

    const spy = subscribeSpyTo(expirationManager.expired$);

    await vi.advanceTimersByTimeAsync(366 * 24 * 60 * 60 * 1000);

    expect(spy.getValues()).toContain(event.id);
    expect(setTimeoutSpy.mock.calls.length).toBeGreaterThan(1);
  });

  it("schedules and expires at the boundary of the 32-bit cap (D1-c)", async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const underManager = new ExpirationManager();
    const underEvent = user.note("test", { tags: [["expiration", String(unixNow() + 24 * 24 * 60 * 60)]] });
    const underSpy = subscribeSpyTo(underManager.expired$);
    underManager.track(underEvent);

    const overManager = new ExpirationManager();
    const overEvent = user.note("test", { tags: [["expiration", String(unixNow() + 26 * 24 * 60 * 60)]] });
    const overSpy = subscribeSpyTo(overManager.expired$);
    overManager.track(overEvent);

    for (const call of setTimeoutSpy.mock.calls) {
      expect(call[1]).toBeLessThanOrEqual(MAX_TIMER_DELAY);
    }

    await vi.advanceTimersByTimeAsync((26 * 24 * 60 * 60 + 20) * 1000);

    expect(underSpy.getValues()).toContain(underEvent.id);
    expect(overSpy.getValues()).toContain(overEvent.id);

    underManager.dispose();
    overManager.dispose();
  });
});

describe("stale timer bookkeeping (D2)", () => {
  it("still schedules a newly tracked event after the last one is forgotten and its timer fires", async () => {
    const eventA = user.note("test", { tags: [["expiration", String(unixNow() + 10)]] });
    expirationManager.track(eventA);
    expirationManager.forget(eventA.id);

    // Timer fires with nothing left to expire
    await vi.advanceTimersByTimeAsync(11000);

    const eventB = user.note("test", { tags: [["expiration", String(unixNow() + 10)]] });
    const spy = subscribeSpyTo(expirationManager.expired$);
    expirationManager.track(eventB);

    await vi.advanceTimersByTimeAsync(11000);

    expect(spy.getValues()).toContain(eventB.id);
  });
});
