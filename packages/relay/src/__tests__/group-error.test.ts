import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { normalizeURL } from "applesauce-core/helpers/url";
import { BehaviorSubject, Observable, Subject, filter, map, of, scan, throwError } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RelayGroup, RelayGroupError } from "../group.js";
import { AUTH_PHASE_GATE, AuthPhaseGate } from "../operators/auth-retry.js";
import { Relay } from "../relay.js";

function failingRelay(url: string, error: unknown): Relay {
  return {
    url,
    requestReconnect: false,
    subscriptionReconnect: false,
    req: vi.fn(() => throwError(() => error)),
  } as unknown as Relay;
}

describe("RelayGroupError", () => {
  it("errors when all relays fail with normalized URLs and identity-preserved causes", () => {
    const first = new Error("first");
    const second = { reason: "second" };
    const relays = [failingRelay("wss://relay-one.test/", first), failingRelay("wss://relay-two.test", second)];
    const spy = subscribeSpyTo(new RelayGroup(relays).request({ kinds: [1] }, { timeout: 1_000 }), {
      expectErrors: true,
    });

    const error = spy.getError() as RelayGroupError;
    expect(error).toBeInstanceOf(RelayGroupError);
    expect(error.name).toBe("RelayGroupError");
    expect(error.message).toBe("All relays failed");
    expect(error.errors).toEqual([first, second]);
    expect(error.outcomes[normalizeURL(relays[0].url)]).toEqual({ ok: false, error: first });
    expect(error.outcomes[normalizeURL(relays[1].url)]).toEqual({ ok: false, error: second });
    expect("toJSON" in error).toBe(false);
  });

  it("errors after an event when every live relay later fails", () => {
    const streams = [new Observable<any>((subscriber) => { subscriber.next({ type: "EVENT", from: "wss://a.test", id: "x", event: { id: "x" } }); subscriber.error(new Error("a")); }), throwError(() => new Error("b"))];
    const relays = streams.map((stream, index) => {
      return {
        url: `wss://${index}.test`,
        requestReconnect: false,
        req: vi.fn(() => stream),
      } as unknown as Relay;
    });
    const spy = subscribeSpyTo(new RelayGroup(relays).request({ kinds: [1] }, { eventStore: null }), { expectErrors: true });
    expect(spy.getValues()).toHaveLength(1);
    expect(spy.getError()).toBeInstanceOf(RelayGroupError);
  });

  it("completes an empty request while an empty dynamic subscription remains pending", () => {
    expect(subscribeSpyTo(new RelayGroup([]).request({ kinds: [1] })).receivedComplete()).toBe(true);
    const relays = new BehaviorSubject<Relay[]>([]);
    const spy = subscribeSpyTo(new RelayGroup(relays).subscription({ kinds: [1] }));
    expect(spy.receivedComplete()).toBe(false);
    expect(spy.receivedError()).toBe(false);
    spy.unsubscribe();
  });

  it("completes a mixed EOSE/error request, including zero-event success", () => {
    const failed = failingRelay("wss://failed.test", new Error("failed"));
    const successful = {
      url: "wss://successful.test",
      requestReconnect: false,
      req: vi.fn(() => of({ type: "EOSE", from: "wss://successful.test", id: "x" })),
    } as unknown as Relay;
    const spy = subscribeSpyTo(new RelayGroup([failed, successful]).request({ kinds: [1] }));
    expect(spy.receivedComplete()).toBe(true);
    expect(spy.receivedError()).toBe(false);
    expect(spy.getValues()).toEqual([]);
  });

  it("replaces membership before settling and drops removed relay outcomes", () => {
    const pending = new Subject<any>();
    const removed = {
      url: "wss://removed.test",
      requestReconnect: false,
      req: vi.fn(() => pending),
    } as unknown as Relay;
    const cause = new Error("retained failed");
    const retained = failingRelay("wss://retained.test", cause);
    const relays = new BehaviorSubject([retained, removed]);
    const spy = subscribeSpyTo(new RelayGroup(relays).request({ kinds: [1] }), { expectErrors: true });
    expect(spy.receivedError()).toBe(false);

    relays.next([retained]);
    const error = spy.getError() as RelayGroupError;
    expect(error).toBeInstanceOf(RelayGroupError);
    expect(Object.keys(error.outcomes)).toEqual([normalizeURL(retained.url)]);
  });

  it("gives all-failed precedence over custom completion on the final error", () => {
    const streams = [new Subject<any>(), new Subject<any>()];
    const relays = streams.map((stream, index) => ({
      url: `wss://precedence-${index}.test`,
      requestReconnect: false,
      req: vi.fn(() => stream),
    })) as unknown as Relay[];
    const spy = subscribeSpyTo(
      new RelayGroup(relays).request(
        { kinds: [1] },
        {
          complete: (source) =>
            source.pipe(
              filter((message) => message.type === "ERROR"),
              scan((count) => count + 1, 0),
              map((count) => count === 2),
            ),
        },
      ),
      { expectErrors: true },
    );
    streams[0].error(new Error("first"));
    streams[1].error(new Error("final"));
    expect(spy.getError()).toBeInstanceOf(RelayGroupError);
    expect(spy.receivedComplete()).toBe(false);
  });
});

describe("whole-operation timeout", () => {
  afterEach(() => vi.useRealTimers());

  it("does not reset the request lifetime after activity", () => {
    vi.useFakeTimers();
    const stream = new Subject<any>();
    const relay = {
      url: "wss://timeout.test",
      requestReconnect: false,
      req: vi.fn(() => stream),
    } as unknown as Relay;
    const spy = subscribeSpyTo(new RelayGroup([relay]).request({ kinds: [1] }, { timeout: 50, eventStore: null }), {
      expectErrors: true,
    });
    vi.advanceTimersByTime(40);
    stream.next({ type: "EVENT", from: relay.url, id: "x", event: { id: "x" } });
    vi.advanceTimersByTime(10);
    expect(spy.receivedError()).toBe(true);
    expect(spy.getError()).not.toBeInstanceOf(RelayGroupError);
  });

  it("keeps subscription indefinite by default and bounds an explicit lifetime", () => {
    vi.useFakeTimers();
    const stream = new Subject<any>();
    const relay = {
      url: "wss://subscription-timeout.test",
      subscriptionReconnect: false,
      req: vi.fn(() => stream),
    } as unknown as Relay;
    const indefinite = subscribeSpyTo(new RelayGroup([relay]).subscription({ kinds: [1] }, { timeout: false }));
    vi.advanceTimersByTime(60_000);
    expect(indefinite.receivedError()).toBe(false);
    indefinite.unsubscribe();

    const bounded = subscribeSpyTo(new RelayGroup([relay]).subscription({ kinds: [1] }, { timeout: 50 }), {
      expectErrors: true,
    });
    vi.advanceTimersByTime(50);
    expect(bounded.receivedError()).toBe(true);
  });

  it("uses one gate for all relays and pauses until overlapping auth phases end", () => {
    vi.useFakeTimers();
    const streams = [new Subject<any>(), new Subject<any>()];
    const gates: AuthPhaseGate[] = [];
    const relays = streams.map((stream, index) => ({
      url: `wss://auth-${index}.test`,
      requestReconnect: false,
      req: vi.fn((_filters, opts) => {
        gates.push(opts[AUTH_PHASE_GATE]);
        return stream;
      }),
    })) as unknown as Relay[];
    const spy = subscribeSpyTo(new RelayGroup(relays).request({ kinds: [1] }, { timeout: 50 }), {
      expectErrors: true,
    });
    expect(gates[0]).toBe(gates[1]);
    gates[0].begin();
    gates[1].begin();
    vi.advanceTimersByTime(100);
    gates[0].end();
    vi.advanceTimersByTime(100);
    expect(spy.receivedError()).toBe(false);
    gates[1].end();
    vi.advanceTimersByTime(50);
    expect(spy.receivedError()).toBe(true);
  });
});
