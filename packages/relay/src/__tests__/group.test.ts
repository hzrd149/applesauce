import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { NostrEvent } from "applesauce-core/helpers/event";
import { lastValueFrom, of, throwError, toArray } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WS } from "vitest-websocket-mock";

import { RelayGroup, RelayGroupError } from "../group.js";
import { AUTH_PHASE_GATE, AuthPhaseGate } from "../operators/auth-retry.js";
import {
  AuthRequiredError,
  Relay,
  RelayAuthChallengeChangedError,
  RelayAuthChallengeTimeoutError,
} from "../relay.js";
import { withDebugCapture } from "./debug-capture.js";
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
        expect(spy.mock.calls[0][1]).toEqual(expect.objectContaining(opts));
      },
    ],
    [
      "request",
      (opts) => {
        const spy = vi.spyOn(relay1, "reqLifecycle");
        group.request([{ kinds: [1] }], opts).subscribe({ error: () => {} });
        expect(spy.mock.calls[0][1]).toEqual(expect.objectContaining(opts));
      },
    ],
    [
      "subscription",
      (opts) => {
        const spy = vi.spyOn(relay1, "reqLifecycle");
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

  it("keeps group.event raw while group.publish owns policy options", async () => {
    const event = vi.spyOn(relay1, "event");
    group.event(mockEvent).subscribe();
    expect(event).toHaveBeenCalledWith(mockEvent);

    const opts = authOptions();
    const publish = vi.spyOn(relay1, "publish").mockResolvedValue({ ok: true, from: relay1.url });
    vi.spyOn(relay2, "publish").mockResolvedValue({ ok: true, from: relay2.url });
    await group.publish(mockEvent, opts);
    expect(publish).toHaveBeenCalledWith(mockEvent, expect.objectContaining(opts));
  });
});

describe("RAUTH-05 group-level auth independence (13-07)", () => {
  it("each relay in the group invokes its own handler independently, and a rejecting handler for one relay does not affect the other", async () => {
    const userB = new FakeUser();
    const handlerA = vi.fn().mockRejectedValue(new Error("nope"));
    const handlerB = vi.fn(async () => {
      await relay2.authenticate(userB);
    });

    const spy = subscribeSpyTo(
      group.subscription([{ kinds: [1] }], {
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

    // relay1's terminal outcome does not stop relay2's independent auth/retry flow.
    expect(spy.receivedError()).toBe(false);

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

describe("dropped-relay diagnostics (14-03): human prose names the failure class", () => {
  // RelayGroup's own logger namespace (logger.extend("RelayGroup") in group.ts) — this line is fan-out
  // health, not per-connection auth state, so it deliberately stays off Relay's :auth sub-namespace.
  const NAMESPACE = "applesauce:RelayGroup";

  it("an auth-family failure names the auth error class in the dropped-relay line, and the surviving relay's events still reach the subscriber", async () => {
    vi.spyOn(relay1, "getSupported").mockResolvedValue([77]);
    vi.spyOn(relay2, "getSupported").mockResolvedValue([77]);
    // Script a real NIP-42 auth-family failure via the pinned AuthRequiredError class (not a plain Error).
    vi.spyOn(relay1, "sync").mockReturnValue(
      throwError(() => new AuthRequiredError("auth-required: need to authenticate")),
    );
    vi.spyOn(relay2, "sync").mockReturnValue(of(mockEvent));

    await withDebugCapture(NAMESPACE, async (lines) => {
      const events = await lastValueFrom(group.sync([], { kinds: [1] }).pipe(toArray()));
      // Surviving relay's events still reach the subscriber despite relay1 being dropped.
      expect(events).toEqual([mockEvent]);

      const droppedLines = lines().filter((l) => l.includes(relay1.url));
      expect(droppedLines).toHaveLength(1);
      // Phrasing derived from the scripted scenario (an auth-family error was thrown), not copied from
      // the implementation's template string. NOTE: `AuthRequiredError.name` alone is NOT a sufficient
      // assertion here — the raw error object is deliberately still passed as the log call's trailing
      // argument (so the stack trace stays available), and `util.format`'s rendering of that argument
      // includes the class name via the Error's own `toString()` regardless of whether the prose names
      // it. Asserting the "auth failure" phrase is the non-vacuous signal that the prose itself, not
      // just the trailing raw-error dump, tells the operator this was an auth failure.
      expect(droppedLines[0].toLowerCase()).toContain("auth failure");
    });
  });

  it.each([new RelayAuthChallengeTimeoutError("wss://relay1.test"), new RelayAuthChallengeChangedError("wss://relay1.test")])(
    "classifies actual terminal %s instances as auth failures",
    async (failure) => {
      vi.spyOn(relay1, "getSupported").mockResolvedValue([77]);
      vi.spyOn(relay2, "getSupported").mockResolvedValue([77]);
      vi.spyOn(relay1, "sync").mockReturnValue(throwError(() => failure));
      vi.spyOn(relay2, "sync").mockReturnValue(of(mockEvent));

      await withDebugCapture(NAMESPACE, async (lines) => {
        await lastValueFrom(group.sync([], { kinds: [1] }).pipe(toArray()));
        expect(lines().find((line) => line.includes(relay1.url))?.toLowerCase()).toContain("auth failure");
      });
    },
  );

  it("an ordinary connection error is NOT reported as an auth failure, proving the two classes are distinguishable from output alone", async () => {
    vi.spyOn(relay1, "getSupported").mockResolvedValue([77]);
    vi.spyOn(relay2, "getSupported").mockResolvedValue([77]);
    vi.spyOn(relay1, "sync").mockReturnValue(throwError(() => new Error("connection reset by peer")));
    vi.spyOn(relay2, "sync").mockReturnValue(of(mockEvent));

    await withDebugCapture(NAMESPACE, async (lines) => {
      await lastValueFrom(group.sync([], { kinds: [1] }).pipe(toArray()));

      const droppedLines = lines().filter((l) => l.includes(relay1.url));
      expect(droppedLines).toHaveLength(1);
      expect(droppedLines[0]).not.toContain(AuthRequiredError.name);
      expect(droppedLines[0].toLowerCase()).not.toContain("auth failure");
    });
  });
});

describe("RAUTH-09: group status$ surfaces informational auth-required flags (13-07)", () => {
  it("authRequiredForRead flips true on the affected relay's entry in group.status$", async () => {
    const spy = subscribeSpyTo(group.status$);

    group.req([{ kinds: [1] }], { id: "sub1" }).subscribe({ error: () => {} });

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

// 13-11: WR-02 gap closure. RelayGroup.request() (the group's most-used read API) is the one path in
// the phase that never received D-15's operation-clock suspension — it called relay.req() without
// threading an AuthPhaseGate and kept a bare timeout() instead of suspendableTimeout. These tests build
// on real Relay instances against vitest-websocket-mock (not mocked relay objects), per the plan's
// explicit instruction, since only something that actually emits can catch a behavioural gap.
describe("request() operation clock gap closure (13-11, WR-02)", () => {
  it("threads one shared AuthPhaseGate instance into every relay's req() call", async () => {
    const spy1 = vi.spyOn(relay1, "reqLifecycle");
    const spy2 = vi.spyOn(relay2, "reqLifecycle");

    group.request([{ kinds: [1] }], { id: "greq1" }).subscribe({ error: () => {} });

    await expect(mockRelay1).toReceiveMessage(["REQ", "greq1", { kinds: [1] }]);
    await expect(mockRelay2).toReceiveMessage(["REQ", "greq1", { kinds: [1] }]);

    expect(spy1).toHaveBeenCalledTimes(1);
    expect(spy2).toHaveBeenCalledTimes(1);

    const gate1 = spy1.mock.calls[0]?.[2];
    const gate2 = spy2.mock.calls[0]?.[2];

    // Presence alone is weaker than instance identity — assert both, per the plan's explicit instruction.
    expect(gate1).toBeInstanceOf(AuthPhaseGate);
    expect(gate2).toBeInstanceOf(AuthPhaseGate);
    expect(gate1).toBe(gate2);
  });

  it("D-15: request()'s group-level operation clock is suspended across a relay's auth phase", async () => {
    // Single-relay group so the test is not entangled with relay2's independent REQ/EOSE lifecycle.
    const soloGroup = new RelayGroup([relay1]);

    // Non-vacuity (D-20): the auth phase duration (80ms) deliberately EXCEEDS the group request's own
    // timeout (40ms) so the two are unambiguously ordered on real timers — without gate suspension the
    // 40ms clock fires and errors long before the 80ms auth round trip ever resolves, so the request can
    // only survive because the group's clock is paused for the whole auth phase and resumes with its
    // remaining budget once it closes. Verified by temporarily substituting a fresh, never-opened
    // AuthPhaseGate into group.ts's suspendableTimeout call (so the clock is never actually suspended):
    // this test went RED (timed out waiting for spy.onComplete()) against that substitution, and GREEN
    // again once the real threaded gate was restored — recorded in the plan SUMMARY.
    const onAuthRequired = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      relay1.authenticationResponse$.next({ ok: true, from: "wss://relay1.test" });
    });

    const spy = subscribeSpyTo(soloGroup.request([{ kinds: [1] }], { id: "greq2", timeout: 40, onAuthRequired }));

    await expect(mockRelay1).toReceiveMessage(["REQ", "greq2", { kinds: [1] }]);
    mockRelay1.send(["CLOSED", "greq2", "auth-required: need to authenticate"]);

    await expect(mockRelay1).toReceiveMessage(["REQ", "greq2", { kinds: [1] }]);

    mockRelay1.send(["EVENT", "greq2", mockEvent]);
    mockRelay1.send(["EOSE", "greq2"]);

    await spy.onComplete();

    expect(spy.getValues()).toEqual([expect.objectContaining(mockEvent)]);
    expect(spy.receivedError()).toBe(false);
  });

  it("WR-02: request()'s group-level operation clock fires against a relay that accepts the REQ and then says nothing at all", async () => {
    // No auth involved here at all — a relay that answers the REQ with total silence (no EVENT, no
    // EOSE, no CLOSED). Mirrors relay.test.ts's identically-named `request()` clock-fires test (13-09)
    // and is the group analog: it proves the bare-timeout-to-suspendableTimeout swap did not simply
    // move one unfireable clock to another. Against pre-fix code (a bare timeout({first}) cancelled by
    // req()'s synthetic OPEN message), this reaches its assertion window with no error and fails.
    const soloGroup = new RelayGroup([relay1]);

    const spy = subscribeSpyTo(soloGroup.request([{ kinds: [1] }], { id: "greq3", timeout: 40 }), {
      expectErrors: true,
    });

    await expect(mockRelay1).toReceiveMessage(["REQ", "greq3", { kinds: [1] }]);
    // Deliberately send nothing back.

    await spy.onError();

    expect(spy.getError()).toBeInstanceOf(Error);
    expect(spy.receivedComplete()).toBe(false);
  });
});

// 13-14: CR-02 gap closure. RelayGroup.request()'s firstWhen cast away GroupReqErrorMessage, so
// isReqProgress accepted the group's own per-relay ERROR bookkeeping value as progress and permanently
// cancelled the operation clock. These sit beside the 13-11 tests above and follow the same construction
// (real Relay instances against vitest-websocket-mock).
describe("request() CR-02 gap closure — the group's own ERROR bookkeeping must not satisfy the clock", () => {
  it("CR-02: errors on the declared timeout instead of hanging when one relay errors and the other falls silent", async () => {
    // reconnect: false so relay1's connection error surfaces to the group's own ERROR bookkeeping
    // immediately, rather than first working through relay.req()'s own (unrelated) connection-retry
    // backoff — isolates the CR-02 property (does ERROR satisfy the clock's firstWhen gate) from
    // relay-level reconnect timing, which is not this test's concern.
    const spy = subscribeSpyTo(group.request([{ kinds: [1] }], { id: "greq6", timeout: 100, reconnect: false }), {
      expectErrors: true,
    });

    await expect(mockRelay1).toReceiveMessage(["REQ", "greq6", { kinds: [1] }]);
    await expect(mockRelay2).toReceiveMessage(["REQ", "greq6", { kinds: [1] }]);

    // relay1's socket errors: the group manufactures its own ERROR bookkeeping value for it — not progress
    mockRelay1.error();
    // relay2 accepted the REQ (synthetic OPEN, also not progress) but says nothing else at all

    await spy.onError();

    expect(spy.getError()).toBeInstanceOf(Error);
    expect(spy.receivedComplete()).toBe(false);
  });

  it("a real EVENT is delivered but does not cancel the whole-operation clock", async () => {
    const spy = subscribeSpyTo(group.request([{ kinds: [1] }], { id: "greq7", timeout: 100, reconnect: false }), {
      expectErrors: true,
    });

    await expect(mockRelay1).toReceiveMessage(["REQ", "greq7", { kinds: [1] }]);
    await expect(mockRelay2).toReceiveMessage(["REQ", "greq7", { kinds: [1] }]);

    // relay1's socket errors: group bookkeeping ERROR, not progress
    mockRelay1.error();
    // relay2 delivers a genuine EVENT before the deadline; whole-lifetime timing does not reset on activity.
    mockRelay2.send(["EVENT", "greq7", mockEvent]);

    // Wait past the budget and retain proof that the earlier event was delivered before the timeout.
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(spy.getValues()).toEqual([expect.objectContaining(mockEvent)]);
    expect(spy.receivedError()).toBe(true);
    expect(spy.getError()).not.toBeInstanceOf(RelayGroupError);
  });
});
