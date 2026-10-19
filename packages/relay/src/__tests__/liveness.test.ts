import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RelayLiveness } from "../liveness.js";

const relay = "wss://relay.example.com/";
let liveness: RelayLiveness;

beforeEach(() => {
  vi.useFakeTimers();
  liveness = new RelayLiveness({ backoffBaseDelay: 1000, backoffMaxDelay: 60_000 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("recordFailure", () => {
  it("should clear the backoff once it ends", () => {
    liveness.recordFailure(relay);
    expect(liveness.isInBackoff(relay)).toBe(true);

    vi.advanceTimersByTime(1000);
    expect(liveness.getState(relay)?.backoffUntil).toBeUndefined();
  });

  it("should not let an earlier backoff timer end a newer backoff", () => {
    liveness.recordFailure(relay);
    vi.advanceTimersByTime(500);
    liveness.recordSuccess(relay);
    vi.advanceTimersByTime(100);
    liveness.recordFailure(relay);

    // The first failure's timer would fire here, 400ms before the second backoff ends
    vi.advanceTimersByTime(500);
    expect(liveness.isInBackoff(relay)).toBe(true);
  });
});
