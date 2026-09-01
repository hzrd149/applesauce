import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { normalizeURL } from "applesauce-core/helpers/url";
import { BehaviorSubject, Observable, of, throwError } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { RelayGroup, RelayGroupError } from "../group.js";
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
});
