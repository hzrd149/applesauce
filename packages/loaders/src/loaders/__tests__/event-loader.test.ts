import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { NostrEvent } from "applesauce-core/helpers/event";
import { NEVER, of, Subject } from "rxjs";
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

describe("request pressure and timeouts", () => {
  const note = user.note("target");

  it("moves on to extra relays when a hint stage times out", () => {
    const request: Mock<NostrRequest> = vi.fn((relays) => (relays[0] === "wss://extra.test/" ? of(note) : NEVER));
    const loader = createEventLoader(request, {
      bufferTime: 10,
      stageTimeout: 100,
      extraRelays: ["wss://extra.test/"],
    });

    const spy = subscribeSpyTo(loader({ id: note.id, relays: ["wss://hint.test/"] }));
    vi.advanceTimersByTime(10);
    expect(request).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(100);
    expect(spy.getValues()).toEqual([note]);
    expect(spy.receivedComplete()).toBe(true);
  });

  it("completes a stage whose relay list never emits", () => {
    const request: Mock<NostrRequest> = vi.fn(() => of(note));
    const loader = createEventLoader(request, { bufferTime: 10, stageTimeout: 100, extraRelays: NEVER });

    const spy = subscribeSpyTo(loader({ id: note.id }));
    vi.advanceTimersByTime(110);

    expect(request).not.toHaveBeenCalled();
    expect(spy.receivedComplete()).toBe(true);
  });

  it("shares a pending request with repeated pointers", () => {
    const request: Mock<NostrRequest> = vi.fn(() => NEVER);
    const loader = createEventLoader(request, { bufferTime: 10, stageTimeout: 0, extraRelays: ["wss://extra.test/"] });

    for (let i = 0; i < 5; i++) {
      subscribeSpyTo(loader({ id: note.id }));
      vi.advanceTimersByTime(10);
    }

    expect(request).toHaveBeenCalledOnce();
  });

  it("requests a repeated pointer again when it adds a new relay hint", () => {
    const request: Mock<NostrRequest> = vi.fn(() => NEVER);
    const loader = createEventLoader(request, { bufferTime: 10, stageTimeout: 0 });

    subscribeSpyTo(loader({ id: note.id, relays: ["wss://a.test/"] }));
    vi.advanceTimersByTime(10);
    subscribeSpyTo(loader({ id: note.id, relays: ["wss://a.test/", "wss://b.test/"] }));
    vi.advanceTimersByTime(10);

    expect(request.mock.calls.map(([relays]) => relays)).toContainEqual(["wss://b.test/"]);
  });

  it("delivers to every consumer and saves to the store once with the default store", () => {
    const relay = new Subject<NostrEvent>();
    const added: NostrEvent[] = [];
    const loader = createEventLoader(() => relay, {
      bufferTime: 10,
      extraRelays: ["wss://extra.test/"],
      eventStore: { add: (e: NostrEvent) => (added.push(e), e) } as any,
    });

    const a = subscribeSpyTo(loader({ id: note.id }));
    const b = subscribeSpyTo(loader({ id: note.id }));
    vi.advanceTimersByTime(10);
    relay.next(note);

    expect(a.getValues()).toEqual([note]);
    expect(b.getValues()).toEqual([note]);
    expect(added).toEqual([note]);
  });

  it("runs each stage once with the default store and a synchronous relay", () => {
    const request: Mock<NostrRequest> = vi.fn(() => of(note));
    const loader = createEventLoader(request, { bufferTime: 10, extraRelays: ["wss://extra.test/"] });

    const spy = subscribeSpyTo(loader({ id: note.id }));
    vi.advanceTimersByTime(10);

    expect(request).toHaveBeenCalledOnce();
    expect(spy.getValues()).toEqual([note]);
  });

  it("saves events to the store after the consumer unsubscribes", () => {
    const relay = new Subject<NostrEvent>();
    const added: NostrEvent[] = [];
    const loader = createEventLoader(() => relay, {
      bufferTime: 10,
      extraRelays: ["wss://extra.test/"],
      eventStore: { add: (e: NostrEvent) => (added.push(e), e) } as any,
    });

    const spy = subscribeSpyTo(loader({ id: note.id }));
    vi.advanceTimersByTime(10);
    spy.unsubscribe();
    relay.next(note);

    expect(added).toEqual([note]);
  });
});
