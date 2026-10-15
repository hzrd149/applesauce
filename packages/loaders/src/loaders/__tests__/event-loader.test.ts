import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { NostrEvent } from "applesauce-core/helpers/event";
import { of, Subject } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from "vitest";

import { FakeUser } from "../../__tests__/fake-user.js";
import { NostrRequest } from "../../types.js";
import { createEventLoader, relayHintsEventsLoader, relaysEventsLoader } from "../event-loader.js";

const user = new FakeUser();

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("createEventLoader", () => {
  it("delivers synchronous cache hits to every consumer alongside async misses", () => {
    const cached = user.note("cached");
    const missing = user.note("missing");
    const relay = new Subject<NostrEvent>();
    const loader = createEventLoader(() => relay, {
      bufferTime: 10,
      eventStore: null,
      cacheRequest: () => [cached],
      extraRelays: ["wss://extra.test"],
    });

    const a = subscribeSpyTo(loader({ id: cached.id }));
    const b = subscribeSpyTo(loader({ id: cached.id }));
    const c = subscribeSpyTo(loader({ id: missing.id }));
    vi.advanceTimersByTime(10);

    expect(a.getValues()).toEqual([cached]);
    expect(b.getValues()).toEqual([cached]);

    relay.next(missing);
    relay.complete();
    expect(c.getValues()).toEqual([missing]);
    expect(c.receivedComplete()).toBe(true);
  });
});

describe("capped relay responses", () => {
  const notes = Array.from({ length: 5 }, (_, i) => user.note(`note ${i}`));
  const pointers = notes.map((n) => ({ id: n.id }));

  /** A request that returns at most `cap` matching events per call */
  const cappedRequest = (cap: number): Mock<NostrRequest> =>
    vi.fn((_relays, filters) => of(...notes.filter((n) => filters[0].ids!.includes(n.id)).slice(0, cap)));

  it("should re-request the ids a capped relay dropped", () => {
    const request = cappedRequest(2);
    const spy = subscribeSpyTo(relaysEventsLoader(request, ["wss://relay.com"])(pointers));

    expect(spy.getValues()).toEqual(notes);
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[2][1]).toEqual([{ ids: [notes[4].id] }]);
  });

  it("should not retry when a round resolves nothing", () => {
    const request = cappedRequest(0);
    subscribeSpyTo(relaysEventsLoader(request, ["wss://relay.com"])(pointers));

    expect(request).toHaveBeenCalledOnce();
  });

  it("should stop after a bounded number of rounds", () => {
    const many = Array.from({ length: 10 }, (_, i) => user.note(`many ${i}`));
    const request: Mock<NostrRequest> = vi.fn((_relays, filters) =>
      of(...many.filter((n) => filters[0].ids!.includes(n.id)).slice(0, 1)),
    );
    const spy = subscribeSpyTo(relaysEventsLoader(request, ["wss://relay.com"])(many.map((n) => ({ id: n.id }))));

    expect(request).toHaveBeenCalledTimes(5);
    expect(spy.getValues()).toHaveLength(5);
  });

  it("should retry missing hinted ids on their own relay", () => {
    const request = cappedRequest(2);
    const loader = relayHintsEventsLoader(request);
    const spy = subscribeSpyTo(loader(pointers.map((p) => ({ ...p, relays: ["wss://relay.com/"] }))));

    expect(spy.getValues()).toEqual(notes);
    expect(request.mock.calls.every(([relays]) => relays[0] === "wss://relay.com/")).toBe(true);
  });
});
