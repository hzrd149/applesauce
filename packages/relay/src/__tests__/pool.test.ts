import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { Filter, NostrEvent } from "applesauce-core/helpers";
import { BehaviorSubject, lastValueFrom, of, throwError, toArray } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WS } from "vitest-websocket-mock";

import { RelayPool } from "../pool.js";
import { RelayGroupError } from "../group.js";
import { RELAY_REQ_LIFECYCLE } from "../internal.js";
import { Relay } from "../relay";

let pool: RelayPool;
let mockServer1: WS;
let mockServer2: WS;

let mockEvent: NostrEvent;

beforeEach(async () => {
  // Mock empty information document
  vi.spyOn(Relay, "fetchInformationDocument").mockImplementation(() => of(null));

  // Create mock WebSocket servers
  mockServer1 = new WS("wss://relay1.example.com");
  mockServer2 = new WS("wss://relay2.example.com");
  pool = new RelayPool();

  mockEvent = {
    kind: 1,
    id: "test-id",
    pubkey: "test-pubkey",
    created_at: 1743712795,
    tags: [],
    content: "test content",
    sig: "test-sig",
  };
});

afterEach(async () => {
  mockServer1.close();
  mockServer2.close();
  // Clean up WebSocket mocks
  await WS.clean();
});

describe("relay", () => {
  it("should create a new relay", () => {
    const url = "wss://relay1.example.com/";
    const relay = pool.relay(url);

    expect(relay).toBeDefined();
    expect(pool.relays.get(url)).toBe(relay);
  });

  it("should return existing relay connection if already exists", () => {
    const url = "wss://relay1.example.com";
    const relay1 = pool.relay(url);
    const relay2 = pool.relay(url);

    expect(relay1).toBe(relay2);
    expect(pool.relays.size).toBe(1);
  });

  it("should normalize relay urls", () => {
    expect(pool.relay("wss://relay.example.com")).toBe(pool.relay("wss://relay.example.com/"));
    expect(pool.relay("wss://relay.example.com:443")).toBe(pool.relay("wss://relay.example.com/"));
    expect(pool.relay("ws://relay.example.com:80")).toBe(pool.relay("ws://relay.example.com/"));
  });

  it("should pass numeric reconnect defaults to created relays", () => {
    const custom = new RelayPool({ requestReconnect: 2, subscriptionReconnect: 5 });
    const relay = custom.relay("wss://relay1.example.com");

    expect(relay.requestReconnect.count).toBe(2);
    expect(relay.subscriptionReconnect.count).toBe(5);
  });
});

describe("add$", () => {
  it("should emit when a new relay is created", () => {
    const added: Relay[] = [];
    pool.add$.subscribe((r) => added.push(r));

    const relay = pool.relay("wss://relay1.example.com");

    expect(added).toHaveLength(1);
    expect(added[0]).toBe(relay);
  });

  it("should not emit when an existing relay is returned", () => {
    const added: Relay[] = [];
    pool.add$.subscribe((r) => added.push(r));

    pool.relay("wss://relay1.example.com");
    pool.relay("wss://relay1.example.com");

    expect(added).toHaveLength(1);
  });
});

describe("remove$", () => {
  it("should emit when a relay is removed by url", () => {
    const removed: Relay[] = [];
    pool.remove$.subscribe((r) => removed.push(r));

    const relay = pool.relay("wss://relay1.example.com");
    pool.remove("wss://relay1.example.com/", false);

    expect(removed).toHaveLength(1);
    expect(removed[0]).toBe(relay);
  });

  it("should emit when a relay is removed by instance", () => {
    const removed: Relay[] = [];
    pool.remove$.subscribe((r) => removed.push(r));

    const relay = pool.relay("wss://relay1.example.com");
    pool.remove(relay, false);

    expect(removed).toHaveLength(1);
    expect(removed[0]).toBe(relay);
  });

  it("should remove the relay from the pool", () => {
    pool.relay("wss://relay1.example.com");
    pool.remove("wss://relay1.example.com/", false);

    expect(pool.relays.size).toBe(0);
  });
});

describe("close", () => {
  it("should close and remove every relay in the pool", () => {
    const relay1 = pool.relay("wss://relay1.example.com");
    const relay2 = pool.relay("wss://relay2.example.com");
    const close1 = vi.spyOn(relay1, "close");
    const close2 = vi.spyOn(relay2, "close");

    pool.close();

    expect(close1).toHaveBeenCalled();
    expect(close2).toHaveBeenCalled();
    expect(pool.relays.size).toBe(0);
  });

  it("should emit remove$ for every closed relay", () => {
    const removed: Relay[] = [];
    pool.remove$.subscribe((r) => removed.push(r));

    pool.relay("wss://relay1.example.com");
    pool.relay("wss://relay2.example.com");
    pool.close();

    expect(removed).toHaveLength(2);
  });
});

describe("req", () => {
  it("should send subscription to multiple relays", async () => {
    const urls = ["wss://relay1.example.com", "wss://relay2.example.com"];
    const filters: Filter = { kinds: [1] };

    const spy = subscribeSpyTo(pool.req(urls, filters));

    // Verify REQ was sent to both relays
    const req1 = await mockServer1.nextMessage;
    const req2 = await mockServer2.nextMessage;

    // Both messages should be REQ messages with the same filter
    expect(JSON.parse(req1 as string)[0]).toBe("REQ");
    expect(JSON.parse(req2 as string)[0]).toBe("REQ");
    expect(JSON.parse(req1 as string)[2]).toEqual(filters);
    expect(JSON.parse(req2 as string)[2]).toEqual(filters);

    // Send EVENT from first relay
    mockServer1.send(JSON.stringify(["EVENT", JSON.parse(req1 as string)[1], mockEvent]));

    // Send EOSE from both relays
    mockServer1.send(JSON.stringify(["EOSE", JSON.parse(req1 as string)[1]]));
    mockServer2.send(JSON.stringify(["EOSE", JSON.parse(req2 as string)[1]]));

    expect(spy.getValues()).toContainEqual(
      expect.objectContaining({ type: "EVENT", event: expect.objectContaining(mockEvent) }),
    );
  });
});

describe("group failure forwarding", () => {
  const cause = new Error("relay failed");

  function fail(url: string) {
    const relay = pool.relay(url);
    vi.spyOn(relay, RELAY_REQ_LIFECYCLE).mockReturnValue(throwError(() => cause));
  }

  it.each([
    ["request", () => pool.request(["wss://relay1.example.com/"], { kinds: [1] }, { reconnect: false })],
    ["subscription", () => pool.subscription(["wss://relay1.example.com/"], { kinds: [1] }, { reconnect: false })],
    [
      "subscriptionMap",
      () => pool.subscriptionMap({ "wss://relay1.example.com/": { kinds: [1] } }, { reconnect: false }),
    ],
    [
      "outboxSubscription",
      () =>
        pool.outboxSubscription(
          { "wss://relay1.example.com/": [{ pubkey: "pubkey" }] },
          { kinds: [1] },
          { reconnect: false },
        ),
    ],
  ] as const)("forwards RelayGroupError through %s", (_name, run) => {
    fail("wss://relay1.example.com/");
    const spy = subscribeSpyTo(run(), { expectErrors: true });
    const error = spy.getError() as RelayGroupError;
    expect(error).toBeInstanceOf(RelayGroupError);
    expect(error.errors[0]).toBe(cause);
    expect(error.outcomes["wss://relay1.example.com/"]).toEqual({ ok: false, error: cause });
  });

  it("subscriptionMap replaces its active cohort before aggregate settlement", () => {
    fail("wss://relay1.example.com/");
    const maps = new BehaviorSubject({ "wss://relay2.example.com/": { kinds: [1] } });
    const pending = pool.relay("wss://relay2.example.com/");
    vi.spyOn(pending, RELAY_REQ_LIFECYCLE).mockReturnValue(new BehaviorSubject<any>({ type: "OPEN", from: pending.url, id: "x", filters: [] }));
    const spy = subscribeSpyTo(pool.subscriptionMap(maps), { expectErrors: true });
    maps.next({ "wss://relay1.example.com/": { kinds: [1] } });
    expect(spy.getError()).toBeInstanceOf(RelayGroupError);
  });
});

describe("event", () => {
  it("should publish to multiple relays", async () => {
    const urls = ["wss://relay1.example.com/", "wss://relay2.example.com/"];

    const spy = subscribeSpyTo(pool.event(urls, mockEvent));

    // Verify EVENT was sent to both relays
    const event1 = await mockServer1.nextMessage;
    const event2 = await mockServer2.nextMessage;

    expect(JSON.parse(event1 as string)).toEqual(["EVENT", mockEvent]);
    expect(JSON.parse(event2 as string)).toEqual(["EVENT", mockEvent]);

    // Send OK responses from both relays
    mockServer1.send(JSON.stringify(["OK", mockEvent.id, true, ""]));
    mockServer2.send(JSON.stringify(["OK", mockEvent.id, true, ""]));

    expect(spy.getValues()).toEqual([
      { ok: true, from: "wss://relay1.example.com/", message: "" },
      { ok: true, from: "wss://relay2.example.com/", message: "" },
    ]);
  });
});

describe("waitForAuth pass-through", () => {
  const pubkeys = ["pubkey-a", "pubkey-b"];
  const urls = ["wss://relay1.example.com"];

  it("should pass waitForAuth pubkeys to relay.req for subscription", () => {
    const relay = pool.relay(urls[0]);
    const req = vi.spyOn(relay, RELAY_REQ_LIFECYCLE);

    subscribeSpyTo(pool.subscription(urls, { kinds: [1059] }, { waitForAuth: pubkeys }));

    expect(req.mock.calls[0][1]).toEqual(expect.objectContaining({ waitForAuth: pubkeys }));
  });

  it("should pass waitForAuth pubkeys to relay.req for request", () => {
    const relay = pool.relay(urls[0]);
    const req = vi.spyOn(relay, RELAY_REQ_LIFECYCLE);

    subscribeSpyTo(pool.request(urls, { kinds: [1059] }, { waitForAuth: pubkeys }), { expectErrors: true });

    expect(req.mock.calls[0][1]).toEqual(expect.objectContaining({ waitForAuth: pubkeys }));
  });

  it("should pass waitForAuth pubkeys to relay.publish", () => {
    const relay = pool.relay(urls[0]);
    const publish = vi.spyOn(relay, "publish");

    pool.publish(urls, mockEvent, { waitForAuth: pubkeys }).catch(() => {});

    expect(publish).toHaveBeenCalledWith(mockEvent, expect.objectContaining({ waitForAuth: pubkeys }));
  });

  it("should call relay.event without policy options", () => {
    const relay = pool.relay(urls[0]);
    const event = vi.spyOn(relay, "event");

    subscribeSpyTo(pool.event(urls, mockEvent));

    expect(event).toHaveBeenCalledWith(mockEvent);
  });

  it("should pass waitForAuth pubkeys to relay.count", () => {
    const relay = pool.relay(urls[0]);
    const count = vi.spyOn(relay, "count");

    subscribeSpyTo(pool.count(urls, { kinds: [1059] }, "count1", { waitForAuth: pubkeys }), { expectErrors: true });

    expect(count).toHaveBeenCalledWith({ kinds: [1059] }, "count1", expect.objectContaining({ waitForAuth: pubkeys }));
  });
});

// 13-07: pass-through of the four RelayAuthOptions fields (waitForAuth/onAuthRequired/authTimeout/
// authRetries) through the pool's own method surface, including publish and sync, confirming the options
// survive the extra pool-to-group hop (RAUTH-07's pool leg). Table-driven (D-20) so a newly added pool
// operation cannot silently skip the check.
describe("auth options pass-through (13-07)", () => {
  const urls = ["wss://relay1.example.com"];
  const authOptions = () => ({
    waitForAuth: ["pubkey-a"],
    onAuthRequired: vi.fn(),
    authTimeout: 1234,
    authRetries: 3,
  });

  const cases: Array<[string, (opts: ReturnType<typeof authOptions>) => void | Promise<void>]> = [
    [
      "req",
      (opts) => {
        const relay = pool.relay(urls[0]);
        const spy = vi.spyOn(relay, "req");
        pool.req(urls, { kinds: [1] }, opts).subscribe();
        expect(spy.mock.calls[0][1]).toEqual(expect.objectContaining(opts));
      },
    ],
    [
      "request",
      (opts) => {
        const relay = pool.relay(urls[0]);
        const spy = vi.spyOn(relay, RELAY_REQ_LIFECYCLE);
        pool.request(urls, { kinds: [1] }, opts).subscribe({ error: () => {} });
        expect(spy.mock.calls[0][1]).toEqual(expect.objectContaining(opts));
      },
    ],
    [
      "subscription",
      (opts) => {
        const relay = pool.relay(urls[0]);
        const spy = vi.spyOn(relay, RELAY_REQ_LIFECYCLE);
        pool.subscription(urls, { kinds: [1] }, opts).subscribe();
        expect(spy).toHaveBeenCalledWith({ kinds: [1] }, expect.objectContaining(opts));
      },
    ],
    [
      "count",
      (opts) => {
        const relay = pool.relay(urls[0]);
        const spy = vi.spyOn(relay, "count");
        pool.count(urls, { kinds: [1] }, "id1", opts).subscribe({ error: () => {} });
        expect(spy).toHaveBeenCalledWith({ kinds: [1] }, "id1", expect.objectContaining(opts));
      },
    ],
    [
      "publish",
      async (opts) => {
        const relay = pool.relay(urls[0]);
        const spy = vi.spyOn(relay, "publish").mockResolvedValue({ ok: true, from: urls[0] });
        await pool.publish(urls, mockEvent, opts);
        expect(spy).toHaveBeenCalledWith(mockEvent, expect.objectContaining(opts));
      },
    ],
    [
      "sync",
      async (opts) => {
        const relay = pool.relay(urls[0]);
        vi.spyOn(relay, "getSupported").mockResolvedValue([77]);
        const spy = vi.spyOn(relay, "sync").mockReturnValue(of());

        await lastValueFrom(pool.sync(urls, [], { kinds: [1] }, undefined, opts), { defaultValue: null });

        expect(spy).toHaveBeenCalledWith([], { kinds: [1] }, undefined, expect.objectContaining(opts));
      },
    ],
  ];

  it.each(cases)(
    "passes waitForAuth/onAuthRequired/authTimeout/authRetries through pool.%s to the relay layer",
    async (_name, run) => {
      await run(authOptions());
    },
  );
});

// RAUTH-08: SyncLoader itself (packages/loaders) already proves its own threading end to end against a
// mocked pool (13-03-SUMMARY.md). What that leaves unproven is the pool's OWN leg of the hop — that
// pool.sync/pool.request genuinely forward the caller's auth options down to `pool.relay(url).sync(...)`
// and `pool.relay(url).request(...)`, which is what a real RelayPool-backed SyncLoader depends on.
// Driving an actual `createSyncLoader` here would require adding `applesauce-loaders` as a new
// cross-package devDependency of `applesauce-relay` for a single test — per the plan's own fallback
// clause this asserts at the pool.sync/pool.request boundary instead (see 13-07-SUMMARY.md).
describe("RAUTH-08 pool boundary threading (13-07)", () => {
  it("threads onAuthRequired/authTimeout/authRetries through pool.sync and pool.request to the relay layer", async () => {
    const urls = ["wss://relay1.example.com"];
    const relay = pool.relay(urls[0]);

    vi.spyOn(relay, "getSupported").mockResolvedValue([77]);
    const syncSpy = vi.spyOn(relay, "sync").mockReturnValue(of());
    const reqSpy = vi.spyOn(relay, RELAY_REQ_LIFECYCLE);

    const onAuthRequired = vi.fn();
    const authOptions = { onAuthRequired, authTimeout: 5_000, authRetries: 2 };

    await lastValueFrom(pool.sync(urls, [], { kinds: [1] }, undefined, authOptions), { defaultValue: null });
    pool.request(urls, { kinds: [1] }, authOptions).subscribe({ error: () => {} });

    expect(syncSpy).toHaveBeenCalledWith([], { kinds: [1] }, undefined, expect.objectContaining(authOptions));
    expect(reqSpy.mock.calls[0][1]).toEqual(expect.objectContaining(authOptions));
  });
});

describe("sync and raw negentropy surface", () => {
  it("forwards Group sync values and attributed failures unchanged", async () => {
    const urls = ["wss://relay1.example.com", "wss://relay2.example.com"];
    const first = pool.relay(urls[0]);
    const second = pool.relay(urls[1]);
    const received = { type: "received" as const, from: "wss://relay1.example.com/", event: mockEvent };
    const cause = new Error("second failed");
    vi.spyOn(first, "getSupported").mockResolvedValue([77]);
    vi.spyOn(second, "getSupported").mockResolvedValue([77]);
    vi.spyOn(first, "sync").mockReturnValue(of(received));
    vi.spyOn(second, "sync").mockReturnValue(throwError(() => cause));

    const messages = await lastValueFrom(pool.sync(urls, [], {}).pipe(toArray()));

    expect(messages).toContain(received);
    expect(messages).toContainEqual({ type: "relay-failed", from: "wss://relay2.example.com/", error: cause });
  });

  it("removes raw multi-relay negentropy from Group and Pool", () => {
    expect((pool as any).negentropy).toBeUndefined();
    expect((pool.group([]) as any).negentropy).toBeUndefined();
  });
});
