import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { EventStore } from "../../event-store/event-store.js";
import { NostrEvent } from "../../helpers/event.js";
import { CASTS_SYMBOL, castEvent, CastRefEventStore } from "../cast.js";
import { EventCast } from "../event.js";

class NoteCast extends EventCast {}
class OtherCast extends EventCast {}

describe("performCast (D-13, descriptor-only migration)", () => {
  it("writes CASTS_SYMBOL non-enumerable and a spread copy drops it", () => {
    const user = new FakeUser();
    const store = new EventStore();
    const event = user.note("Test");
    store.add(event);

    const cast = castEvent(event, NoteCast, store);
    expect(cast).toBeInstanceOf(NoteCast);

    const descriptor = Object.getOwnPropertyDescriptor(event, CASTS_SYMBOL);
    expect(descriptor?.enumerable).toBe(false);

    const copy = { ...event };
    expect(Object.prototype.hasOwnProperty.call(copy, CASTS_SYMBOL)).toBe(false);
  });

  it("still memoizes the cast instance per class on the same event", () => {
    const user = new FakeUser();
    const store = new EventStore();
    const event = user.note("Test");
    store.add(event);

    expect(castEvent(event, NoteCast, store)).toBe(castEvent(event, NoteCast, store));

    // Not asserting Map-aliasing behavior across spread copies -- that defect (D-08) stays
    // deliberately deferred and out of scope for this migration (D-13).
    const other = castEvent(event, OtherCast, store);
    expect(other).toBeInstanceOf(OtherCast);
    expect(other).not.toBe(castEvent(event, NoteCast, store));
  });
});

describe("performCast failures", () => {
  class RejectingCast extends EventCast {
    static attempts = 0;
    constructor(event: NostrEvent, store: CastRefEventStore) {
      RejectingCast.attempts++;
      throw new Error("Invalid event");
      super(event, store);
    }
  }

  it("remembers a failed cast and rethrows the same error without re-running the constructor", () => {
    const user = new FakeUser();
    const store = new EventStore();
    const event = user.note("Test");
    store.add(event);

    let first: unknown;
    try {
      castEvent(event, RejectingCast, store);
    } catch (error) {
      first = error;
    }

    expect(() => castEvent(event, RejectingCast, store)).toThrow(first as Error);
    expect(RejectingCast.attempts).toBe(1);
  });

  it("does not block other casts of the same event", () => {
    const user = new FakeUser();
    const store = new EventStore();
    const event = user.note("Test");
    store.add(event);

    expect(() => castEvent(event, RejectingCast, store)).toThrow();
    expect(castEvent(event, NoteCast, store)).toBeInstanceOf(NoteCast);
  });
});
