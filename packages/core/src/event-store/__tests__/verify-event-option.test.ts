import { describe, expect, it, vi } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { verifiedSymbol } from "../../helpers/event.js";
import { EventStore } from "../event-store.js";

const user = new FakeUser();

/**
 * Builds a validly-shaped signed event and flips a bit in its signature so it fails
 * verification. The cached {@link verifiedSymbol} (set by `finalizeEvent`) is stripped so
 * `verifyEvent`'s memoization doesn't short-circuit and skip re-verifying the tampered signature.
 */
function createInvalidlySignedEvent() {
  const event = user.note("original content");
  const tampered = { ...event, sig: event.sig.slice(0, -2) + (event.sig.endsWith("00") ? "01" : "00") };
  delete (tampered as Partial<typeof tampered>)[verifiedSymbol as unknown as keyof typeof tampered];
  return tampered;
}

describe("EventStore verifyEvent option (CORE-03)", () => {
  it("default store rejects an event that fails signature verification", () => {
    const store = new EventStore();
    const invalid = createInvalidlySignedEvent();

    expect(store.add(invalid)).toBeNull();
    expect(store.hasEvent(invalid.id)).toBe(false);
  });

  it("verifyEvent: undefined disables verification and accepts the invalid event", () => {
    const store = new EventStore({ verifyEvent: undefined });
    const invalid = createInvalidlySignedEvent();

    expect(store.add(invalid)).toEqual(invalid);
    expect(store.getEvent(invalid.id)).toEqual(invalid);
  });

  it("warns when constructed with verifyEvent: undefined (D-01)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      new EventStore({ verifyEvent: undefined });
      expect(warnSpy).toHaveBeenCalledWith(
        "[applesauce-core] EventStore.verifyEvent is undefined; signature checks are disabled.",
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});
