import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { Filter, getSeenRelays, NostrEvent } from "applesauce-core/helpers";
import { firstValueFrom, of, Subject, throwError, timer } from "rxjs";
import { filter, repeat, retry } from "rxjs/operators";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WS } from "vitest-websocket-mock";

import { Negentropy, NegentropyStorageVector } from "../lib/negentropy.js";
import { AuthHandlerError, AuthRequiredError, AuthTimeoutError, Relay, RelayClosedError, SyncDirection } from "../relay.js";
import { RelayInformation } from "../types";
import { FakeUser } from "./fake-user.js";

const defaultMockInfo: RelayInformation = {
  name: "Test Relay",
  description: "Test Relay Description",
  pubkey: "testpubkey",
  contact: "test@example.com",
  supported_nips: [1, 2, 3],
  software: "test-software",
  version: "1.0.0",
};
let server: WS;
let relay: Relay;

beforeEach(async () => {
  // Mock empty information document
  vi.spyOn(Relay, "fetchInformationDocument").mockImplementation(() => of(null));

  // Create mock relay
  server = new WS("wss://test", { jsonProtocol: true });

  // Create relay
  relay = new Relay("wss://test");
  relay.keepAlive = 0;
});

// Wait for server to close to prevent memory leaks
afterEach(async () => {
  await WS.clean();
  if (vi.isFakeTimers()) vi.clearAllTimers();
  vi.clearAllMocks();
  vi.useRealTimers();
});

const mockEvent: NostrEvent = {
  kind: 1,
  id: "00007641c9c3e65a71843933a44a18060c7c267a4f9169efa3735ece45c8f621",
  pubkey: "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
  created_at: 1743712795,
  tags: [["nonce", "13835058055282167643", "16"]],
  content: "This is just stupid: https://codestr.fiatjaf.com/",
  sig: "5a57b5a12bba4b7cf0121077b1421cf4df402c5c221376c076204fc4f7519e28ce6508f26ddc132c406ccfe6e62cc6db857b96c788565cdca9674fe9a0710ac2",
};

describe("constructor", () => {
  it("should default request and subscription reconnect to 3 retries", () => {
    expect(relay.subscriptionReconnect.count).toBe(3);
    expect(relay.requestReconnect.count).toBe(3);
  });

  it("should support numeric request and subscription reconnect options", () => {
    const custom = new Relay("wss://test", { requestReconnect: 2, subscriptionReconnect: 5 });

    expect(custom.requestReconnect.count).toBe(2);
    expect(custom.requestReconnect.delay).toEqual(relay.requestReconnect.delay);
    expect(custom.requestReconnect.resetOnSuccess).toBe(true);
    expect(custom.subscriptionReconnect.count).toBe(5);
    expect(custom.subscriptionReconnect.delay).toEqual(relay.subscriptionReconnect.delay);
    expect(custom.subscriptionReconnect.resetOnSuccess).toBe(true);
  });
});

describe("req", () => {
  it("should trigger connection to relay", async () => {
    subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1" }));

    // Wait for connection
    await firstValueFrom(relay.connected$.pipe(filter(Boolean)));

    expect(relay.connected).toBe(true);
  });

  it("should send expected messages to relay", async () => {
    subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1" }));

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
  });

  it("should not close the REQ when EOSE is received", async () => {
    // Create subscription that completes after first EOSE
    const sub = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1" }));

    // Verify REQ was sent
    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);

    // Send EOSE to complete subscription
    server.send(["EVENT", "sub1", mockEvent]);
    server.send(["EOSE", "sub1"]);

    // Verify the subscription did not complete
    expect(sub.receivedComplete()).toBe(false);

    expect(sub.getValues()).toEqual([
      expect.objectContaining({ type: "OPEN" }),
      expect.objectContaining({ type: "EVENT", event: expect.objectContaining(mockEvent) }),
      expect.objectContaining({ type: "EOSE" }),
    ]);
  });

  it("should send CLOSE when unsubscribed", async () => {
    // Create subscription that completes after first EOSE
    const sub = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1" }));

    // Verify REQ was sent
    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);

    // Complete the subscription
    sub.unsubscribe();

    // Verify CLOSE was sent
    await expect(server).toReceiveMessage(["CLOSE", "sub1"]);
  });

  it("should close connection when unsubscribed", async () => {
    const sub = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1" }));
    await server.connected;
    sub.unsubscribe();
    await server.closed;
    expect(relay.connected).toBe(false);
  });

  it("should emit nostr event and EOSE", async () => {
    const spy = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1" }));
    await server.connected;

    server.send(["EVENT", "sub1", mockEvent]);
    server.send(["EOSE", "sub1"]);

    expect(spy.getValues()).toEqual([
      expect.objectContaining({ type: "OPEN" }),
      expect.objectContaining({ type: "EVENT", event: expect.objectContaining(mockEvent) }),
      expect.objectContaining({ type: "EOSE" }),
    ]);
  });

  it("should ignore EVENT and EOSE messages that do not match subscription id", async () => {
    const spy = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1" }));
    await server.connected;

    // Send EVENT message with wrong subscription id
    server.send(["EVENT", "wrong_sub", mockEvent]);

    // Send EOSE message with wrong subscription id
    server.send(["EOSE", "wrong_sub"]);

    // Send EVENT message with correct subscription id
    server.send(["EVENT", "sub1", mockEvent]);

    // Send EOSE message with correct subscription id
    server.send(["EOSE", "sub1"]);

    expect(spy.getValues()).toEqual([
      expect.objectContaining({ type: "OPEN" }),
      expect.objectContaining({ type: "EVENT", event: expect.objectContaining(mockEvent) }),
      expect.objectContaining({ type: "EOSE" }),
    ]);
  });

  it("should mark events with their source relay", async () => {
    const spy = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1" }));
    await server.connected;

    // Send EVENT message
    server.send(["EVENT", "sub1", mockEvent]);

    // Get the received EVENT message (index 1, after OPEN)
    const receivedMessage = spy.getValues().find((v) => v.type === "EVENT");

    // Verify the event was marked as seen from this relay
    expect(getSeenRelays(receivedMessage?.event)).toContain("wss://test");
  });

  it("should complete when CLOSED message is received", async () => {
    const spy = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1" }));
    await server.connected;

    // Send CLOSED message for the subscription
    server.send(["CLOSED", "sub1", "reason"]);

    // Verify the subscription completed cleanly (not errored)
    await spy.onComplete();
    expect(spy.receivedComplete()).toBe(true);
    expect(spy.receivedError()).toBe(false);
  });

  it("should resubscribe when relay sends clean CLOSED and resubscribe is enabled", async () => {
    const spy = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1", resubscribe: true }));

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
    server.send(["CLOSED", "sub1", ""]);

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
    expect(spy.receivedComplete()).toBe(false);

    spy.unsubscribe();
  });

  it("should not resubscribe when the websocket closes cleanly", async () => {
    const spy = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1", resubscribe: true }));

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
    server.close();
    await server.closed;

    expect(spy.receivedComplete()).toBe(true);
  });

  it("should reconnect when the websocket errors and reconnect is enabled", async () => {
    relay.reconnectTimer = () => timer(0);
    const spy = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1", reconnect: { count: 1, delay: 0 } }), {
      expectErrors: true,
    });

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
    server.close({ wasClean: false, code: 1006, reason: "relay crashed" });
    await server.closed;

    expect(spy.receivedError()).toBe(false);
    await expect(server.connected).resolves.toBeDefined();

    spy.unsubscribe();
    await server.closed;
  });

  it("should not send multiple REQ messages for multiple subscriptions", async () => {
    const sub = relay.req([{ kinds: [1] }], { id: "sub1" });
    sub.subscribe();
    sub.subscribe();
    sub.subscribe();
    sub.subscribe();

    // Wait for connection
    await server.connected;

    // Consume all messages
    while (server.messagesToConsume.pendingItems.length > 0) await server.nextMessage;

    // Wait for all messages to be sent
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(server.messages).toEqual([["REQ", "sub1", { kinds: [1] }]]);
  });

  it("should wait for authentication if relay responds with auth-required", async () => {
    const sub = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1" }));
    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);

    // Send CLOSED message with auth-required reason
    server.send(["CLOSED", "sub1", "auth-required: need to authenticate"]);

    // Should be waiting for auth, not completed
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(sub.receivedComplete()).toBe(false);
    expect(sub.receivedError()).toBe(false);

    // Simulate successful authentication
    relay.authenticationResponse$.next({ ok: true, from: "wss://test" });

    // REQ should be retried after auth
    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);

    // Send EVENT and EOSE to complete the subscription
    server.send(["EVENT", "sub1", mockEvent]);
    server.send(["EOSE", "sub1"]);

    expect(sub.getValues()).toEqual([
      expect.objectContaining({ type: "OPEN" }),
      expect.objectContaining({ type: "OPEN" }),
      expect.objectContaining({ type: "EVENT", event: expect.objectContaining(mockEvent) }),
      expect.objectContaining({ type: "EOSE" }),
    ]);
  });

  it("should still retry for auth-required when resubscribe=false", async () => {
    const spy = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1", resubscribe: false }));
    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);

    // Relay closes with auth-required
    server.send(["CLOSED", "sub1", "auth-required: need to authenticate"]);

    // Should wait for auth instead of completing
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(spy.receivedComplete()).toBe(false);

    // Simulate authentication completing
    relay.authenticationResponse$.next({ ok: true, from: "wss://test" });

    // Should retry REQ after auth even when resubscribe is false
    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
  });

  it("should throw AuthRequiredError when waitForAuth=false and relay sends auth-required CLOSED", async () => {
    const spy = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1", waitForAuth: false }), { expectErrors: true });
    await server.nextMessage;

    server.send(["CLOSED", "sub1", "auth-required: need to authenticate"]);

    await spy.onError();
    expect(spy.getError()).toBeInstanceOf(AuthRequiredError);
  });

  it("should throw error if relay closes connection with error", async () => {
    const spy = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1" }), { expectErrors: true });
    await server.connected;

    // Send CLOSE message with error
    server.error({
      reason: "error message",
      code: 1000,
      wasClean: false,
    });

    // Verify the subscription completed with an error
    expect(spy.receivedError()).toBe(true);
  });

  it("should not return EOSE while waiting for the relay to be ready", async () => {
    vi.useFakeTimers();

    // @ts-expect-error
    relay._ready$.next(false);

    const spy = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1" }), { expectErrors: true });

    // Fast-forward time by 20 seconds
    vi.advanceTimersByTime(20000);
    await Promise.resolve();

    expect(spy.receivedComplete()).toBe(false);
    expect(spy.receivedError()).toBe(false);
    expect(spy.receivedNext()).toBe(false);
  });

  it("should wait when relay isn't ready", async () => {
    // @ts-expect-error
    relay._ready$.next(false);

    subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1" }));

    // Wait 10ms to ensure the relay didn't receive anything
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(server.messages.length).toBe(0);

    // @ts-expect-error
    relay._ready$.next(true);

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
  });

  it("should wait for filters if filters are provided as an observable", async () => {
    const filters = new Subject<Filter | Filter[]>();
    subscribeSpyTo(relay.req(filters, { id: "sub1" }));

    // Wait 10sm and ensure no messages were sent yet
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(server.messagesToConsume.pendingItems.length).toBe(0);

    // Send REQ message with filters
    filters.next([{ kinds: [1] }]);

    // Wait for the REQ message to be sent
    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
  });

  it("should update filters if filters are provided as an observable", async () => {
    const filters = new Subject<Filter | Filter[]>();
    subscribeSpyTo(relay.req(filters, { id: "sub1" }));

    // Send REQ message with filters
    filters.next([{ kinds: [1] }]);

    // Should send REQ message with new filters
    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);

    // Send REQ message with filters
    filters.next([{ kinds: [2] }]);

    // Should send new REQ message with new filters
    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [2] }]);
    // It should not send CLOSE message
    await expect(server.messages).not.toContain(["CLOSE", "sub1"]);
  });

  it("should complete if filters are provided as an observable that completes", async () => {
    const filters = new Subject<Filter | Filter[]>();
    const sub = subscribeSpyTo(relay.req(filters, { id: "sub1" }));

    // Send REQ message with filters
    filters.next([{ kinds: [1] }]);

    // Complete the observable
    filters.complete();

    await sub.onComplete();

    expect(sub.receivedComplete()).toBe(true);
  });

  it("should complete observable when websocket closes cleanly", async () => {
    const sub = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1" }));
    await server.connected;

    server.close();

    expect(sub.receivedComplete()).toBe(true);
  });

  it("should error observable when relay closes connection with error", async () => {
    const sub = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1" }), { expectErrors: true });
    await server.connected;

    // Send an error
    server.error({
      reason: "error message",
      code: 1000,
      wasClean: false,
    });

    expect(sub.receivedError()).toBe(true);
  });

  it("should pass reconnect option to retry operator", () => {
    const retry = vi.spyOn(relay as any, "customConnectionRetryOperator");

    relay.req([{ kinds: [1] }], { id: "sub1", reconnect: false });

    expect(retry).toHaveBeenCalledWith(false);
  });

  it("should reconnect when repeat operator is used", async () => {
    const sub = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1" }).pipe(repeat()));

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
    server.send(["CLOSED", "sub1", ""]);

    // Should not complete
    expect(sub.receivedComplete()).toBe(false);

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);

    // Cleanup to prevent retries breaking other tests
    sub.unsubscribe();
  });
});

describe("event", () => {
  it("should retry the EVENT after authenticating when relay responds with auth-required (13-05: superseded pre-block test)", async () => {
    // 13-05 deviation (Rule 1): this test previously asserted event()'s ambient pre-block — a SECOND,
    // unrelated event() call waiting behind the FIRST call's auth-required flag before sending its own
    // EVENT frame. That pre-block is exactly what D-02/RAUTH-02 removes: an EVENT is now sent
    // immediately regardless of any other publish's auth state, and the auth-required wait + resend
    // happen entirely INSIDE the single event() call via the shared auth-retry operator. See
    // 13-05-SUMMARY.md's RAUTH-02 coverage for the "a fresh publish is not blocked" test.
    const spy = subscribeSpyTo(relay.event(mockEvent));
    await expect(server).toReceiveMessage(["EVENT", mockEvent]);

    // Send OK with auth-required message
    server.send(["OK", mockEvent.id, false, "auth-required: need to authenticate"]);

    // Simulate successful authentication
    relay.authenticationResponse$.next({ ok: true, from: "wss://test" });

    // The shared auth-retry operator resends the EVENT automatically, from within the same call
    await expect(server).toReceiveMessage(["EVENT", mockEvent]);

    // Send OK response to complete the event
    server.send(["OK", mockEvent.id, true, ""]);

    await spy.onComplete();
    expect(spy.receivedComplete()).toBe(true);
    expect(spy.getValues()).toEqual([{ ok: true, from: "wss://test", message: "" }]);
  });

  it("should trigger connection to relay", async () => {
    subscribeSpyTo(relay.event(mockEvent));

    // Wait for connection
    await firstValueFrom(relay.connected$.pipe(filter(Boolean)));

    expect(relay.connected).toBe(true);
  });

  it("observable should complete when matching OK response received", async () => {
    const spy = subscribeSpyTo(relay.event(mockEvent));

    // Verify EVENT message was sent
    expect(await server.nextMessage).toEqual(["EVENT", mockEvent]);

    // Send matching OK response
    server.send(["OK", mockEvent.id, true, ""]);

    await spy.onComplete();

    expect(spy.receivedComplete()).toBe(true);
  });

  it("should ignore OK responses for different events", async () => {
    const spy = subscribeSpyTo(relay.event(mockEvent));
    await server.connected;

    // Send non-matching OK response
    server.send(["OK", "different_id", true, ""]);

    expect(spy.receivedComplete()).toBe(false);

    // Send matching OK response
    server.send(["OK", mockEvent.id, true, ""]);

    expect(spy.receivedComplete()).toBe(true);
  });

  it("should send EVENT message to relay", async () => {
    relay.event(mockEvent).subscribe();

    expect(await server.nextMessage).toEqual(["EVENT", mockEvent]);
  });

  it("should error if no OK received within 10s", async () => {
    vi.useFakeTimers();

    const spy = subscribeSpyTo(relay.event(mockEvent), { expectErrors: true });

    // Fast-forward time by 10 seconds
    vi.advanceTimersByTime(10000);
    await Promise.resolve();

    expect(spy.receivedComplete()).toBe(true);
    expect(spy.getLastValue()).toEqual({ ok: false, from: "wss://test", message: "Timeout" });
  });

  it("should complete when connection is closed", async () => {
    const spy = subscribeSpyTo(relay.event(mockEvent));
    await server.connected;
    server.close();
    expect(spy.receivedComplete()).toBe(true);
  });

  it("should throw error if relay closes connection with error", async () => {
    const spy = subscribeSpyTo(relay.event(mockEvent), { expectErrors: true });
    await server.connected;

    // Send an error
    server.error({
      reason: "error message",
      code: 1000,
      wasClean: false,
    });

    // Verify the subscription completed with an error
    expect(spy.receivedError()).toBe(true);
  });

  it("should not throw a timeout error while waiting for the relay to be ready", async () => {
    vi.useFakeTimers();

    // @ts-expect-error
    relay._ready$.next(false);

    const spy = subscribeSpyTo(relay.event(mockEvent), { expectErrors: true });

    // Fast-forward time by 20 seconds
    vi.advanceTimersByTime(20000);
    await Promise.resolve();

    expect(spy.receivedComplete()).toBe(false);
    expect(spy.receivedError()).toBe(false);
  });

  it("should reconnect when repeat operator is used", async () => {
    const sub = subscribeSpyTo(relay.event(mockEvent).pipe(repeat()));

    // First connection
    await server.connected;
    server.close();
    await server.closed;

    // Wait for close complete
    expect(sub.receivedComplete()).toBe(false);

    // Should reconnect
    await expect(server.connected).resolves.toBeDefined();

    // Cleanup to prevent retries breaking other tests
    sub.unsubscribe();
    await server.closed;
  });

  it("should wait when relay isn't ready", async () => {
    // @ts-expect-error
    relay._ready$.next(false);

    subscribeSpyTo(relay.event(mockEvent));

    // Wait 10ms to ensure the relay didn't receive anything
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(server.messages.length).toBe(0);

    // @ts-expect-error
    relay._ready$.next(true);

    await expect(server).toReceiveMessage(["EVENT", mockEvent]);
  });
});

describe("notices$", () => {
  it("should not trigger connection to relay", async () => {
    subscribeSpyTo(relay.notices$);
    expect(relay.connected).toBe(false);
  });

  it("should accumulate notices in notices$ state", async () => {
    subscribeSpyTo(relay.req({ kinds: [1] }));

    // Send multiple NOTICE messages
    server.send(["NOTICE", "Notice 1"]);
    server.send(["NOTICE", "Notice 2"]);
    server.send(["NOTICE", "Notice 3"]);

    // Verify the notices state contains all messages
    expect(relay.notices$.value).toEqual(["Notice 1", "Notice 2", "Notice 3"]);
  });

  it("should ignore non-NOTICE messages", async () => {
    subscribeSpyTo(relay.req({ kinds: [1] }));

    server.send(["NOTICE", "Important notice"]);
    server.send(["OTHER", "other message"]);

    // Verify only NOTICE messages are in the state
    expect(relay.notices$.value).toEqual(["Important notice"]);
  });
});

describe("notice$", () => {
  it("should not trigger connection to relay", async () => {
    subscribeSpyTo(relay.notice$);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(relay.connected).toBe(false);
  });

  it("should emit NOTICE messages when they are received", async () => {
    const spy = subscribeSpyTo(relay.notice$);

    // Start connection
    subscribeSpyTo(relay.req({ kinds: [1] }));

    // Send multiple NOTICE messages
    server.send(["NOTICE", "Notice 1"]);
    server.send(["NOTICE", "Notice 2"]);
    server.send(["NOTICE", "Notice 3"]);

    // Verify the notices state contains all messages
    expect(spy.getValues()).toEqual(["Notice 1", "Notice 2", "Notice 3"]);
  });

  it("should ignore non-NOTICE messages", async () => {
    const spy = subscribeSpyTo(relay.notice$);

    // Start connection
    subscribeSpyTo(relay.req({ kinds: [1] }));

    server.send(["NOTICE", "Important notice"]);
    server.send(["OTHER", "other message"]);

    // Verify only NOTICE messages are in the state
    expect(spy.getValues()).toEqual(["Important notice"]);
  });
});

describe("message$", () => {
  it("should not trigger connection to relay", async () => {
    subscribeSpyTo(relay.message$);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(relay.connected).toBe(false);
  });

  it("should emit all messages when they are received", async () => {
    const spy = subscribeSpyTo(relay.message$);

    // Start connection
    subscribeSpyTo(relay.req({ kinds: [1] }));

    // Send multiple NOTICE messages
    server.send(["NOTICE", "Notice 1"]);
    server.send(["EVENT", "sub1", mockEvent]);
    server.send(["EOSE", "sub1"]);

    // Verify the notices state contains all messages
    expect(spy.getValues()).toEqual([
      ["NOTICE", "Notice 1"],
      ["EVENT", "sub1", mockEvent],
      ["EOSE", "sub1"],
    ]);
  });
});

describe("sync", () => {
  it("should wait for authentication if relay responds with NEG-ERR auth-required", async () => {
    const spy = subscribeSpyTo(relay.sync([], { kinds: [1] }), { expectErrors: true });

    // Relay should receive a NEG-OPEN message
    const open = (await server.nextMessage) as any[];
    expect(open[0]).toBe("NEG-OPEN");

    // Reject the negotiation with auth-required
    server.send(["NEG-ERR", open[1], "auth-required: need to authenticate"]);

    // Should be waiting for auth, not errored or completed
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(spy.receivedComplete()).toBe(false);
    expect(spy.receivedError()).toBe(false);

    // Simulate successful authentication
    relay.authenticationResponse$.next({ ok: true, from: "wss://test" });

    // Sync should retry the negotiation after auth (draining the NEG-CLOSE teardown from the first attempt)
    let retried = false;
    for (let i = 0; i < 3 && !retried; i++) {
      const message = (await server.nextMessage) as any[];
      if (message[0] === "NEG-OPEN") retried = true;
    }
    expect(retried).toBe(true);
  });

  it("should throw AuthRequiredError when waitForAuth=false and relay sends NEG-ERR auth-required", async () => {
    const spy = subscribeSpyTo(relay.sync([], { kinds: [1] }, SyncDirection.RECEIVE, { waitForAuth: false }), {
      expectErrors: true,
    });

    const open = (await server.nextMessage) as any[];
    server.send(["NEG-ERR", open[1], "auth-required: need to authenticate"]);

    await spy.onError();
    expect(spy.getError()).toBeInstanceOf(AuthRequiredError);
  });
});

describe("challenge$", () => {
  it("should not trigger connection to relay", async () => {
    subscribeSpyTo(relay.challenge$);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(relay.connected).toBe(false);
  });

  it("should set challenge$ when AUTH message received", async () => {
    subscribeSpyTo(relay.req({ kinds: [1] }));

    // Send AUTH message with challenge string
    server.send(["AUTH", "challenge-string-123"]);

    // Verify challenge$ was set
    expect(relay.challenge$.value).toBe("challenge-string-123");
  });

  it("should ignore non-AUTH messages", async () => {
    subscribeSpyTo(relay.req({ kinds: [1] }));

    server.send(["NOTICE", "Not a challenge"]);
    server.send(["OTHER", "other message"]);

    // Verify challenge$ remains null
    expect(relay.challenge$.value).toBe(null);
  });
});

describe("information$", () => {
  it("should fetch information document when information$ is subscribed to", async () => {
    // Mock the fetchInformationDocument method
    const mockInfo: RelayInformation = { ...defaultMockInfo, limitation: { auth_required: false } };
    vi.spyOn(Relay, "fetchInformationDocument").mockReturnValue(of(mockInfo));

    // Subscribe to information$
    const sub = subscribeSpyTo(relay.information$);

    // Verify fetchInformationDocument was called with the relay URL
    expect(Relay.fetchInformationDocument).toHaveBeenCalledWith(relay.url);

    // Verify the information was emitted
    expect(sub.getLastValue()).toEqual(mockInfo);
  });

  it("should return null when fetchInformationDocument fails", async () => {
    // Mock the fetchInformationDocument method to throw an error
    vi.spyOn(Relay, "fetchInformationDocument").mockReturnValue(throwError(() => new Error("Failed to fetch")));

    // Subscribe to information$
    const sub = subscribeSpyTo(relay.information$);

    // Verify fetchInformationDocument was called
    expect(Relay.fetchInformationDocument).toHaveBeenCalled();

    // Verify null was emitted
    expect(sub.getLastValue()).toBeNull();
  });

  it("should cache the information document", async () => {
    // Mock the fetchInformationDocument method
    const mockInfo: RelayInformation = { ...defaultMockInfo, limitation: { auth_required: true } };
    vi.spyOn(Relay, "fetchInformationDocument").mockReturnValue(of(mockInfo));

    // Subscribe to information$ multiple times
    const sub1 = subscribeSpyTo(relay.information$);
    const sub2 = subscribeSpyTo(relay.information$);

    // Verify fetchInformationDocument was called only once
    expect(Relay.fetchInformationDocument).toHaveBeenCalledTimes(1);

    // Verify both subscriptions received the same information
    expect(sub1.getLastValue()).toEqual(mockInfo);
    expect(sub2.getLastValue()).toEqual(mockInfo);

    // Verify the internal state was updated
    expect(relay.information).toEqual(mockInfo);
  });
});

describe("createReconnectTimer", () => {
  it("should create a reconnect timer when relay closes with error", async () => {
    const reconnectTimer = vi.fn().mockReturnValue(timer(1000));
    vi.spyOn(Relay, "createReconnectTimer").mockReturnValue(reconnectTimer);

    relay = new Relay("wss://test");
    const spy = subscribeSpyTo(relay.req([{ kinds: [1] }]), { expectErrors: true });

    // Send an error
    server.error({
      reason: "error message",
      code: 1000,
      wasClean: false,
    });

    // Verify the subscription errored
    expect(spy.receivedError()).toBe(true);

    expect(reconnectTimer).toHaveBeenCalledWith(expect.any(Error), 0);
  });

  it("should set ready$ to false until the reconnect timer completes", async () => {
    vi.useFakeTimers();
    const reconnectTimer = vi.fn().mockReturnValue(timer(1000));
    vi.spyOn(Relay, "createReconnectTimer").mockReturnValue(reconnectTimer);
    relay = new Relay("wss://test");

    subscribeSpyTo(relay.req([{ kinds: [1] }]), { expectErrors: true });

    // Send an error
    server.error({
      reason: "error message",
      code: 1000,
      wasClean: false,
    });

    expect(relay.ready).toBe(false);

    // Fast-forward time by 10ms
    vi.advanceTimersByTime(5000);
    await Promise.resolve();

    expect(relay.ready).toBe(true);
  });
});

describe("publish", () => {
  it("should retry when auth-required is received and authentication is completed", async () => {
    // First attempt to publish
    const spy = relay.publish(mockEvent, { reconnect: { count: Infinity, delay: 0 } }).catch(() => {});

    // Verify EVENT was sent
    await expect(server).toReceiveMessage(["EVENT", mockEvent]);

    // Send auth-required response
    server.send(["AUTH", "challenge-string"]);
    server.send(["OK", mockEvent.id, false, "auth-required: need to authenticate"]);

    // Send auth event
    const authEvent = { ...mockEvent, id: "auth-id" };
    relay.auth(authEvent);

    // Verify AUTH was sent
    await expect(server).toReceiveMessage(["AUTH", authEvent]);

    // Send successful auth response
    server.send(["OK", authEvent.id, true, ""]);

    // Wait for the event to be sent again
    await expect(server).toReceiveMessage(["EVENT", mockEvent]);

    // Send successful response for the retried event
    server.send(["OK", mockEvent.id, true, ""]);

    // Verify the final result is successful
    await expect(spy).resolves.toEqual({ ok: true, message: "", from: "wss://test" });
  });

  it("should support reconnection", async () => {
    const spy = relay.publish(mockEvent, { reconnect: true }).catch(() => {});

    await server.connected;
    server.close();
    await server.closed;

    // Should reconnect
    await expect(server.connected).resolves.toBeDefined();

    // Cleanup to prevent retries breaking other tests
    await spy;
  });

  it("should support retries on connection errors", async () => {
    const spy = relay.publish(mockEvent, { retries: 2 }).catch(() => {});

    await server.connected;
    server.close({ wasClean: false, code: 1000, reason: "error message" });
    await server.closed;

    // Should retry
    await expect(server.connected).resolves.toBeDefined();

    // Cleanup to prevent retries breaking other tests
    await spy;
  });
});

describe("operation-scoped EVENT/PUBLISH auth (13-05)", () => {
  it("T-13-01 (RESEARCH gap 1): a persistently auth-requiring relay receives exactly authRetries + 1 EVENT frames, then a terminal AuthRequiredError, with the default retries left in place", async () => {
    // The relay never really authenticates — onAuthRequired pokes authenticationResponse$ directly
    // (this suite's established out-of-band convention) so authSatisfied$ resolves and the shared
    // operator resends, while the mock relay keeps answering every EVENT with auth-required. Only the
    // operator's own authRetries budget (default 1) can end this, giving authRetries + 1 = 2 sends.
    const onAuthRequired = vi.fn(() => {
      relay.authenticationResponse$.next({ ok: true, from: relay.url });
    });

    const spy = relay.publish(mockEvent, { onAuthRequired, authTimeout: 50 }).catch((err) => err);

    // First EVENT
    await expect(server).toReceiveMessage(["EVENT", mockEvent]);
    server.send(["OK", mockEvent.id, false, "auth-required: need to authenticate"]);

    // Second (and last) EVENT — authRetries defaults to 1, so authRetries + 1 = 2 total sends
    await expect(server).toReceiveMessage(["EVENT", mockEvent]);
    server.send(["OK", mockEvent.id, false, "auth-required: need to authenticate"]);

    const result = await spy;
    expect(result).toBeInstanceOf(AuthRequiredError);

    // Prove publish's own (default, left-in-place) retry budget does NOT retry the exhausted auth
    // failure — this is the RESEARCH gap: without customRetryOperator's RelayClosedError skip, this
    // would fire a third (and more) EVENT frame after this.publishRetry's linear backoff (1000ms for
    // the first retry). Wait comfortably past that first-retry delay — not a short window — so this
    // assertion cannot pass vacuously just because the retry hadn't fired yet. Non-vacuity: this
    // assertion was observed RED (a 3rd EVENT frame arrives ~1s later) against a customRetryOperator
    // without the skip.
    await new Promise((resolve) => setTimeout(resolve, 1200));

    const eventFrames = server.messages.filter((m: any) => Array.isArray(m) && m[0] === "EVENT");
    expect(eventFrames).toHaveLength(2);
    expect(onAuthRequired).toHaveBeenCalledTimes(1);
  });

  it("RAUTH-02: a fresh publish sends its EVENT frame immediately, before any AUTH frame, even after an earlier publish already received auth-required", async () => {
    // First EVENT is told auth is required — the old pre-block would have made a fresh EVENT wait
    // behind this flag. Non-vacuity: this assertion was observed RED (the second EVENT never arrives)
    // against the pre-task event()'s ambient waitForAuth() wrapper. Deliberately no wait between the
    // first response and the second event() call: this fixture's keepAlive=0 drops the connection (and
    // resetState() clears receivedAuthRequiredForEvent) within a few ms of nothing being subscribed,
    // which would falsely "pass" even the old pre-blocked model — checking immediately is what actually
    // exercises RAUTH-02 rather than an unrelated timing quirk (matches this suite's established
    // convention, e.g. the COUNT/REQ RAUTH-09 tests).
    const firstSub = relay.event(mockEvent, "EVENT", { authTimeout: false }).subscribe();
    await expect(server).toReceiveMessage(["EVENT", mockEvent]);
    server.send(["OK", mockEvent.id, false, "auth-required: need to authenticate"]);

    const secondEvent = { ...mockEvent, id: "second-event-id" };
    const secondSub = relay.event(secondEvent, "EVENT", { authTimeout: 30 }).subscribe();

    // The second EVENT must be sent immediately, before any AUTH frame is ever sent
    await expect(server).toReceiveMessage(["EVENT", secondEvent]);
    expect(server.messages.some((m: any) => Array.isArray(m) && m[0] === "AUTH")).toBe(false);

    firstSub.unsubscribe();
    secondSub.unsubscribe();
  });

  it("RAUTH-01/RAUTH-03: invokes onAuthRequired with operation \"publish\" and resends the EVENT after the handler authenticates", async () => {
    const user = new FakeUser();
    const onAuthRequired = vi.fn(async () => {
      await relay.authenticate(user);
    });

    const spy = relay.publish(mockEvent, { onAuthRequired });

    await expect(server).toReceiveMessage(["EVENT", mockEvent]);
    server.send(["AUTH", "challenge-1"]);
    server.send(["OK", mockEvent.id, false, "auth-required: need to authenticate"]);

    const authMsg = (await server.nextMessage) as [string, NostrEvent];
    expect(authMsg[0]).toBe("AUTH");
    server.send(["OK", authMsg[1].id, true, ""]);

    await expect(server).toReceiveMessage(["EVENT", mockEvent]);
    server.send(["OK", mockEvent.id, true, ""]);

    await expect(spy).resolves.toEqual({ ok: true, message: "", from: "wss://test" });

    expect(onAuthRequired).toHaveBeenCalledTimes(1);
    expect(onAuthRequired).toHaveBeenCalledWith({
      relay,
      url: relay.url,
      challenge: "challenge-1",
      request: { verb: "EVENT", event: mockEvent },
      requirement: true,
      missingPubkeys: null,
      reason: "auth-required: need to authenticate",
    });
  });

  it("RAUTH-04: a short authTimeout rejects the publish with AuthTimeoutError", async () => {
    const onAuthRequired = vi.fn();
    const spy = relay.publish(mockEvent, { onAuthRequired, authTimeout: 30 }).catch((err) => err);

    await expect(server).toReceiveMessage(["EVENT", mockEvent]);
    server.send(["OK", mockEvent.id, false, "auth-required: need to authenticate"]);

    const result = await spy;
    expect(result).toBeInstanceOf(AuthTimeoutError);
    expect(onAuthRequired).toHaveBeenCalledTimes(1);
  });

  it("RAUTH-04: a rejecting handler rejects the publish with AuthHandlerError carrying the rejection as cause", async () => {
    const cause = new Error("nope");
    const onAuthRequired = vi.fn().mockRejectedValue(cause);
    const spy = relay.publish(mockEvent, { onAuthRequired }).catch((err) => err);

    await expect(server).toReceiveMessage(["EVENT", mockEvent]);
    server.send(["OK", mockEvent.id, false, "auth-required: need to authenticate"]);

    const result = await spy;
    expect(result).toBeInstanceOf(AuthHandlerError);
    expect((result as AuthHandlerError).cause).toBe(cause);
  });

  it("RAUTH-04: authTimeout:false leaves the EVENT pending past a short window", async () => {
    const onAuthRequired = vi.fn(); // no-op — auth happens out of band, not through this handler
    const spy = subscribeSpyTo(relay.event(mockEvent, "EVENT", { onAuthRequired, authTimeout: false }));

    await expect(server).toReceiveMessage(["EVENT", mockEvent]);
    server.send(["OK", mockEvent.id, false, "auth-required: need to authenticate"]);

    // A short bound (e.g. 30ms) would already have errored/completed by now — authTimeout: false must not have
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(spy.receivedError()).toBe(false);
    expect(spy.receivedComplete()).toBe(false);
    expect(onAuthRequired).toHaveBeenCalledTimes(1);

    spy.unsubscribe();
  });

  it('RAUTH-06: event(..., "AUTH") never invokes the handler even when the relay answers auth-required', async () => {
    const onAuthRequired = vi.fn();
    const authEvent = { ...mockEvent, id: "auth-event-id" };
    const spy = subscribeSpyTo(relay.event(authEvent, "AUTH", { onAuthRequired }));

    await expect(server).toReceiveMessage(["AUTH", authEvent]);
    server.send(["OK", authEvent.id, false, "auth-required: need to authenticate"]);

    await spy.onComplete();
    expect(onAuthRequired).not.toHaveBeenCalled();
    expect(spy.getValues()).toEqual([
      { ok: false, from: "wss://test", message: "auth-required: need to authenticate" },
    ]);
  });

  it("RAUTH-06: waitForAuth:false never invokes the handler", async () => {
    const onAuthRequired = vi.fn();
    const spy = subscribeSpyTo(relay.event(mockEvent, "EVENT", { waitForAuth: false, onAuthRequired }));

    await expect(server).toReceiveMessage(["EVENT", mockEvent]);
    server.send(["OK", mockEvent.id, false, "auth-required: need to authenticate"]);

    await spy.onComplete();
    expect(onAuthRequired).not.toHaveBeenCalled();
    expect(spy.getValues()).toEqual([
      { ok: false, from: "wss://test", message: "auth-required: need to authenticate" },
    ]);
  });

  it("D-15: publish's timeout is suspended across the auth phase", async () => {
    // Handler + wait together outlast the short `timeout` below; only suspension across the auth
    // phase (not a race against authTimeout) lets this publish still resolve. Simulates successful
    // authentication out of band via authenticationResponse$ (this suite's established convention,
    // see 13-02-SUMMARY.md) rather than a live relay.authenticate() round trip — this fixture's
    // keepAlive=0 can drop the connection (and wipe the challenge) while nothing is subscribed
    // during a real async handler delay, which is orthogonal to what D-15 asserts here.
    const onAuthRequired = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      relay.authenticationResponse$.next({ ok: true, from: "wss://test" });
    });

    const spy = relay.publish(mockEvent, { onAuthRequired, timeout: 20, authTimeout: false });

    await expect(server).toReceiveMessage(["EVENT", mockEvent]);
    server.send(["OK", mockEvent.id, false, "auth-required: need to authenticate"]);

    await expect(server).toReceiveMessage(["EVENT", mockEvent]);
    server.send(["OK", mockEvent.id, true, ""]);

    await expect(spy).resolves.toEqual({ ok: true, message: "", from: "wss://test" });
  });

  it("RAUTH-09: authRequiredForPublish$ flips true when an EVENT receives auth-required", async () => {
    const flagSpy = subscribeSpyTo(relay.authRequiredForPublish$);
    expect(flagSpy.getLastValue()).toBe(false);

    const spy = subscribeSpyTo(relay.event(mockEvent, "EVENT", { authTimeout: 30 }), { expectErrors: true });

    await expect(server).toReceiveMessage(["EVENT", mockEvent]);
    server.send(["OK", mockEvent.id, false, "auth-required: need to authenticate"]);

    expect(flagSpy.getLastValue()).toBe(true);

    spy.unsubscribe();
  });

  it("RAUTH-07: publish() forwards onAuthRequired to the underlying EVENT auth phase", async () => {
    const onAuthRequired = vi.fn();
    const spy = relay.publish(mockEvent, { onAuthRequired, authTimeout: 30 }).catch((err) => err);

    await expect(server).toReceiveMessage(["EVENT", mockEvent]);
    server.send(["OK", mockEvent.id, false, "auth-required: need to authenticate"]);

    await spy;
    expect(onAuthRequired).toHaveBeenCalledTimes(1);
  });
});

describe("request", () => {
  it("should retry when auth-required is received and authentication is completed", async () => {
    // First attempt to request
    const spy = subscribeSpyTo(relay.request({ kinds: [1] }, { id: "sub1" }));

    // Verify REQ was sent
    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);

    // Send auth-required response
    server.send(["AUTH", "challenge-string"]);
    server.send(["CLOSED", "sub1", "auth-required: need to authenticate"]);

    // Send auth event
    const authEvent = { ...mockEvent, id: "auth-id" };
    const auth = relay.auth(authEvent);

    // Verify AUTH was sent
    await expect(server).toReceiveMessage(["AUTH", authEvent]);
    server.send(["OK", authEvent.id, true, ""]);

    // Wait for auth to complete
    await auth;

    // Wait for resubscribe (CLOSED triggers repeat, which waits for auth then re-sends REQ)
    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);

    // Send response
    server.send(["EVENT", "sub1", mockEvent]);
    server.send(["EOSE", "sub1"]);

    // Verify the final result is successful
    expect(spy.getLastValue()).toEqual(expect.objectContaining(mockEvent));
    expect(spy.receivedComplete()).toBe(true);
  });

  it("should support resubscribe", async () => {
    const spy = subscribeSpyTo(relay.request({ kinds: [1] }, { id: "sub1", resubscribe: true }));

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
    server.send(["CLOSED", "sub1", ""]);

    expect(spy.receivedComplete()).toBe(false);

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);

    // Cleanup to prevent retries breaking other tests
    spy.unsubscribe();
  });

  it("should support reconnect on connection errors", async () => {
    const spy = subscribeSpyTo(relay.request({ kinds: [1] }, { reconnect: 5 }), { expectErrors: true });

    await server.connected;
    server.close({ wasClean: false, code: 1000, reason: "error message" });
    await server.closed;

    // Should retry
    await expect(server.connected).resolves.toBeDefined();

    // Cleanup to prevent retries breaking other tests
    spy.unsubscribe();
    await server.closed;
  });

  it("should pass request reconnect option to req retry operator", () => {
    const reconnect = { count: 2, delay: 5 };
    const retry = vi.spyOn(relay as any, "customConnectionRetryOperator");

    relay.request({ kinds: [1] }, { reconnect });

    expect(retry).toHaveBeenCalledWith(reconnect);
  });

  it("should throw AuthRequiredError when waitForAuth=false and relay responds with auth-required", async () => {
    const spy = subscribeSpyTo(relay.request({ kinds: [1] }, { id: "sub1", waitForAuth: false }), {
      expectErrors: true,
    });

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
    server.send(["CLOSED", "sub1", "auth-required: need to authenticate"]);

    await spy.onError();
    expect(spy.getError()).toBeInstanceOf(AuthRequiredError);
  });

  it("WR-01: request()'s operation clock fires against a relay that accepts the REQ and then says nothing at all", async () => {
    // No auth involved here at all — a relay that answers the REQ with total silence (no EVENT, no
    // EOSE, no CLOSED). req()'s own synthetic OPEN message is the only value this stream will ever
    // emit, and isReqProgress (CR-01/WR-01) correctly rejects it as bookkeeping, not progress — so
    // this test proves request()'s operation clock still starts and fires on its own, independent of
    // the auth-suspension mechanism the D-15 test below exercises.
    const spy = subscribeSpyTo(relay.request({ kinds: [1] }, { id: "sub1", timeout: 40 }), { expectErrors: true });

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
    // Deliberately send nothing back.

    await spy.onError();

    expect(spy.getError()).toBeInstanceOf(Error);
    expect(spy.receivedComplete()).toBe(false);
  });
});

describe("subscription", () => {
  it("should retry when auth-required is received and authentication is completed", async () => {
    // First attempt to request
    const spy = subscribeSpyTo(relay.subscription({ kinds: [1] }, { id: "sub1" }));

    // Verify REQ was sent
    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);

    // Send auth-required response
    server.send(["AUTH", "challenge-string"]);
    server.send(["CLOSED", "sub1", "auth-required: need to authenticate"]);

    // Send auth event
    const authEvent = { ...mockEvent, id: "auth-id" };
    const auth = relay.auth(authEvent);

    // Verify AUTH was sent
    await expect(server).toReceiveMessage(["AUTH", authEvent]);
    server.send(["OK", authEvent.id, true, ""]);

    // Wait for auth to complete
    await auth;

    // Wait for resubscribe (CLOSED triggers repeat, which waits for auth then re-sends REQ)
    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);

    // Send response
    server.send(["EVENT", "sub1", mockEvent]);
    server.send(["EOSE", "sub1"]);

    // Verify the final result is successful
    expect(spy.getValues()).toEqual([expect.objectContaining(mockEvent), "EOSE"]);
    expect(spy.receivedComplete()).toBe(false);
  });

  it("should support resubscribe", async () => {
    const spy = subscribeSpyTo(relay.subscription({ kinds: [1] }, { id: "sub1", resubscribe: true }));

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
    server.send(["CLOSED", "sub1", ""]);

    expect(spy.receivedComplete()).toBe(false);

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);

    // Cleanup to prevent resubscribe breaking other tests
    spy.unsubscribe();
  });

  it("should support reconnection on connection errors", async () => {
    const spy = subscribeSpyTo(relay.subscription({ kinds: [1] }, { reconnect: 5 }), { expectErrors: true });

    await server.connected;
    server.close({ wasClean: false, code: 1006, reason: "relay crashed" });
    await server.closed;

    // Should retry
    await expect(server.connected).resolves.toBeDefined();

    // Cleanup to prevent reconnection breaking other tests
    spy.unsubscribe();
    await server.closed;
  });

  it("should pass subscription reconnect option to req retry operator", () => {
    const reconnect = { count: 2, delay: 5 };
    const retry = vi.spyOn(relay as any, "customConnectionRetryOperator");

    relay.subscription({ kinds: [1] }, { reconnect });

    expect(retry).toHaveBeenCalledWith(reconnect);
  });

  it("should throw AuthRequiredError when waitForAuth=false and relay responds with auth-required", async () => {
    const spy = subscribeSpyTo(relay.subscription({ kinds: [1] }, { id: "sub1", waitForAuth: false }), {
      expectErrors: true,
    });

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
    server.send(["CLOSED", "sub1", "auth-required: need to authenticate"]);

    await spy.onError();
    expect(spy.getError()).toBeInstanceOf(AuthRequiredError);
  });
});

describe("operation-scoped REQ auth (13-02)", () => {
  it("RAUTH-02: a fresh REQ is sent immediately while an earlier, unrelated REQ is auth-blocked", async () => {
    const specA = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "a", authTimeout: 30 }), { expectErrors: true });
    await expect(server).toReceiveMessage(["REQ", "a", { kinds: [1] }]);

    // "a" is told auth is required — the old pre-block would have made every OTHER REQ wait behind this
    server.send(["CLOSED", "a", "auth-required: need to authenticate"]);

    const specB = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "b" }));

    // "b" must send its own REQ immediately, before any AUTH frame is ever sent
    await expect(server).toReceiveMessage(["REQ", "b", { kinds: [1] }]);
    expect(server.messages.some((m: any) => m[0] === "AUTH")).toBe(false);

    specA.unsubscribe();
    specB.unsubscribe();
  });

  it("RAUTH-01: invokes onAuthRequired with the full operation-local context", async () => {
    const onAuthRequired = vi.fn().mockResolvedValue(undefined);
    const spy = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1", onAuthRequired, authTimeout: 50 }), {
      expectErrors: true,
    });

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
    server.send(["AUTH", "challenge-xyz"]);
    server.send(["CLOSED", "sub1", "auth-required: need to authenticate"]);

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(onAuthRequired).toHaveBeenCalledTimes(1);
    expect(onAuthRequired).toHaveBeenCalledWith({
      relay,
      url: relay.url,
      challenge: "challenge-xyz",
      request: { verb: "REQ", id: "sub1", filters: [{ kinds: [1] }] },
      requirement: true,
      missingPubkeys: null,
      reason: "auth-required: need to authenticate",
    });

    spy.unsubscribe();
  });

  it("RAUTH-01: missingPubkeys reflects only the not-yet-authenticated entry of an array requirement", async () => {
    const userA = new FakeUser();
    const userB = new FakeUser();

    // Pre-authenticate userA on this connection via an unrelated REQ
    subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1" }));
    await server.nextMessage;
    server.send(["AUTH", "challenge-1"]);
    const authPromise = relay.authenticate(userA);
    const authMsg = (await server.nextMessage) as [string, NostrEvent];
    server.send(["OK", authMsg[1].id, true, ""]);
    await authPromise;

    const onAuthRequired = vi.fn().mockResolvedValue(undefined);
    const spy = subscribeSpyTo(
      relay.req([{ kinds: [1] }], {
        id: "sub2",
        waitForAuth: [userA.pubkey, userB.pubkey],
        onAuthRequired,
        authTimeout: 50,
      }),
      { expectErrors: true },
    );

    await expect(server).toReceiveMessage(["REQ", "sub2", { kinds: [1] }]);
    server.send(["CLOSED", "sub2", "auth-required: need to authenticate"]);

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(onAuthRequired).toHaveBeenCalledWith(expect.objectContaining({ missingPubkeys: [userB.pubkey] }));

    spy.unsubscribe();
  });

  it("RAUTH-03: retries exactly once by default and resends the REQ after the handler authenticates", async () => {
    const user = new FakeUser();
    const onAuthRequired = vi.fn(async () => {
      await relay.authenticate(user);
    });

    const spy = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1", onAuthRequired }));

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
    server.send(["AUTH", "challenge-1"]);
    server.send(["CLOSED", "sub1", "auth-required: need to authenticate"]);

    const authMsg = (await server.nextMessage) as [string, NostrEvent];
    expect(authMsg[0]).toBe("AUTH");
    server.send(["OK", authMsg[1].id, true, ""]);

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);

    server.send(["EVENT", "sub1", mockEvent]);
    server.send(["EOSE", "sub1"]);

    await new Promise((resolve) => setTimeout(resolve, 10));

    const reqFrames = server.messages.filter((m: any) => m[0] === "REQ" && m[1] === "sub1");
    expect(reqFrames).toHaveLength(2);
    expect(onAuthRequired).toHaveBeenCalledTimes(1);

    spy.unsubscribe();
  });

  it("RAUTH-03: authRetries:2 allows three REQ frames total", async () => {
    const user = new FakeUser();
    const onAuthRequired = vi.fn(async () => {
      if (!relay.isAuthenticated(user.pubkey)) await relay.authenticate(user);
    });

    const spy = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1", onAuthRequired, authRetries: 2 }));

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
    server.send(["AUTH", "challenge-1"]);
    server.send(["CLOSED", "sub1", "auth-required: need to authenticate"]);

    const authMsg = (await server.nextMessage) as [string, NostrEvent];
    server.send(["OK", authMsg[1].id, true, ""]);

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);

    // The relay demands auth again on the second attempt (already-authenticated user, no new AUTH round trip)
    server.send(["CLOSED", "sub1", "auth-required: need to authenticate"]);

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);

    server.send(["EVENT", "sub1", mockEvent]);
    server.send(["EOSE", "sub1"]);

    await new Promise((resolve) => setTimeout(resolve, 10));

    const reqFrames = server.messages.filter((m: any) => m[0] === "REQ" && m[1] === "sub1");
    expect(reqFrames).toHaveLength(3);
    expect(onAuthRequired).toHaveBeenCalledTimes(2);

    spy.unsubscribe();
  });

  it("RAUTH-03: authRetries:0 exhausts immediately without invoking the handler or retrying", async () => {
    const onAuthRequired = vi.fn();
    const spy = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1", onAuthRequired, authRetries: 0 }), {
      expectErrors: true,
    });

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
    server.send(["CLOSED", "sub1", "auth-required: need to authenticate"]);

    await spy.onError();

    expect(spy.getError()).toBeInstanceOf(AuthRequiredError);
    expect(onAuthRequired).not.toHaveBeenCalled();

    const reqFrames = server.messages.filter((m: any) => m[0] === "REQ" && m[1] === "sub1");
    expect(reqFrames).toHaveLength(1);
  });

  it("RAUTH-04: a short authTimeout errors with AuthTimeoutError when the requirement is never satisfied", async () => {
    const onAuthRequired = vi.fn();
    const spy = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1", onAuthRequired, authTimeout: 30 }), {
      expectErrors: true,
    });

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
    server.send(["CLOSED", "sub1", "auth-required: need to authenticate"]);

    await spy.onError();

    expect(spy.getError()).toBeInstanceOf(AuthTimeoutError);
    expect(onAuthRequired).toHaveBeenCalledTimes(1);
  });

  it("RAUTH-04: authTimeout:false waits past a short window and still retries once satisfied out of band", async () => {
    const onAuthRequired = vi.fn(); // no-op — auth happens out of band, not through this handler

    const spy = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1", onAuthRequired, authTimeout: false }));

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
    server.send(["CLOSED", "sub1", "auth-required: need to authenticate"]);

    // A short bound (e.g. 30ms) would already have errored by now — authTimeout: false must not have
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(spy.receivedError()).toBe(false);
    expect(spy.receivedComplete()).toBe(false);

    // Satisfy the requirement out of band — e.g. a concurrent operation's handler authenticating the
    // same connection, or an in-flight relay.auth() the app already had running — not this REQ's own
    // handler. Poking authenticationResponse$ directly (matching this suite's existing convention for
    // "simulate successful authentication") avoids depending on a live challenge/AUTH round trip,
    // which this fixture's keepAlive=0 can drop while nothing is subscribed during the wait.
    relay.authenticationResponse$.next({ ok: true, from: "wss://test" });

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);

    spy.unsubscribe();
  });

  it("RAUTH-05: two concurrent REQs each invoke their own handler independently", async () => {
    const userA = new FakeUser();
    const userB = new FakeUser();
    const handlerA = vi.fn(async () => {
      await relay.authenticate(userA);
    });
    const handlerB = vi.fn(async () => {
      await relay.authenticate(userB);
    });

    const specA = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "a", onAuthRequired: handlerA }));
    const specB = subscribeSpyTo(relay.req([{ kinds: [2] }], { id: "b", onAuthRequired: handlerB }));

    await expect(server).toReceiveMessage(["REQ", "a", { kinds: [1] }]);
    await expect(server).toReceiveMessage(["REQ", "b", { kinds: [2] }]);

    server.send(["AUTH", "challenge-1"]);
    server.send(["CLOSED", "a", "auth-required: need to authenticate"]);
    server.send(["CLOSED", "b", "auth-required: need to authenticate"]);

    // Respond OK to both AUTH round trips, regardless of arrival order
    for (let i = 0; i < 2; i++) {
      const msg = (await server.nextMessage) as [string, NostrEvent];
      expect(msg[0]).toBe("AUTH");
      server.send(["OK", msg[1].id, true, ""]);
    }

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).toHaveBeenCalledTimes(1);
    expect(server.messages.filter((m: any) => m[0] === "REQ" && m[1] === "a")).toHaveLength(2);
    expect(server.messages.filter((m: any) => m[0] === "REQ" && m[1] === "b")).toHaveLength(2);

    specA.unsubscribe();
    specB.unsubscribe();
  });

  it("RAUTH-05: a rejecting handler on one REQ does not affect a concurrent REQ's retry", async () => {
    const userB = new FakeUser();
    const handlerA = vi.fn().mockRejectedValue(new Error("nope"));
    const handlerB = vi.fn(async () => {
      await relay.authenticate(userB);
    });

    const specA = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "a", onAuthRequired: handlerA }), {
      expectErrors: true,
    });
    const specB = subscribeSpyTo(relay.req([{ kinds: [2] }], { id: "b", onAuthRequired: handlerB }));

    await expect(server).toReceiveMessage(["REQ", "a", { kinds: [1] }]);
    await expect(server).toReceiveMessage(["REQ", "b", { kinds: [2] }]);

    server.send(["AUTH", "challenge-1"]);
    server.send(["CLOSED", "a", "auth-required: need to authenticate"]);
    server.send(["CLOSED", "b", "auth-required: need to authenticate"]);

    await specA.onError();
    expect(specA.getError()).toBeInstanceOf(AuthHandlerError);

    const authMsg = (await server.nextMessage) as [string, NostrEvent];
    expect(authMsg[0]).toBe("AUTH");
    server.send(["OK", authMsg[1].id, true, ""]);

    await expect(server).toReceiveMessage(["REQ", "b", { kinds: [2] }]);

    specB.unsubscribe();
  });

  it("RAUTH-06: waitForAuth:false never invokes the handler and errors with AuthRequiredError", async () => {
    const onAuthRequired = vi.fn();
    const spy = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1", waitForAuth: false, onAuthRequired }), {
      expectErrors: true,
    });

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
    server.send(["CLOSED", "sub1", "auth-required: need to authenticate"]);

    await spy.onError();

    expect(spy.getError()).toBeInstanceOf(AuthRequiredError);
    expect(onAuthRequired).not.toHaveBeenCalled();
  });

  it("D-03: a non-auth CLOSED prefix still throws RelayClosedError immediately, without invoking the handler", async () => {
    const onAuthRequired = vi.fn();
    const spy = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1", onAuthRequired }), { expectErrors: true });

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
    server.send(["CLOSED", "sub1", "restricted: not allowed"]);

    await spy.onError();

    expect(spy.getError()).toBeInstanceOf(RelayClosedError);
    expect(spy.getError()).not.toBeInstanceOf(AuthRequiredError);
    expect(onAuthRequired).not.toHaveBeenCalled();
  });

  it("D-15: request()'s operation clock is suspended across the auth phase", async () => {
    // Non-vacuity (13-09 Task 3 repair): the auth phase duration (100ms, the handler's own wait below)
    // deliberately EXCEEDS the operation timeout (40ms, passed to request() below) so the two are
    // unambiguously ordered on real timers (D-20) — without gate suspension the 40ms clock would fire
    // and error long before the 100ms auth round trip ever resolves, so the request can only survive
    // because the clock is paused for the whole auth phase and resumes with its remaining budget once
    // it closes. Verified by temporarily threading a fresh, never-opened AuthPhaseGate into request()'s
    // own suspendableTimeout call (so gate.active$ never reports "in an auth phase" and the clock is
    // never actually suspended): this test went RED (timed out waiting for spy.onComplete()) against
    // that substitution, and GREEN again once the real threaded gate was restored — recorded in the
    // plan SUMMARY.
    const onAuthRequired = vi.fn(async () => {
      // A slow out-of-band auth round trip, comfortably longer than request()'s own timeout budget.
      // Resolved via authenticationResponse$ (matching this suite's existing convention) rather than
      // a live relay.authenticate() round trip, which this fixture's keepAlive=0 can drop while
      // nothing is subscribed during the wait (a pre-existing quirk, reproducible pre-13-02 too).
      await new Promise((resolve) => setTimeout(resolve, 100));
      relay.authenticationResponse$.next({ ok: true, from: "wss://test" });
    });

    const spy = subscribeSpyTo(relay.request({ kinds: [1] }, { id: "sub1", onAuthRequired, timeout: 40 }));

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
    server.send(["CLOSED", "sub1", "auth-required: need to authenticate"]);

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);

    server.send(["EVENT", "sub1", mockEvent]);
    server.send(["EOSE", "sub1"]);

    await spy.onComplete();

    expect(spy.getValues()).toEqual([expect.objectContaining(mockEvent)]);
    expect(spy.receivedError()).toBe(false);
  });

  it("D-08: the consecutive counter resets after real progress, so a second auth-required cycle is still handled", async () => {
    const user = new FakeUser();
    const onAuthRequired = vi.fn(async () => {
      if (!relay.isAuthenticated(user.pubkey)) await relay.authenticate(user);
    });

    const spy = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1", onAuthRequired }));

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
    server.send(["AUTH", "challenge-1"]);
    server.send(["CLOSED", "sub1", "auth-required: need to authenticate"]);

    const authMsg = (await server.nextMessage) as [string, NostrEvent];
    server.send(["OK", authMsg[1].id, true, ""]);

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);

    // Real progress: an event is delivered on the resumed subscription
    server.send(["EVENT", "sub1", mockEvent]);
    server.send(["EOSE", "sub1"]);

    await new Promise((resolve) => setTimeout(resolve, 10));

    // A second, independent auth-required cycle on the same long-lived subscription
    server.send(["CLOSED", "sub1", "auth-required: need to authenticate"]);

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);

    expect(onAuthRequired).toHaveBeenCalledTimes(2);
    expect(spy.receivedError()).toBe(false);

    spy.unsubscribe();
  });

  it("RAUTH-09: authRequiredForRead$ flips true when a REQ receives auth-required", async () => {
    subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1", authTimeout: 30 }), { expectErrors: true });

    const flagSpy = subscribeSpyTo(relay.authRequiredForRead$);
    expect(flagSpy.getLastValue()).toBe(false);

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
    server.send(["CLOSED", "sub1", "auth-required: need to authenticate"]);

    // Check immediately (not after a delay): this fixture's keepAlive=0 is a pre-existing quirk
    // (reproducible against the pre-13-02 implementation too) that lets the connection drop and
    // resetState() clear the flag again once nothing has resubscribed for a few ms — orthogonal to
    // what RAUTH-09 asserts here (the flag flips true the instant auth-required is received)
    expect(flagSpy.getLastValue()).toBe(true);
  });

  it("D-01: a req() subscriber never observes a value that is not a RelayReqMessage", async () => {
    const user = new FakeUser();
    const onAuthRequired = vi.fn(async () => {
      await relay.authenticate(user);
    });

    const spy = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1", onAuthRequired }));

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
    server.send(["AUTH", "challenge-1"]);
    server.send(["CLOSED", "sub1", "auth-required: need to authenticate"]);

    const authMsg = (await server.nextMessage) as [string, NostrEvent];
    server.send(["OK", authMsg[1].id, true, ""]);

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);

    server.send(["EVENT", "sub1", mockEvent]);
    server.send(["EOSE", "sub1"]);

    await new Promise((resolve) => setTimeout(resolve, 10));

    const validTypes = new Set(["OPEN", "EVENT", "EOSE", "CLOSED"]);
    expect(spy.getValues().length).toBeGreaterThan(0);
    expect(spy.getValues().every((v: any) => typeof v === "object" && v !== null && validTypes.has(v.type))).toBe(
      true,
    );

    spy.unsubscribe();
  });
});

describe("operation-scoped REQ auth gap closure (13-09, CR-02/WR-01)", () => {
  it("T-13-09-01 (REQ leg of RESEARCH gap 1): a persistently auth-requiring relay receives exactly authRetries + 1 REQ frames, then a terminal AuthRequiredError, with the default retries left in place", async () => {
    // Synchronous handler — this is exactly what CR-02 dropped: driving the shared operator's
    // resubscribe from inside the very CLOSED dispatch that delivered auth-required. Against pre-Task-1
    // req(), the second REQ never reached the socket at all (silent complete, 0 events) instead of
    // exhausting cleanly with a terminal AuthRequiredError.
    const onAuthRequired = vi.fn(() => {
      relay.authenticationResponse$.next({ ok: true, from: relay.url });
    });

    // reconnect:true exercises customConnectionRetryOperator's RelayClosedError skip too (mirrors
    // T-13-01's genuine test of the analogous skip in publish()'s customRetryOperator) — without it,
    // the exhausted AuthRequiredError would be retried after the connection-retry's own backoff.
    const spy = subscribeSpyTo(
      relay.req([{ kinds: [1] }], { id: "sub1", onAuthRequired, authTimeout: 50, reconnect: true }),
      { expectErrors: true },
    );

    // First REQ
    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
    server.send(["CLOSED", "sub1", "auth-required: need to authenticate"]);

    // Second (and last) REQ — authRetries defaults to 1, so authRetries + 1 = 2 total sends
    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
    server.send(["CLOSED", "sub1", "auth-required: need to authenticate"]);

    await spy.onError();
    expect(spy.getError()).toBeInstanceOf(AuthRequiredError);

    // Prove customConnectionRetryOperator's RelayClosedError skip (D-07) does not let a third REQ
    // frame land after the exhausted auth failure — DEFAULT_RETRY_CONFIG's first backoff is
    // count(1) * 1000ms = 1000ms. Wait comfortably past that (1200ms, matching T-13-01's identical
    // non-vacuity reasoning), not a short window, so this assertion cannot pass vacuously just
    // because the retry hadn't fired yet.
    await new Promise((resolve) => setTimeout(resolve, 1200));

    const reqFrames = server.messages.filter((m: any) => m[0] === "REQ" && m[1] === "sub1");
    expect(reqFrames).toHaveLength(2);
    expect(onAuthRequired).toHaveBeenCalledTimes(1);
  });

  it("CR-02: a synchronously-resolving auth phase produces a real REQ resend whose reply is observed", async () => {
    // waitForAuth: [] is an already-satisfied requirement (empty array), so per D-11 the shared
    // operator's wait resolves synchronously the instant the (synchronous, non-Promise-returning)
    // handler returns — driving the resubscribe from inside the very CLOSED-message dispatch that
    // delivered auth-required. This is the exact reentrancy CR-02 describes; an async handler always
    // worked correctly even against the pre-Task-1 code (13-05 precedent for the same defect class in
    // event()).
    const onAuthRequired = vi.fn();

    const spy = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1", onAuthRequired, waitForAuth: [] }));

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
    server.send(["CLOSED", "sub1", "auth-required: need to authenticate"]);

    // The resend must actually reach the wire — against pre-Task-1 req() this second REQ frame never
    // arrived (the socket saw exactly one REQ frame and the subscriber silently completed with 0 events).
    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
    expect(spy.receivedComplete()).toBe(false);

    // Non-vacuity: asserting only the frame count would still pass against a resend that reaches the
    // wire but joins a dead listen chain (count()'s pre-13-10 CR-03 shape) — the reply must be observed.
    server.send(["EVENT", "sub1", mockEvent]);
    server.send(["EOSE", "sub1"]);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(spy.getValues().some((v: any) => v.type === "EVENT" && v.event.id === mockEvent.id)).toBe(true);
    expect(onAuthRequired).toHaveBeenCalledTimes(1);

    spy.unsubscribe();
  });

  it("RAUTH-07 (inheritance leg): subscription()'s REQ resend is bounded exactly like req()'s own, not an unbounded loop", async () => {
    // Short — exists to prove subscription() inherits req()'s bound rather than re-testing the
    // mechanism, which the two tests above already cover directly on req().
    const onAuthRequired = vi.fn(() => {
      relay.authenticationResponse$.next({ ok: true, from: relay.url });
    });

    const spy = subscribeSpyTo(
      relay.subscription({ kinds: [1] }, { id: "sub1", onAuthRequired, authTimeout: 50 }),
      { expectErrors: true },
    );

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
    server.send(["CLOSED", "sub1", "auth-required: need to authenticate"]);

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
    server.send(["CLOSED", "sub1", "auth-required: need to authenticate"]);

    await spy.onError();
    expect(spy.getError()).toBeInstanceOf(AuthRequiredError);

    const reqFrames = server.messages.filter((m: any) => m[0] === "REQ" && m[1] === "sub1");
    expect(reqFrames).toHaveLength(2);
    expect(onAuthRequired).toHaveBeenCalledTimes(1);
  });
});

describe("send", () => {
  it("should send a custom message to the server", async () => {
    // Force a connection
    subscribeSpyTo(relay.subscription({ kinds: [1] }));
    await server.nextMessage;

    relay.send(["CUSTOM", "message"]);
    await server.nextMessage;
    expect(server).toHaveReceivedMessages([["CUSTOM", "message"]]);
  });
});

describe("multiplex", () => {
  it("should use underlying sock multiplex", () => {
    vi.spyOn(Reflect.get(relay, "socket"), "multiplex");

    subscribeSpyTo(
      relay.multiplex(
        () => ["OPEN"],
        () => ["CLOSE"],
        () => true,
      ),
    );

    expect(Reflect.get(relay, "socket").multiplex).toHaveBeenCalled();
  });
});

describe("authenticate", () => {
  const signer = new FakeUser();

  it("should throw an error if challenge is not received", () => {
    expect(() => relay.authenticate(signer)).toThrow("Have not received authentication challenge");
  });

  it("should handle full authentication flow", async () => {
    subscribeSpyTo(relay.subscription([{ kinds: [1] }]));

    // Receive REQ
    await server.nextMessage;

    // Send AUTH challenge
    server.send(["AUTH", "challenge-string"]);

    // Wait for challenge
    await firstValueFrom(relay.challenge$.pipe(filter((c) => c !== null)));

    // Send AUTH
    relay.authenticate(signer);

    // Send AUTH response
    const auth = (await server.nextMessage) as ["AUTH", NostrEvent];
    server.send(["OK", auth[1].id, true, ""]);

    // Wait for authenticated
    await firstValueFrom(relay.authenticated$.pipe(filter((v) => v !== false)));
  });
});

describe("multi-user authentication", () => {
  const userA = new FakeUser();
  const userB = new FakeUser();

  /** Completes a NIP-42 auth flow for a signer and returns the auth response */
  async function authenticateUser(user: FakeUser) {
    const promise = relay.authenticate(user);
    const message = (await server.nextMessage) as [string, NostrEvent];
    expect(message[0]).toBe("AUTH");
    server.send(["OK", message[1].id, true, ""]);
    return await promise;
  }

  /** Opens a connection and waits for an AUTH challenge from the relay */
  async function connectAndReceiveChallenge() {
    subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1" }));
    await server.nextMessage; // REQ
    server.send(["AUTH", "challenge-string"]);
    await firstValueFrom(relay.challenge$.pipe(filter((c) => c !== null)));
  }

  it("should track multiple authenticated users", async () => {
    await connectAndReceiveChallenge();

    await authenticateUser(userA);
    await authenticateUser(userB);

    expect(relay.authenticatedPubkeys).toEqual([userA.pubkey, userB.pubkey]);
    expect(relay.isAuthenticated(userA.pubkey)).toBe(true);
    expect(relay.isAuthenticated([userA.pubkey, userB.pubkey])).toBe(true);
    expect(relay.authenticated).toBe(true);
    expect(relay.authenticatedAs).toBe(userB.pubkey);
  });

  it("should track failed authentication per pubkey and allow re-authentication", async () => {
    await connectAndReceiveChallenge();

    await authenticateUser(userA);

    // userB fails to authenticate
    const failed = relay.authenticate(userB);
    const message = (await server.nextMessage) as [string, NostrEvent];
    server.send(["OK", message[1].id, false, "restricted: not allowed"]);
    await failed;

    expect(relay.isAuthenticated(userA.pubkey)).toBe(true);
    expect(relay.isAuthenticated(userB.pubkey)).toBe(false);
    expect(relay.isAuthenticated([userA.pubkey, userB.pubkey])).toBe(false);
    expect(relay.authenticatedPubkeys).toEqual([userA.pubkey]);

    // userB retries and succeeds
    await authenticateUser(userB);
    expect(relay.isAuthenticated(userB.pubkey)).toBe(true);
  });

  it("should mirror the most recent authentication on deprecated subjects", async () => {
    await connectAndReceiveChallenge();

    await authenticateUser(userA);
    await authenticateUser(userB);

    expect(relay.authentication?.pubkey).toBe(userB.pubkey);
    expect(relay.authenticationResponse?.ok).toBe(true);
  });

  it("should clear authentication state on disconnect", async () => {
    await connectAndReceiveChallenge();
    await authenticateUser(userA);
    expect(relay.authenticatedPubkeys).toEqual([userA.pubkey]);

    server.close();
    await server.closed;

    expect(relay.authentications$.value).toEqual({});
    expect(relay.authenticated).toBe(false);
    expect(relay.authenticatedPubkeys).toEqual([]);
  });

  it("should wait for the specified pubkey to authenticate before retrying a REQ", async () => {
    subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1", waitForAuth: userB.pubkey }));

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
    server.send(["AUTH", "challenge-string"]);
    server.send(["CLOSED", "sub1", "auth-required: need to authenticate"]);

    // userA authenticates, but the REQ should not be retried for them
    await authenticateUser(userA);

    // The next client message must be userB's AUTH, not a resent REQ
    const authB = relay.authenticate(userB);
    const message = (await server.nextMessage) as [string, NostrEvent];
    expect(message[0]).toBe("AUTH");
    server.send(["OK", message[1].id, true, ""]);
    await authB;

    // Now that userB is authenticated the REQ is resent
    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
  });

  it("should wait for all pubkeys in an array to authenticate before retrying a REQ", async () => {
    subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1", waitForAuth: [userA.pubkey, userB.pubkey] }));

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
    server.send(["AUTH", "challenge-string"]);
    server.send(["CLOSED", "sub1", "auth-required: need to authenticate"]);

    // Only one of the two required users authenticates
    await authenticateUser(userA);

    // The next client message must be userB's AUTH, not a resent REQ
    const authB = relay.authenticate(userB);
    const message = (await server.nextMessage) as [string, NostrEvent];
    expect(message[0]).toBe("AUTH");
    server.send(["OK", message[1].id, true, ""]);
    await authB;

    // Both users are authenticated so the REQ is resent
    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
  });

  it("should wait for the specified pubkey to authenticate before retrying a publish", async () => {
    const promise = relay.publish(mockEvent, {
      retries: { count: Infinity, delay: 0 },
      waitForAuth: userB.pubkey,
    });

    await expect(server).toReceiveMessage(["EVENT", mockEvent]);
    server.send(["AUTH", "challenge-string"]);
    server.send(["OK", mockEvent.id, false, "auth-required: need to authenticate"]);

    // userA authenticates, but the EVENT should not be retried for them
    await authenticateUser(userA);

    // The next client message must be userB's AUTH, not a resent EVENT
    const authB = relay.authenticate(userB);
    const message = (await server.nextMessage) as [string, NostrEvent];
    expect(message[0]).toBe("AUTH");
    server.send(["OK", message[1].id, true, ""]);
    await authB;

    // Now that userB is authenticated the EVENT is resent
    await expect(server).toReceiveMessage(["EVENT", mockEvent]);
    server.send(["OK", mockEvent.id, true, ""]);

    await expect(promise).resolves.toEqual({ ok: true, message: "", from: "wss://test" });
  });
});

describe("count", () => {
  it("should trigger connection to relay", async () => {
    subscribeSpyTo(relay.count([{ kinds: [1] }], "count1"));

    // Wait for connection
    await firstValueFrom(relay.connected$.pipe(filter(Boolean)));

    expect(relay.connected).toBe(true);
  });

  it("should send expected messages to relay", async () => {
    subscribeSpyTo(relay.count([{ kinds: [1] }], "count1"));

    await expect(server).toReceiveMessage(["COUNT", "count1", { kinds: [1] }]);
  });

  it("should emit count response", async () => {
    const spy = subscribeSpyTo(relay.count([{ kinds: [1] }], "count1"));
    await server.connected;

    // Send COUNT response
    server.send(["COUNT", "count1", { count: 42 }]);

    expect(spy.getValues()).toEqual([{ count: 42 }]);
    expect(spy.receivedComplete()).toBe(true);
  });

  it("should ignore COUNT responses that do not match subscription id", async () => {
    const spy = subscribeSpyTo(relay.count([{ kinds: [1] }], "count1"));
    await server.connected;

    // Send COUNT response with wrong subscription id
    server.send(["COUNT", "wrong_count", { count: 42 }]);

    // Send COUNT response with correct subscription id
    server.send(["COUNT", "count1", { count: 24 }]);

    expect(spy.getValues()).toEqual([{ count: 24 }]);
  });

  it("should complete subscription when CLOSED message is received", async () => {
    const spy = subscribeSpyTo(relay.count([{ kinds: [1] }], "count1"));
    await server.connected;

    // Send CLOSED message for the subscription
    server.send(["CLOSED", "count1", "reason"]);

    // Verify the subscription completed cleanly (not errored)
    await spy.onComplete();
    expect(spy.receivedComplete()).toBe(true);
    expect(spy.receivedError()).toBe(false);
  });

  it("should error if no COUNT response received within timeout", async () => {
    vi.useFakeTimers();

    const spy = subscribeSpyTo(relay.count([{ kinds: [1] }], "count1"), { expectErrors: true });

    // Fast-forward time by 10 seconds
    vi.advanceTimersByTime(10000);
    await Promise.resolve();

    expect(spy.receivedError()).toBe(true);
    expect(spy.getError()?.message).toBe("COUNT timeout");
  });

  it("should not send multiple COUNT messages for multiple subscriptions", async () => {
    const sub = relay.count([{ kinds: [1] }], "count1");
    sub.subscribe();
    sub.subscribe();
    sub.subscribe();
    sub.subscribe();

    // Wait for connection
    await server.connected;

    // Consume all messages
    while (server.messagesToConsume.pendingItems.length > 0) await server.nextMessage;

    // Wait for all messages to be sent
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(server.messages).toEqual([["COUNT", "count1", { kinds: [1] }]]);
  });

  it("should wait when relay isn't ready", async () => {
    // @ts-expect-error
    relay._ready$.next(false);

    subscribeSpyTo(relay.count([{ kinds: [1] }], "count1"));

    // Wait 10ms to ensure the relay didn't receive anything
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(server.messages.length).toBe(0);

    // @ts-expect-error
    relay._ready$.next(true);

    await expect(server).toReceiveMessage(["COUNT", "count1", { kinds: [1] }]);
  });

  it("should handle multiple filters", async () => {
    const spy = subscribeSpyTo(relay.count([{ kinds: [1] }, { kinds: [2] }], "count1"));
    await server.connected;

    // Send COUNT response
    server.send(["COUNT", "count1", { count: 7 }]);

    expect(spy.getValues()).toEqual([{ count: 7 }]);
  });
});

describe("operation-scoped COUNT auth (13-04)", () => {
  it("RAUTH-02: a fresh COUNT is sent immediately while an earlier, unrelated REQ is auth-blocked", async () => {
    const reqSpy = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "a", authTimeout: 30 }), { expectErrors: true });
    await expect(server).toReceiveMessage(["REQ", "a", { kinds: [1] }]);

    // "a" is told auth is required — the old pre-block would have made a fresh COUNT wait behind this
    server.send(["CLOSED", "a", "auth-required: need to authenticate"]);

    const countSpy = subscribeSpyTo(relay.count([{ kinds: [1] }], "count1"));

    // The COUNT must be sent immediately, before any AUTH frame is ever sent
    await expect(server).toReceiveMessage(["COUNT", "count1", { kinds: [1] }]);
    expect(server.messages.some((m: any) => m[0] === "AUTH")).toBe(false);

    reqSpy.unsubscribe();
    countSpy.unsubscribe();
  });

  it("RAUTH-01: invokes onAuthRequired with the full operation-local context", async () => {
    const onAuthRequired = vi.fn().mockResolvedValue(undefined);
    const spy = subscribeSpyTo(relay.count([{ kinds: [1] }], "count1", { onAuthRequired, authTimeout: 50 }), {
      expectErrors: true,
    });

    await expect(server).toReceiveMessage(["COUNT", "count1", { kinds: [1] }]);
    server.send(["AUTH", "challenge-xyz"]);
    server.send(["CLOSED", "count1", "auth-required: need to authenticate"]);

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(onAuthRequired).toHaveBeenCalledTimes(1);
    expect(onAuthRequired).toHaveBeenCalledWith({
      relay,
      url: relay.url,
      challenge: "challenge-xyz",
      request: { verb: "COUNT", id: "count1", filters: [{ kinds: [1] }] },
      requirement: true,
      missingPubkeys: null,
      reason: "auth-required: need to authenticate",
    });

    spy.unsubscribe();
  });

  it("RAUTH-03: retries exactly once by default and resends the COUNT after the handler authenticates", async () => {
    const user = new FakeUser();
    const onAuthRequired = vi.fn(async () => {
      await relay.authenticate(user);
    });

    const spy = subscribeSpyTo(relay.count([{ kinds: [1] }], "count1", { onAuthRequired }));

    await expect(server).toReceiveMessage(["COUNT", "count1", { kinds: [1] }]);
    server.send(["AUTH", "challenge-1"]);
    server.send(["CLOSED", "count1", "auth-required: need to authenticate"]);

    const authMsg = (await server.nextMessage) as [string, NostrEvent];
    expect(authMsg[0]).toBe("AUTH");
    server.send(["OK", authMsg[1].id, true, ""]);

    await expect(server).toReceiveMessage(["COUNT", "count1", { kinds: [1] }]);

    server.send(["COUNT", "count1", { count: 3 }]);

    await spy.onComplete();

    const countFrames = server.messages.filter((m: any) => m[0] === "COUNT" && m[1] === "count1");
    expect(countFrames).toHaveLength(2);
    expect(onAuthRequired).toHaveBeenCalledTimes(1);
    expect(spy.getValues()).toEqual([{ count: 3 }]);
  });

  it("RAUTH-03: authRetries:2 allows three COUNT frames total", async () => {
    const user = new FakeUser();
    const onAuthRequired = vi.fn(async () => {
      if (!relay.isAuthenticated(user.pubkey)) await relay.authenticate(user);
    });

    const spy = subscribeSpyTo(relay.count([{ kinds: [1] }], "count1", { onAuthRequired, authRetries: 2 }));

    await expect(server).toReceiveMessage(["COUNT", "count1", { kinds: [1] }]);
    server.send(["AUTH", "challenge-1"]);
    server.send(["CLOSED", "count1", "auth-required: need to authenticate"]);

    const authMsg = (await server.nextMessage) as [string, NostrEvent];
    server.send(["OK", authMsg[1].id, true, ""]);

    await expect(server).toReceiveMessage(["COUNT", "count1", { kinds: [1] }]);

    // The relay demands auth again on the second attempt (already-authenticated user, no new AUTH round trip)
    server.send(["CLOSED", "count1", "auth-required: need to authenticate"]);

    await expect(server).toReceiveMessage(["COUNT", "count1", { kinds: [1] }]);

    server.send(["COUNT", "count1", { count: 9 }]);

    await spy.onComplete();

    const countFrames = server.messages.filter((m: any) => m[0] === "COUNT" && m[1] === "count1");
    expect(countFrames).toHaveLength(3);
    expect(onAuthRequired).toHaveBeenCalledTimes(2);
    expect(spy.getValues()).toEqual([{ count: 9 }]);
  });

  it("RAUTH-03: authRetries:0 exhausts immediately without invoking the handler or retrying", async () => {
    const onAuthRequired = vi.fn();
    const spy = subscribeSpyTo(relay.count([{ kinds: [1] }], "count1", { onAuthRequired, authRetries: 0 }), {
      expectErrors: true,
    });

    await expect(server).toReceiveMessage(["COUNT", "count1", { kinds: [1] }]);
    server.send(["CLOSED", "count1", "auth-required: need to authenticate"]);

    await spy.onError();

    expect(spy.getError()).toBeInstanceOf(AuthRequiredError);
    expect(onAuthRequired).not.toHaveBeenCalled();

    const countFrames = server.messages.filter((m: any) => m[0] === "COUNT" && m[1] === "count1");
    expect(countFrames).toHaveLength(1);
  });

  it("RAUTH-04: a short authTimeout errors with AuthTimeoutError when the requirement is never satisfied", async () => {
    const onAuthRequired = vi.fn();
    const spy = subscribeSpyTo(relay.count([{ kinds: [1] }], "count1", { onAuthRequired, authTimeout: 30 }), {
      expectErrors: true,
    });

    await expect(server).toReceiveMessage(["COUNT", "count1", { kinds: [1] }]);
    server.send(["CLOSED", "count1", "auth-required: need to authenticate"]);

    await spy.onError();

    expect(spy.getError()).toBeInstanceOf(AuthTimeoutError);
    expect(onAuthRequired).toHaveBeenCalledTimes(1);
  });

  it("RAUTH-04: a rejecting handler errors with AuthHandlerError carrying the rejection as cause", async () => {
    const cause = new Error("nope");
    const onAuthRequired = vi.fn().mockRejectedValue(cause);
    const spy = subscribeSpyTo(relay.count([{ kinds: [1] }], "count1", { onAuthRequired }), { expectErrors: true });

    await expect(server).toReceiveMessage(["COUNT", "count1", { kinds: [1] }]);
    server.send(["CLOSED", "count1", "auth-required: need to authenticate"]);

    await spy.onError();

    expect(spy.getError()).toBeInstanceOf(AuthHandlerError);
    expect((spy.getError() as AuthHandlerError).cause).toBe(cause);
  });

  it("RAUTH-06: waitForAuth:false never invokes the handler and errors with AuthRequiredError", async () => {
    const onAuthRequired = vi.fn();
    const spy = subscribeSpyTo(relay.count([{ kinds: [1] }], "count1", { waitForAuth: false, onAuthRequired }), {
      expectErrors: true,
    });

    await expect(server).toReceiveMessage(["COUNT", "count1", { kinds: [1] }]);
    server.send(["CLOSED", "count1", "auth-required: need to authenticate"]);

    await spy.onError();

    expect(spy.getError()).toBeInstanceOf(AuthRequiredError);
    expect(onAuthRequired).not.toHaveBeenCalled();
  });

  it("D-02/D-03: a non-auth CLOSED prefix still throws RelayClosedError immediately, without invoking the handler", async () => {
    const onAuthRequired = vi.fn();
    const spy = subscribeSpyTo(relay.count([{ kinds: [1] }], "count1", { onAuthRequired }), { expectErrors: true });

    await expect(server).toReceiveMessage(["COUNT", "count1", { kinds: [1] }]);
    server.send(["CLOSED", "count1", "restricted: not allowed"]);

    await spy.onError();

    expect(spy.getError()).toBeInstanceOf(RelayClosedError);
    expect(spy.getError()).not.toBeInstanceOf(AuthRequiredError);
    expect(onAuthRequired).not.toHaveBeenCalled();
  });

  it("RAUTH-09: authRequiredForRead$ flips true when a COUNT receives auth-required", async () => {
    subscribeSpyTo(relay.count([{ kinds: [1] }], "count1", { authTimeout: 30 }), { expectErrors: true });

    const flagSpy = subscribeSpyTo(relay.authRequiredForRead$);
    expect(flagSpy.getLastValue()).toBe(false);

    await expect(server).toReceiveMessage(["COUNT", "count1", { kinds: [1] }]);
    server.send(["CLOSED", "count1", "auth-required: need to authenticate"]);

    // Check immediately (not after a delay): this fixture's keepAlive=0 is a pre-existing quirk that
    // lets the connection drop and resetState() clear the flag again once nothing has resubscribed
    // for a few ms — orthogonal to what RAUTH-09 asserts here (the flag flips true the instant
    // auth-required is received)
    expect(flagSpy.getLastValue()).toBe(true);
  });

  it("D-15: count()'s 10s clock is suspended across the auth phase", async () => {
    // D-20 mandates real timers and no mocked time advance, and count()'s 10s budget is not
    // user-configurable (unlike request()'s opts.timeout), so a literal >10s real-time wait would
    // be the only other way to observe this. Instead, spy on the real global setTimeout and assert
    // the operation-clock timer is re-armed with (approximately) its full original budget after the
    // auth phase closes, rather than the auth-wait duration having been deducted from it — this is
    // "real ordering" (genuine setTimeout calls made by suspendableTimeout), not a mocked advance,
    // and fails RED against a reverted bare `timeout({first: 10_000, ...})` implementation, which
    // arms exactly once for the operation's whole lifetime and never re-arms around an auth phase.
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const onAuthRequired = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      relay.authenticationResponse$.next({ ok: true, from: "wss://test" });
    });

    const spy = subscribeSpyTo(relay.count([{ kinds: [1] }], "count1", { onAuthRequired, authTimeout: false }));

    await expect(server).toReceiveMessage(["COUNT", "count1", { kinds: [1] }]);
    server.send(["CLOSED", "count1", "auth-required: need to authenticate"]);

    await expect(server).toReceiveMessage(["COUNT", "count1", { kinds: [1] }]);
    server.send(["COUNT", "count1", { count: 5 }]);

    await spy.onComplete();

    // The COUNT succeeded despite the auth interruption, rather than producing a COUNT-timeout error
    expect(spy.getValues()).toEqual([{ count: 5 }]);
    expect(spy.receivedError()).toBe(false);

    // The 10s clock was armed (before the auth phase) and re-armed (after it closed) with
    // essentially its full original budget, not `10_000 - the ~30ms auth wait`
    const fullBudgetArms = setTimeoutSpy.mock.calls.filter(
      ([, delay]) => typeof delay === "number" && delay > 9000,
    );
    expect(fullBudgetArms.length).toBeGreaterThanOrEqual(2);

    setTimeoutSpy.mockRestore();
  });
});

describe("operation-scoped COUNT auth gap closure (13-10, CR-03)", () => {
  it("T-13-10-01 (COUNT leg of RESEARCH gap 1): a persistently auth-requiring relay receives exactly authRetries + 1 COUNT frames, then a terminal AuthRequiredError, with the default retries left in place", async () => {
    // Synchronous handler — this is exactly what CR-03 dropped: driving the shared operator's
    // resubscribe from inside the very CLOSED dispatch that delivered auth-required. Against pre-Task-1
    // count(), the resend reached the wire (the verifier observed 2 COUNT frames) but joined a listen
    // chain that was already tearing down, so a genuine reply was never observed.
    const onAuthRequired = vi.fn(() => {
      relay.authenticationResponse$.next({ ok: true, from: relay.url });
    });

    const spy = subscribeSpyTo(relay.count([{ kinds: [1] }], "count1", { onAuthRequired, authTimeout: 50 }), {
      expectErrors: true,
    });

    // First COUNT
    await expect(server).toReceiveMessage(["COUNT", "count1", { kinds: [1] }]);
    server.send(["CLOSED", "count1", "auth-required: need to authenticate"]);

    // Second (and last) COUNT — authRetries defaults to 1, so authRetries + 1 = 2 total sends
    await expect(server).toReceiveMessage(["COUNT", "count1", { kinds: [1] }]);
    server.send(["CLOSED", "count1", "auth-required: need to authenticate"]);

    await spy.onError();
    expect(spy.getError()).toBeInstanceOf(AuthRequiredError);

    // Non-vacuity: count() has no separate outer retry/backoff layer of its own (unlike req()'s
    // customConnectionRetryOperator or publish()'s customRetryOperator), so this wait exists purely to
    // prove the assertion below cannot pass vacuously just because a hypothetical extra resend hadn't
    // fired yet — not a real backoff window count() has to skip.
    await new Promise((resolve) => setTimeout(resolve, 200));

    const countFrames = server.messages.filter((m: any) => m[0] === "COUNT" && m[1] === "count1");
    expect(countFrames).toHaveLength(2);
    expect(onAuthRequired).toHaveBeenCalledTimes(1);
  });

  it("CR-03: a synchronously-resolving auth phase produces a real COUNT resend whose reply is observed", async () => {
    // waitForAuth: [] is an already-satisfied requirement (empty array), so per D-11 the shared
    // operator's wait resolves synchronously the instant the (synchronous, non-Promise-returning)
    // handler returns — driving the resubscribe from inside the very CLOSED-message dispatch that
    // delivered auth-required. This is the exact reentrancy CR-03 describes.
    const onAuthRequired = vi.fn();

    const spy = subscribeSpyTo(relay.count([{ kinds: [1] }], "count1", { onAuthRequired, waitForAuth: [] }));

    await expect(server).toReceiveMessage(["COUNT", "count1", { kinds: [1] }]);
    server.send(["CLOSED", "count1", "auth-required: need to authenticate"]);

    // The resend must actually reach the wire — against pre-Task-1 count() the verifier observed the
    // second COUNT frame reaching the wire too (["COUNT","COUNT","CLOSE","CLOSE"]), so frame count alone
    // is not acceptance; the point is whether the reply below is ever actually observed.
    await expect(server).toReceiveMessage(["COUNT", "count1", { kinds: [1] }]);
    expect(spy.receivedComplete()).toBe(false);

    // The delay is the point — it is what the verifier used to demonstrate a genuine reply is never
    // observed against the pre-fix code (a real COUNT reply sent 50ms later never reached the
    // subscriber, which had already completed with zero values).
    await new Promise((resolve) => setTimeout(resolve, 50));
    server.send(["COUNT", "count1", { count: 7 }]);

    await spy.onComplete();

    // The final attempt's take(1) completion sends a CLOSE frame; wait for the mock server to actually
    // receive it before asserting the exact frame count below.
    await expect(server).toReceiveMessage(["CLOSE", "count1"]);

    expect(spy.getValues()).toEqual([{ count: 7 }]);
    expect(onAuthRequired).toHaveBeenCalledTimes(1);

    // Pins CR-03's redundant-CLOSE regression: the first attempt's auth-required CLOSED already marks
    // that attempt's own relayClosedSub, so its finalize skips the CLOSE frame; only the second
    // (successful) attempt's clean take(1) completion sends one. Against the pre-fix code the verifier
    // observed 2 CLOSE frames (one redundant) alongside the never-observed reply.
    const closeFrames = server.messages.filter((m: any) => m[0] === "CLOSE" && m[1] === "count1");
    expect(closeFrames).toHaveLength(1);
  });
});

describe("close", () => {
  it("should close the socket", async () => {
    subscribeSpyTo(relay.req([{ kinds: [1] }]));
    await server.connected;

    relay.close();
    await server.closed;
    expect(relay.connected).toBe(false);
  });

  it("should complete the internal ready$ source so the watchTower cannot re-arm reconnect", async () => {
    const sub = subscribeSpyTo(relay.req([{ kinds: [1] }]));
    await server.connected;
    expect(relay.ready).toBe(true);

    relay.close();
    sub.unsubscribe();

    // close() is terminal: ready must be flipped false (trips the startReconnectTimer guard)
    // and the source completed so nothing can keep it resolvable
    expect(relay.ready).toBe(false);
    expect((relay as any)._ready$.isStopped).toBe(true);
  });

  it("should cancel a pending reconnect timer so it cannot fire after close", async () => {
    vi.useFakeTimers();
    // Long backoff like the real exponential reconnect timer (capped at 5 minutes)
    relay.reconnectTimer = () => timer(300_000);

    const sub = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1" }), { expectErrors: true });

    // Simulate an unclean disconnect -> arms the reconnect timer and flips ready false
    server.error({ reason: "relay crashed", code: 1006, wasClean: false });
    await Promise.resolve();
    expect(relay.ready).toBe(false);

    // Full shutdown: unsubscribe consumers and close the relay
    sub.unsubscribe();
    relay.close();
    await Promise.resolve();

    // The reconnect timer must have been cancelled: advancing past the backoff
    // should NOT flip the relay back to ready (a surviving timer would keep the
    // event loop alive and reconnect after the consumer asked to shut down).
    vi.advanceTimersByTime(300_000);
    await Promise.resolve();
    expect(relay.ready).toBe(false);
  });

  it("should cancel the keepAlive reset timer armed at refcount-zero so it cannot hold the event loop open", async () => {
    vi.useFakeTimers();
    relay.keepAlive = 30_000; // override the beforeEach default of 0

    // Track pending timers by their delay so we can isolate the keepAlive timer
    // from unrelated mock-socket timers (which use small delays). RxJS's `timer()`
    // schedules through setInterval, so we wrap that (not setTimeout).
    const faked = globalThis.setInterval;
    const fakedClear = globalThis.clearInterval;
    const pending = new Map<any, number>();
    // @ts-expect-error wrap the faked interval to record delays
    globalThis.setInterval = (fn: any, ms?: any, ...args: any[]) => {
      const id = faked(fn, ms, ...args);
      pending.set(id, ms);
      return id;
    };
    // @ts-expect-error wrap the faked clear to drop tracked timers
    globalThis.clearInterval = (id: any) => {
      pending.delete(id);
      return fakedClear(id);
    };

    try {
      const sub = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1" }));
      await vi.advanceTimersByTimeAsync(0);

      // refcount -> 0 arms timer(keepAlive) inside the watchTower's share()
      sub.unsubscribe();
      const armed = [...pending.values()].filter((ms) => ms === 30_000).length;
      expect(armed).toBeGreaterThan(0); // sanity: the keepAlive timer was actually armed

      // close() must cancel it so the process can exit without waiting out keepAlive
      relay.close();
      const surviving = [...pending.values()].filter((ms) => ms === 30_000).length;
      expect(surviving).toBe(0);
    } finally {
      globalThis.setInterval = faked;
      globalThis.clearInterval = fakedClear;
    }
  });
});

describe("negentropy", () => {
  beforeEach(() => {
    // Mock relay to support NIP-77
    vi.spyOn(relay, "getSupported").mockResolvedValue([1, 77]);
  });

  it("should throw error if relay does not support NIP-77", async () => {
    vi.spyOn(relay, "getSupported").mockResolvedValue([1, 2, 3]);

    const store: NostrEvent[] = [];
    const filter = { kinds: [1] };
    const reconcile = vi.fn().mockResolvedValue(undefined);

    await expect(relay.negentropy(store, filter, reconcile)).rejects.toThrow("Relay does not support NIP-77");
  });

  it("should send NEG-OPEN when starting sync", async () => {
    const store: NostrEvent[] = [];
    const filter = { kinds: [1] };
    const reconcile = vi.fn().mockResolvedValue(undefined);

    // Start negentropy sync
    const negPromise = relay.negentropy(store, filter, reconcile).catch(() => {});

    // Wait for connection and NEG-OPEN message
    await server.connected;
    const negOpenMsg = (await server.nextMessage) as any[];
    expect(negOpenMsg[0]).toBe("NEG-OPEN");
    expect(negOpenMsg[2]).toEqual(filter);
    expect(typeof negOpenMsg[1]).toBe("string"); // negId

    // Send error to end the test
    server.send(["NEG-ERR", negOpenMsg[1], "test done"]);
    await negPromise;
  });

  it("should handle NEG-ERR messages by throwing an error", async () => {
    const store: NostrEvent[] = [];
    const filter = { kinds: [1] };
    const reconcile = vi.fn().mockResolvedValue(undefined);

    const negPromise = relay.negentropy(store, filter, reconcile);

    await server.connected;
    const negOpenMsg = (await server.nextMessage) as any[];
    const negId = negOpenMsg[1] as string;

    // Send error response
    server.send(["NEG-ERR", negId, "Something went wrong"]);

    // Verify the promise rejects with the error
    await expect(negPromise).rejects.toThrow("Something went wrong");

    // NEG-CLOSE should still be sent
    await expect(server).toReceiveMessage(["NEG-CLOSE", negId]);
  });

  it("should support abort signal to cancel sync", async () => {
    const store: NostrEvent[] = [];
    const filter = { kinds: [1] };
    const reconcile = vi.fn().mockResolvedValue(undefined);
    const controller = new AbortController();

    // Abort immediately before starting sync
    controller.abort();

    const negPromise = relay.negentropy(store, filter, reconcile, { signal: controller.signal });

    // Should return false when aborted
    const result = await negPromise;
    expect(result).toBe(false);

    // Verify reconcile was never called since we aborted before sync started
    expect(reconcile).not.toHaveBeenCalled();
  });
});

describe("sync", () => {
  beforeEach(() => {
    // Mock relay to support NIP-77
    vi.spyOn(relay, "getSupported").mockResolvedValue([1, 77]);
  });

  it("should return an observable that completes when sync is complete", async () => {
    const store: NostrEvent[] = [];
    const filter = { kinds: [1] };

    const spy = subscribeSpyTo(relay.sync(store, filter), { expectErrors: true });

    await server.connected;
    const negOpenMsg = (await server.nextMessage) as any[];
    const negId = negOpenMsg[1] as string;

    // Send error to trigger completion
    server.send(["NEG-ERR", negId, "test complete"]);

    // Wait for error (which triggers observable to error out)
    await spy.onError();

    // Verify observable completed (with error in this case)
    expect(spy.receivedError()).toBe(true);
    expect(spy.getError()?.message).toBe("test complete");
  });

  it("should handle errors during sync", async () => {
    const store: NostrEvent[] = [];
    const filter = { kinds: [1] };

    const spy = subscribeSpyTo(relay.sync(store, filter), { expectErrors: true });

    await server.connected;
    const negOpenMsg = (await server.nextMessage) as any[];
    const negId = negOpenMsg[1] as string;

    // Send error
    server.send(["NEG-ERR", negId, "Sync failed"]);

    // Wait for error
    await spy.onError();

    // Verify observable errored
    expect(spy.receivedError()).toBe(true);
    expect(spy.getError()?.message).toBe("Sync failed");
  });

  it("should send NEG-CLOSE when observable is unsubscribed", async () => {
    const store: NostrEvent[] = [];
    const filter = { kinds: [1] };

    const spy = subscribeSpyTo(relay.sync(store, filter), { expectErrors: true });

    await server.connected;
    const negOpenMsg = (await server.nextMessage) as any[];
    const negId = negOpenMsg[1] as string;

    // Unsubscribe before completion - this should trigger NEG-CLOSE
    spy.unsubscribe();

    // Wait and verify NEG-CLOSE was sent
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.messages.some((m) => m[0] === "NEG-CLOSE" && m[1] === negId)).toBe(true);
  });

  it("should complete observable when relay disconnect during sync", async () => {
    const store: NostrEvent[] = [];
    const filter = { kinds: [1] };

    const spy = subscribeSpyTo(relay.sync(store, filter), { expectErrors: true });

    await server.connected;
    await server.nextMessage; // NEG-OPEN

    // Close connection during sync
    server.close({ wasClean: false, code: 1006, reason: "Connection lost" });

    // Should error the observable
    await spy.onError();
    expect(spy.receivedError()).toBe(true);
  });
});

describe("operation-scoped negentropy/sync auth (13-06)", () => {
  beforeEach(() => {
    // Mock relay to support NIP-77
    vi.spyOn(relay, "getSupported").mockResolvedValue([1, 77]);
  });

  /**
   * Drives one full round trip of the real NIP-77 protocol against the mock server: builds a fresh
   * server-side `Negentropy` storage from `serverIds`, reconciles it against the client's NEG-OPEN
   * initial message, and sends the response as a NEG-MSG. With both sides holding fewer than 32 items
   * this always resolves the negotiation in a single round trip (see `lib/negentropy.ts`'s
   * `splitRange` — small ranges go straight to an IdList frame), so `reconcile(have, need)` on the
   * client fires exactly once with genuine have/need arrays. No existing test in this suite drives a
   * completed negotiation; RAUTH-08 needs one to reach sync()'s internal event()/req() calls.
   */
  async function serverRespondToNegOpen(negOpenMsg: any[], serverIds: string[]) {
    const serverStorage = new NegentropyStorageVector();
    for (const id of serverIds) serverStorage.insert(0, id);
    serverStorage.seal();
    const serverNe = new Negentropy(serverStorage);
    const [responseMsg] = await serverNe.reconcile<string>(negOpenMsg[3]);
    server.send(["NEG-MSG", negOpenMsg[1], responseMsg]);
  }

  it("RAUTH-02: after an earlier REQ received auth-required, a fresh negentropy negotiation still sends its NEG-OPEN frame immediately", async () => {
    // Keep watchTower's connection alive independent of the auth-blocked REQ below: once that REQ's own
    // auth phase begins, its inner observable completes and unsubscribes from watchTower, and without
    // another subscriber holding the connection open this fixture's keepAlive=0 would drop it (and
    // resetState() would clear the flag) before negentropy() ever gets a chance to observe it — which
    // would make even the old pre-blocked negentropy() falsely "pass" for the wrong reason.
    subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "keepalive" }));
    await server.nextMessage; // drain the keepalive REQ frame

    // An earlier REQ is told auth is required — the old pre-block would have made a fresh negentropy
    // negotiation wait behind this flag. Non-vacuity: this assertion was observed RED (no NEG-OPEN
    // ever arrives) against the pre-task negentropy()'s ambient waitForAuth() wrapper.
    subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1", authTimeout: 30 }), { expectErrors: true });
    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
    server.send(["CLOSED", "sub1", "auth-required: need to authenticate"]);

    const reconcile = vi.fn().mockResolvedValue(undefined);
    const negPromise = relay.negentropy([], { kinds: [1] }, reconcile, { authTimeout: 30 }).catch(() => {});

    // The negotiation must send NEG-OPEN immediately, before any AUTH frame is ever sent
    const negOpenMsg = (await server.nextMessage) as any[];
    expect(negOpenMsg[0]).toBe("NEG-OPEN");
    expect(server.messages.some((m: any) => Array.isArray(m) && m[0] === "AUTH")).toBe(false);

    server.send(["NEG-ERR", negOpenMsg[1], "test done"]);
    await negPromise;
  });

  it('RAUTH-01/RAUTH-03: invokes onAuthRequired with operation "sync" and resends the negotiation after the handler authenticates', async () => {
    // Simulates out-of-band authentication landing on this connection (this suite's established
    // convention, e.g. 13-02-SUMMARY.md) rather than a live relay.authenticate() round trip —
    // negentropy() never subscribes watchTower, so a real AUTH challenge is never observed by
    // relay.challenge here.
    const onAuthRequired = vi.fn(() => {
      relay.authenticationResponse$.next({ ok: true, from: "wss://test" });
    });
    const reconcile = vi.fn().mockResolvedValue(undefined);

    const negPromise = relay.negentropy([], { kinds: [1] }, reconcile, { onAuthRequired }).catch(() => {});

    const negOpen1 = (await server.nextMessage) as any[];
    expect(negOpen1[0]).toBe("NEG-OPEN");
    server.send(["NEG-ERR", negOpen1[1], "auth-required: need to authenticate"]);

    // negentropySync's own per-attempt cleanup sends NEG-CLOSE as soon as the NEG-ERR rejects it
    await expect(server).toReceiveMessage(["NEG-CLOSE", negOpen1[1]]);

    const negOpen2 = (await server.nextMessage) as any[];
    expect(negOpen2[0]).toBe("NEG-OPEN");

    expect(onAuthRequired).toHaveBeenCalledTimes(1);
    expect(onAuthRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        request: { verb: "NEG-OPEN", id: negOpen1[1], filter: { kinds: [1] } },
        reason: "auth-required: need to authenticate",
      }),
    );

    server.send(["NEG-ERR", negOpen2[1], "test done"]);
    await negPromise;
  });

  it("RAUTH-03: a relay that keeps rejecting receives exactly authRetries + 1 NEG-OPEN frames (default authRetries:1)", async () => {
    const onAuthRequired = vi.fn(() => {
      relay.authenticationResponse$.next({ ok: true, from: "wss://test" });
    });
    const reconcile = vi.fn().mockResolvedValue(undefined);

    const negPromise = relay.negentropy([], { kinds: [1] }, reconcile, { onAuthRequired }).catch((err) => err);

    const negOpen1 = (await server.nextMessage) as any[];
    server.send(["NEG-ERR", negOpen1[1], "auth-required: need to authenticate"]);
    await expect(server).toReceiveMessage(["NEG-CLOSE", negOpen1[1]]);

    const negOpen2 = (await server.nextMessage) as any[];
    // The relay keeps rejecting even though the connection is now marked authenticated —
    // consecutive count reaches authRetries (1), so this second signal is terminal without a third
    // NEG-OPEN.
    server.send(["NEG-ERR", negOpen2[1], "auth-required: need to authenticate"]);

    const result = await negPromise;
    expect(result).toBeInstanceOf(AuthRequiredError);
    expect(onAuthRequired).toHaveBeenCalledTimes(1);

    const negOpenFrames = server.messages.filter((m: any) => Array.isArray(m) && m[0] === "NEG-OPEN");
    expect(negOpenFrames).toHaveLength(2);
  });

  it("RAUTH-03: authRetries:0 exhausts immediately without invoking the handler or retrying", async () => {
    const onAuthRequired = vi.fn();
    const reconcile = vi.fn().mockResolvedValue(undefined);

    const negPromise = relay
      .negentropy([], { kinds: [1] }, reconcile, { onAuthRequired, authRetries: 0 })
      .catch((err) => err);

    const negOpen = (await server.nextMessage) as any[];
    server.send(["NEG-ERR", negOpen[1], "auth-required: need to authenticate"]);

    const result = await negPromise;
    expect(result).toBeInstanceOf(AuthRequiredError);
    expect(onAuthRequired).not.toHaveBeenCalled();

    const negOpenFrames = server.messages.filter((m: any) => Array.isArray(m) && m[0] === "NEG-OPEN");
    expect(negOpenFrames).toHaveLength(1);
  });

  it("RAUTH-04: a short authTimeout rejects the negotiation with AuthTimeoutError", async () => {
    const onAuthRequired = vi.fn();
    const reconcile = vi.fn().mockResolvedValue(undefined);

    const negPromise = relay
      .negentropy([], { kinds: [1] }, reconcile, { onAuthRequired, authTimeout: 30 })
      .catch((err) => err);

    const negOpen = (await server.nextMessage) as any[];
    server.send(["NEG-ERR", negOpen[1], "auth-required: need to authenticate"]);

    const result = await negPromise;
    expect(result).toBeInstanceOf(AuthTimeoutError);
    expect(onAuthRequired).toHaveBeenCalledTimes(1);
  });

  it("RAUTH-04: a rejecting handler rejects the negotiation with AuthHandlerError carrying the rejection as cause", async () => {
    const cause = new Error("nope");
    const onAuthRequired = vi.fn().mockRejectedValue(cause);
    const reconcile = vi.fn().mockResolvedValue(undefined);

    const negPromise = relay.negentropy([], { kinds: [1] }, reconcile, { onAuthRequired }).catch((err) => err);

    const negOpen = (await server.nextMessage) as any[];
    server.send(["NEG-ERR", negOpen[1], "auth-required: need to authenticate"]);

    const result = await negPromise;
    expect(result).toBeInstanceOf(AuthHandlerError);
    expect((result as AuthHandlerError).cause).toBe(cause);
  });

  it("RAUTH-06: waitForAuth:false rejects immediately with AuthRequiredError without invoking the handler", async () => {
    const onAuthRequired = vi.fn();
    const reconcile = vi.fn().mockResolvedValue(undefined);

    const negPromise = relay
      .negentropy([], { kinds: [1] }, reconcile, { onAuthRequired, waitForAuth: false })
      .catch((err) => err);

    const negOpen = (await server.nextMessage) as any[];
    server.send(["NEG-ERR", negOpen[1], "auth-required: need to authenticate"]);

    const result = await negPromise;
    expect(result).toBeInstanceOf(AuthRequiredError);
    expect(onAuthRequired).not.toHaveBeenCalled();
  });

  it("Abort: aborting the caller's signal while an auth phase is pending resolves the sync rather than rejecting", async () => {
    const controller = new AbortController();
    const onAuthRequired = vi.fn(); // never authenticates — the abort, not the handler, must resolve this
    const reconcile = vi.fn().mockResolvedValue(undefined);

    const negPromise = relay.negentropy([], { kinds: [1] }, reconcile, {
      onAuthRequired,
      authTimeout: false,
      signal: controller.signal,
    });

    const negOpen = (await server.nextMessage) as any[];
    server.send(["NEG-ERR", negOpen[1], "auth-required: need to authenticate"]);

    // Give the auth phase a moment to start (handler invoked, now waiting on authSatisfied$)
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onAuthRequired).toHaveBeenCalledTimes(1);

    controller.abort();

    const result = await negPromise;
    expect(result).toBe(false);
  });

  it("RAUTH-09: authRequiredForRead$ flips true when a negentropy negotiation receives auth-required", async () => {
    // Keep the underlying connection alive across negentropySync's own per-attempt subscribe/unsubscribe
    // cycle (it sends NEG-CLOSE and tears down its socket subscription as soon as NEG-ERR arrives) —
    // negentropy() never touches watchTower, so without another subscriber holding the raw socket open
    // this fixture's keepAlive=0 would drop the connection (and resetState() would clear the flag) right
    // as the failed attempt's own subscription tears down.
    subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "keepalive" }));
    await server.nextMessage; // drain the keepalive REQ frame

    const flagSpy = subscribeSpyTo(relay.authRequiredForRead$);
    expect(flagSpy.getLastValue()).toBe(false);

    const reconcile = vi.fn().mockResolvedValue(undefined);
    const negPromise = relay.negentropy([], { kinds: [1] }, reconcile, { authTimeout: 30 }).catch(() => {});

    const negOpen = (await server.nextMessage) as any[];
    server.send(["NEG-ERR", negOpen[1], "auth-required: need to authenticate"]);

    // Unlike req()/count()/event() (whose flag update happens synchronously within the same
    // observer-notification stack as server.send), negentropy()'s auth-required detection runs inside
    // an async function's await continuation, which always resumes on a later microtask/task — so a
    // short real wait (rather than an immediate check) is what actually observes it here.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(flagSpy.getLastValue()).toBe(true);

    await negPromise;
  });

  it("RAUTH-08: sync()'s internal SEND-direction event() call invokes the caller's onAuthRequired", async () => {
    const onAuthRequired = vi.fn();

    const spy = subscribeSpyTo(
      relay.sync([mockEvent], { kinds: [1] }, SyncDirection.SEND, { onAuthRequired, authTimeout: 30 }),
      { expectErrors: true },
    );

    const negOpen = (await server.nextMessage) as any[];
    expect(negOpen[0]).toBe("NEG-OPEN");

    // The server's storage is empty, so the client's one local event is a "have" — the negotiation
    // completes in one round trip and sync() dispatches it as an internal EVENT send.
    await serverRespondToNegOpen(negOpen, []);

    await expect(server).toReceiveMessage(["EVENT", mockEvent]);
    server.send(["OK", mockEvent.id, false, "auth-required: need to authenticate"]);

    // This must fail RED against a sync() whose internal event() call passes no options — the caller's
    // handler would then be invoked only for the negentropy negotiation, never for the SEND-direction
    // EVENT. sync()'s SEND branch awaits Promise.allSettled over the internal event() call, which
    // itself waits out the short authTimeout above before settling, so waiting for sync() to complete
    // is sufficient synchronization (no arbitrary sleep needed).
    await spy.onComplete();

    expect(onAuthRequired).toHaveBeenCalledWith(
      expect.objectContaining({ request: { verb: "EVENT", event: mockEvent } }),
    );
  });

  it("RAUTH-08: sync()'s internal RECEIVE-direction req() call invokes the caller's onAuthRequired", async () => {
    const onAuthRequired = vi.fn();

    const spy = subscribeSpyTo(
      relay.sync([], { kinds: [1] }, SyncDirection.RECEIVE, { onAuthRequired, authTimeout: 30 }),
      { expectErrors: true },
    );

    const negOpen = (await server.nextMessage) as any[];
    expect(negOpen[0]).toBe("NEG-OPEN");

    // The server's storage has one event the client is missing — the negotiation completes in one
    // round trip and sync() dispatches an internal REQ to fetch it.
    await serverRespondToNegOpen(negOpen, [mockEvent.id]);

    const reqMsg = (await server.nextMessage) as any[];
    expect(reqMsg[0]).toBe("REQ");
    server.send(["CLOSED", reqMsg[1], "auth-required: need to authenticate"]);

    // This must fail RED against a sync() whose internal req() call passes no options — the caller's
    // handler would then be invoked only for the negentropy negotiation, never for the RECEIVE-direction
    // REQ. The internal req()'s auth phase times out (authTimeout: 30, nothing authenticates), which
    // propagates as a genuine error through sync() — waiting for it observes the handler invocation
    // without leaving a dangling timer behind.
    await spy.onError();

    expect(onAuthRequired).toHaveBeenCalledWith(
      expect.objectContaining({ request: { verb: "REQ", id: reqMsg[1], filters: [{ ids: [mockEvent.id] }] } }),
    );
  });
});

describe("message$", () => {
  it("should emit each relay message only once when sequential operations reuse the connection", async () => {
    // Keep the internal watcher alive between operations (the beforeEach sets keepAlive=0)
    relay.keepAlive = 30_000;

    const seen: any[] = [];
    relay.message$.subscribe((m) => seen.push(m));

    // First operation: publish an event
    const pub = relay.publish(mockEvent, { retries: false });
    await expect(server).toReceiveMessage(["EVENT", mockEvent]);
    server.send(["OK", mockEvent.id, true, ""]);
    await pub;

    // Second operation: a REQ that rejoins the connection within the keepAlive window
    subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1" }));
    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
    server.send(["EOSE", "sub1"]);

    // Third operation: another publish stacking one more potential watcher
    const pub2 = relay.publish({ ...mockEvent, id: "second-id" }, { retries: false });
    await expect(server).toReceiveMessage(["EVENT", { ...mockEvent, id: "second-id" }]);
    server.send(["OK", "second-id", true, ""]);
    await pub2;

    // Each message should have been processed exactly once
    expect(seen.filter((m) => m[0] === "EOSE")).toHaveLength(1);
    expect(seen.filter((m) => m[0] === "OK" && m[1] === mockEvent.id)).toHaveLength(1);
    expect(seen.filter((m) => m[0] === "OK" && m[1] === "second-id")).toHaveLength(1);
  });
});
