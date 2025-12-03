import { describe, it, expect, vi } from "vitest";
import { Subject } from "rxjs";
import { distinctRelays } from "../distinct-relays.js";

describe("distinctRelays", () => {
  it("should filter out messages with same relay within timeout window", () => {
    const fn = vi.fn();
    const source$ = new Subject<any>();
    source$.pipe(distinctRelays((msg) => msg.id, 1000)).subscribe(fn);

    const message = {
      id: "123",
      relays: ["relay1", "relay2"],
    };

    // Send message with two relays
    source$.next(message);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(message);

    // send message again
    source$.next({ ...message });

    // should not call again
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should only remove duplicate relays in timeout window", () => {
    const fn = vi.fn();
    const source$ = new Subject<any>();
    source$.pipe(distinctRelays((msg) => msg.id, 1000)).subscribe(fn);

    const message = {
      id: "123",
      relays: ["relay1", "relay2"],
    };

    // Send message with two relays
    source$.next(message);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(message);

    // send message again
    source$.next({ id: "123", relays: ["relay1", "relay3"] });

    // should not call again
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenCalledWith({ id: "123", relays: ["relay3"] });
  });

  it("should filter out duplicate messages without relays in timeout", () => {
    const fn = vi.fn();
    const source$ = new Subject<any>();
    source$.pipe(distinctRelays((msg) => msg.id, 1000)).subscribe(fn);

    const message = { id: "123" };

    // Send message with two relays
    source$.next(message);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(message);

    // send message again
    source$.next({ ...message });

    // should not call again
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should treat messages with relays severalty then messages without", () => {
    const fn = vi.fn();
    const source$ = new Subject<any>();
    source$.pipe(distinctRelays((msg) => msg.id, 1000)).subscribe(fn);

    const withRelays = {
      id: "123",
      relays: ["relay1", "relay2"],
    };
    const withoutRelays = {
      id: "123",
    };

    // Send message with two relays
    source$.next(withoutRelays);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(withoutRelays);

    // send message with relays
    source$.next(withRelays);

    // should not call again
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenCalledWith(withRelays);
  });
});
