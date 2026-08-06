import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { NostrEvent } from "applesauce-core/helpers/event";
import { lastValueFrom, of, throwError, toArray } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WS } from "vitest-websocket-mock";

import { RelayGroup } from "../group.js";
import { Relay } from "../relay.js";
import { FakeUser } from "./fake-user.js";

let mockRelay1: WS;
let mockRelay2: WS;
let relay1: Relay;
let relay2: Relay;
let group: RelayGroup;
let mockEvent: NostrEvent;

beforeEach(async () => {
  // Create mock relays
  mockRelay1 = new WS("wss://relay1.test", { jsonProtocol: true });
  mockRelay2 = new WS("wss://relay2.test", { jsonProtocol: true });

  // Mock empty information document
  vi.spyOn(Relay, "fetchInformationDocument").mockImplementation(() => of(null));

  // Create relays
  relay1 = new Relay("wss://relay1.test");
  relay2 = new Relay("wss://relay2.test");

  // Create group
  group = new RelayGroup([relay1, relay2]);

  mockEvent = {
    kind: 1,
    id: "test-id",
    pubkey: "test-pubkey",
    created_at: 1234567890,
    tags: [],
    content: "test content",
    sig: "test-sig",
  };
});

afterEach(async () => {
  mockRelay1.close();
  mockRelay2.close();
  await WS.clean();
});

describe("req", () => {
  it("should make requests to multiple relays", async () => {
    group.req([{ kinds: [1] }], { id: "test-sub" }).subscribe();

    await expect(mockRelay1).toReceiveMessage(["REQ", "test-sub", { kinds: [1] }]);
    await expect(mockRelay2).toReceiveMessage(["REQ", "test-sub", { kinds: [1] }]);
  });

  it("should emit events from all relays", async () => {
    const spy = subscribeSpyTo(group.req([{ kinds: [1] }], { id: "test-sub" }));

    await expect(mockRelay1).toReceiveMessage(["REQ", "test-sub", { kinds: [1] }]);
    await expect(mockRelay2).toReceiveMessage(["REQ", "test-sub", { kinds: [1] }]);

    mockRelay1.send(["EVENT", "test-sub", { ...mockEvent, id: "1" }]);
    mockRelay2.send(["EVENT", "test-sub", { ...mockEvent, id: "2" }]);

    const values = spy.getValues();
    // Should have OPEN messages + 2 EVENT messages
    expect(values.filter((m) => m.type === "EVENT")).toEqual([
      expect.objectContaining({ type: "EVENT", event: expect.objectContaining({ id: "1" }) }),
      expect.objectContaining({ type: "EVENT", event: expect.objectContaining({ id: "2" }) }),
    ]);
  });

  it("should emit EOSE from each relay", async () => {
    const spy = subscribeSpyTo(group.req([{ kinds: [1] }], { id: "test-sub" }));

    mockRelay1.send(["EOSE", "test-sub"]);
    expect(spy.getValues().filter((m) => m.type === "EOSE")).toHaveLength(1);

    mockRelay2.send(["EOSE", "test-sub"]);
    expect(spy.getValues().filter((m) => m.type === "EOSE")).toHaveLength(2);
  });

  it("should ignore relays that have an error", async () => {
    const spy = subscribeSpyTo(group.req([{ kinds: [1] }], { id: "test-sub" }));

    mockRelay1.error();
    mockRelay2.send(["EVENT", "test-sub", mockEvent]);
    mockRelay2.send(["EOSE", "test-sub"]);

    const values = spy.getValues();
    expect(values.filter((m) => m.type === "EVENT")).toEqual([
      expect.objectContaining({ type: "EVENT", event: expect.objectContaining(mockEvent) }),
    ]);
    expect(values.filter((m) => m.type === "ERROR")).toHaveLength(1);
    expect(values.filter((m) => m.type === "EOSE")).toHaveLength(1);
  });

  it("should emit ERROR if all relays error", async () => {
    const spy = subscribeSpyTo(group.req([{ kinds: [1] }], { id: "test-sub" }));

    mockRelay1.error();
    mockRelay2.error();

    const values = spy.getValues();
    expect(values.filter((m) => m.type === "ERROR")).toHaveLength(2);
  });

  it("should still pass events to subscription when one relay is offline", async () => {
    // Close one relay to simulate it being offline
    mockRelay1.close();

    // Make the request
    const spy = subscribeSpyTo(group.req([{ kinds: [1] }], { id: "test-sub" }));

    // Send event from the remaining online relay
    mockRelay2.send(["EVENT", "test-sub", mockEvent]);
    mockRelay2.send(["EOSE", "test-sub"]);

    // When one relay is offline, events still flow from online relays
    const values = spy.getValues();
    expect(values.filter((m) => m.type === "EVENT")).toEqual([
      expect.objectContaining({ type: "EVENT", event: expect.objectContaining(mockEvent) }),
    ]);
  });
});

describe("event", () => {
  it("should send EVENT to all relays in the group", async () => {
    group.event(mockEvent).subscribe();

    await expect(mockRelay1).toReceiveMessage(["EVENT", mockEvent]);
    await expect(mockRelay2).toReceiveMessage(["EVENT", mockEvent]);
  });

  it("should emit OK messages from all relays", async () => {
    const spy = subscribeSpyTo(group.event(mockEvent));

    mockRelay1.send(["OK", mockEvent.id, true, ""]);
    mockRelay2.send(["OK", mockEvent.id, true, ""]);

    expect(spy.getValues()).toEqual([
      expect.objectContaining({ ok: true, from: "wss://relay1.test", message: "" }),
      expect.objectContaining({ ok: true, from: "wss://relay2.test", message: "" }),
    ]);
  });

  it("should complete when all relays have sent OK messages", async () => {
    const spy = subscribeSpyTo(group.event(mockEvent));

    mockRelay1.send(["OK", mockEvent.id, true, ""]);
    expect(spy.receivedComplete()).toBe(false);

    mockRelay2.send(["OK", mockEvent.id, true, ""]);
    console.log("last value");
    expect(spy.receivedComplete()).toBe(true);
  });

  it("should handle relay errors and still complete", async () => {
    const spy = subscribeSpyTo(group.event(mockEvent));

    mockRelay1.error();
    mockRelay2.send(["OK", mockEvent.id, true, ""]);

    expect(spy.getValues()).toEqual([
      expect.objectContaining({ ok: false, from: "wss://relay1.test", message: "Unknown error" }),
      expect.objectContaining({ ok: true, from: "wss://relay2.test", message: "" }),
    ]);
    expect(spy.receivedComplete()).toBe(true);
  });

  it("D-18: a failed group publish carries the original error object alongside the message", async () => {
    const spy = subscribeSpyTo(group.event(mockEvent));

    mockRelay1.error();
    mockRelay2.send(["OK", mockEvent.id, true, ""]);

    const values = spy.getValues();
    const failed = values.find((v) => v.from === "wss://relay1.test");
    expect(failed).toMatchObject({ ok: false, from: "wss://relay1.test", message: "Unknown error" });
    expect(failed?.error).toBeDefined();

    const succeeded = values.find((v) => v.from === "wss://relay2.test");
    expect(succeeded).toMatchObject({ ok: true, from: "wss://relay2.test", message: "" });
    expect(succeeded?.error).toBeUndefined();
  });
});

// 13-07: pass-through of the four RelayAuthOptions fields (waitForAuth/onAuthRequired/authTimeout/
// authRetries) through every group operation to the underlying relay method. Table-driven (D-20) so a
// newly added group operation cannot silently skip the check the way RelayGroup.sync/RelayPool.sync did
// before this plan (RESEARCH Pitfall 4).
describe("auth options pass-through (13-07)", () => {
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
        const spy = vi.spyOn(relay1, "req");
        group.req([{ kinds: [1] }], opts).subscribe();
        expect(spy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining(opts));
      },
    ],
    [
      "request",
      (opts) => {
        const spy = vi.spyOn(relay1, "req");
        group.request([{ kinds: [1] }], opts).subscribe({ error: () => {} });
        expect(spy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining(opts));
      },
    ],
    [
      "subscription",
      (opts) => {
        const spy = vi.spyOn(relay1, "req");
        group.subscription([{ kinds: [1] }], opts).subscribe();
        expect(spy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining(opts));
      },
    ],
    [
      "count",
      (opts) => {
        const spy = vi.spyOn(relay1, "count");
        group.count([{ kinds: [1] }], "id1", opts).subscribe({ error: () => {} });
        expect(spy).toHaveBeenCalledWith(expect.anything(), "id1", expect.objectContaining(opts));
      },
    ],
    [
      "event",
      (opts) => {
        const spy = vi.spyOn(relay1, "event");
        group.event(mockEvent, opts).subscribe();
        expect(spy).toHaveBeenCalledWith(mockEvent, "EVENT", expect.objectContaining(opts));
      },
    ],
    [
      "sync",
      async (opts) => {
        vi.spyOn(relay1, "getSupported").mockResolvedValue([77]);
        vi.spyOn(relay2, "getSupported").mockResolvedValue([77]);
        const spy = vi.spyOn(relay1, "sync").mockReturnValue(of());
        vi.spyOn(relay2, "sync").mockReturnValue(of());

        await lastValueFrom(group.sync([], { kinds: [1] }, undefined, opts), { defaultValue: null });

        expect(spy).toHaveBeenCalledWith([], { kinds: [1] }, undefined, expect.objectContaining(opts));
      },
    ],
    [
      "negentropy",
      async (opts) => {
        vi.spyOn(relay1, "getSupported").mockResolvedValue([77]);
        vi.spyOn(relay2, "getSupported").mockResolvedValue([77]);
        const spy = vi.spyOn(relay1, "negentropy").mockResolvedValue(true);
        vi.spyOn(relay2, "negentropy").mockResolvedValue(true);

        const negentropyOpts = { ...opts, parallel: true as const };
        await group.negentropy({} as any, { kinds: [1] }, async () => {}, negentropyOpts);

        expect(spy).toHaveBeenCalledWith(
          expect.anything(),
          { kinds: [1] },
          expect.anything(),
          expect.objectContaining(opts),
        );
      },
    ],
  ];

  it.each(cases)(
    "passes waitForAuth/onAuthRequired/authTimeout/authRetries through group.%s to the underlying relay method",
    async (_name, run) => {
      await run(authOptions());
    },
  );
});

describe("RAUTH-05 group-level auth independence (13-07)", () => {
  it("each relay in the group invokes its own handler independently, and a rejecting handler for one relay does not affect the other", async () => {
    const userB = new FakeUser();
    const handlerA = vi.fn().mockRejectedValue(new Error("nope"));
    const handlerB = vi.fn(async () => {
      await relay2.authenticate(userB);
    });

    const spy = subscribeSpyTo(
      group.req([{ kinds: [1] }], {
        id: "sub1",
        onAuthRequired: (context) => (context.relay === relay1 ? handlerA() : handlerB()),
      }),
      { expectErrors: true },
    );

    await expect(mockRelay1).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
    await expect(mockRelay2).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);

    mockRelay1.send(["AUTH", "challenge-1"]);
    mockRelay2.send(["AUTH", "challenge-2"]);
    mockRelay1.send(["CLOSED", "sub1", "auth-required: need to authenticate"]);
    mockRelay2.send(["CLOSED", "sub1", "auth-required: need to authenticate"]);

    // relay2's handler authenticates and its REQ resends
    const authMsg = (await mockRelay2.nextMessage) as [string, NostrEvent];
    expect(authMsg[0]).toBe("AUTH");
    mockRelay2.send(["OK", authMsg[1].id, true, ""]);

    await expect(mockRelay2).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);

    // Give relay1's rejected handler a tick to settle into an ERROR message
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).toHaveBeenCalledTimes(1);

    // relay1's handler rejection surfaces as an ERROR message for relay1 only — it does not stop
    // relay2's independent auth/retry flow
    const values = spy.getValues();
    expect(values.some((m) => m.type === "ERROR" && m.from === "wss://relay1.test")).toBe(true);

    spy.unsubscribe();
  });
});

describe("D-19: RelayGroup.sync per-relay isolation (13-07)", () => {
  it("one relay's sync failure does not stop another relay's events, and the group sync still completes", async () => {
    vi.spyOn(relay1, "getSupported").mockResolvedValue([77]);
    vi.spyOn(relay2, "getSupported").mockResolvedValue([77]);
    vi.spyOn(relay1, "sync").mockReturnValue(throwError(() => new Error("relay1 sync failed")));
    vi.spyOn(relay2, "sync").mockReturnValue(of(mockEvent));

    const events = await lastValueFrom(group.sync([], { kinds: [1] }).pipe(toArray()));

    expect(events).toEqual([mockEvent]);
  });
});

describe("RAUTH-09: group status$ surfaces informational auth-required flags (13-07)", () => {
  it("authRequiredForRead flips true on the affected relay's entry in group.status$", async () => {
    const spy = subscribeSpyTo(group.status$);

    group.req([{ kinds: [1] }], { id: "sub1", onAuthRequired: vi.fn() }).subscribe({ error: () => {} });

    await expect(mockRelay1).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
    mockRelay1.send(["CLOSED", "sub1", "auth-required: need to authenticate"]);

    await new Promise((resolve) => setTimeout(resolve, 20));

    const last = spy.getLastValue()!;
    expect(last["wss://relay1.test"]?.authRequiredForRead).toBe(true);

    spy.unsubscribe();
  });
});

describe("count", () => {
  it("CR-03 downstream (13-10): RelayGroup.count's combineLatest still emits for a relay whose count survives an auth round-trip", async () => {
    // waitForAuth: [] + a synchronous handler drives relay1's resubscribe from inside the very
    // CLOSED dispatch that delivered auth-required — the exact CR-03 reentrancy case. Before 13-10,
    // relay1's count() completed with zero values under this scenario, so combineLatest would never
    // emit a combined record for the group at all (one relay completing empty suppresses the whole
    // group result).
    const onAuthRequired = vi.fn();

    const spy = subscribeSpyTo(group.count([{ kinds: [1] }], "count1", { onAuthRequired, waitForAuth: [] }));

    await expect(mockRelay1).toReceiveMessage(["COUNT", "count1", { kinds: [1] }]);
    await expect(mockRelay2).toReceiveMessage(["COUNT", "count1", { kinds: [1] }]);

    mockRelay1.send(["CLOSED", "count1", "auth-required: need to authenticate"]);

    // The resend must reach a live listen chain, not the pre-13-10 dead one
    await expect(mockRelay1).toReceiveMessage(["COUNT", "count1", { kinds: [1] }]);

    mockRelay1.send(["COUNT", "count1", { count: 3 }]);
    mockRelay2.send(["COUNT", "count1", { count: 5 }]);

    // group.count() stays open (mirrors group.req()/group.subscription(): the group's own relays$
    // never completes, so switchMap's output never completes either) — assert the combined value
    // arrives instead of waiting for a completion that structurally never happens.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(spy.getValues()).toEqual([{ "wss://relay1.test": { count: 3 }, "wss://relay2.test": { count: 5 } }]);
    expect(onAuthRequired).toHaveBeenCalledTimes(1);

    spy.unsubscribe();
  });
});
