import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { getSeenRelays } from "applesauce-core/helpers";
import { Filter, NostrEvent } from "nostr-tools";
import { firstValueFrom, of, Subject, throwError, timer } from "rxjs";
import { filter, repeat } from "rxjs/operators";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WS } from "vitest-websocket-mock";

import { Relay } from "../relay.js";
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
  vi.clearAllTimers();
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

describe("req", () => {
  it("should trigger connection to relay", async () => {
    subscribeSpyTo(relay.req([{ kinds: [1] }], "sub1"));

    // Wait for connection
    await firstValueFrom(relay.connected$.pipe(filter(Boolean)));

    expect(relay.connected).toBe(true);
  });

  it("should send expected messages to relay", async () => {
    subscribeSpyTo(relay.req([{ kinds: [1] }], "sub1"));

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
  });

  it("should not close the REQ when EOSE is received", async () => {
    // Create subscription that completes after first EOSE
    const sub = subscribeSpyTo(relay.req([{ kinds: [1] }], "sub1"));

    // Verify REQ was sent
    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);

    // Send EOSE to complete subscription
    server.send(["EVENT", "sub1", mockEvent]);
    server.send(["EOSE", "sub1"]);

    // Verify the subscription did not complete
    expect(sub.receivedComplete()).toBe(false);

    expect(sub.getValues()).toEqual([expect.objectContaining(mockEvent), "EOSE"]);
  });

  it("should send CLOSE when unsubscribed", async () => {
    // Create subscription that completes after first EOSE
    const sub = subscribeSpyTo(relay.req([{ kinds: [1] }], "sub1"));

    // Verify REQ was sent
    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);

    // Complete the subscription
    sub.unsubscribe();

    // Verify CLOSE was sent
    await expect(server).toReceiveMessage(["CLOSE", "sub1"]);
  });

  it("should close connection when unsubscribed", async () => {
    const sub = subscribeSpyTo(relay.req([{ kinds: [1] }], "sub1"));
    await server.connected;
    sub.unsubscribe();
    await server.closed;
    expect(relay.connected).toBe(false);
  });

  it("should emit nostr event and EOSE", async () => {
    const spy = subscribeSpyTo(relay.req([{ kinds: [1] }], "sub1"));
    await server.connected;

    server.send(["EVENT", "sub1", mockEvent]);
    server.send(["EOSE", "sub1"]);

    expect(spy.getValues()).toEqual([expect.objectContaining(mockEvent), "EOSE"]);
  });

  it("should ignore EVENT and EOSE messages that do not match subscription id", async () => {
    const spy = subscribeSpyTo(relay.req([{ kinds: [1] }], "sub1"));
    await server.connected;

    // Send EVENT message with wrong subscription id
    server.send(["EVENT", "wrong_sub", mockEvent]);

    // Send EOSE message with wrong subscription id
    server.send(["EOSE", "wrong_sub"]);

    // Send EVENT message with correct subscription id
    server.send(["EVENT", "sub1", mockEvent]);

    // Send EOSE message with correct subscription id
    server.send(["EOSE", "sub1"]);

    expect(spy.getValues()).toEqual([expect.objectContaining(mockEvent), "EOSE"]);
  });

  it("should mark events with their source relay", async () => {
    const spy = subscribeSpyTo(relay.req([{ kinds: [1] }], "sub1"));
    await server.connected;

    // Send EVENT message
    server.send(["EVENT", "sub1", mockEvent]);

    // Get the received event
    const receivedEvent = spy.getValues()[0];

    // Verify the event was marked as seen from this relay
    expect(getSeenRelays(receivedEvent)).toContain("wss://test");
  });

  it("should error subscription when CLOSED message is received", async () => {
    const spy = subscribeSpyTo(relay.req([{ kinds: [1] }], "sub1"), { expectErrors: true });
    await server.connected;

    // Send CLOSED message for the subscription
    server.send(["CLOSED", "sub1", "reason"]);

    // Verify the subscription completed
    expect(spy.receivedError()).toBe(true);
  });

  it("should not send multiple REQ messages for multiple subscriptions", async () => {
    const sub = relay.req([{ kinds: [1] }], "sub1");
    sub.subscribe();
    sub.subscribe();

    // Wait for all messages to be sent
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(server.messages).toEqual([["REQ", "sub1", { kinds: [1] }]]);
  });

  it("should wait for authentication if relay responds with auth-required", async () => {
    // First subscription to trigger auth-required
    const firstSub = subscribeSpyTo(relay.req([{ kinds: [1] }], "sub1"), { expectErrors: true });
    await server.nextMessage;

    // Send CLOSED message with auth-required reason
    server.send(["CLOSED", "sub1", "auth-required: need to authenticate"]);

    // wait for complete
    await firstSub.onError();
    await server.nextMessage;

    // Create a second subscription that should wait for auth
    const secondSub = subscribeSpyTo(relay.req([{ kinds: [1] }], "sub2"), { expectErrors: true });

    // Verify no REQ message was sent yet (waiting for auth)
    expect(server).not.toHaveReceivedMessages(["REQ", "sub2", { kinds: [1] }]);

    // Simulate successful authentication
    relay.authenticationResponse$.next({ ok: true, from: "wss://test" });

    // Now the REQ should be sent
    await expect(server).toReceiveMessage(["REQ", "sub2", { kinds: [1] }]);

    // Send EVENT and EOSE to complete the subscription
    server.send(["EVENT", "sub2", mockEvent]);
    server.send(["EOSE", "sub2"]);

    // Verify the second subscription received the event and EOSE
    expect(secondSub.getValues()).toEqual([expect.objectContaining(mockEvent), "EOSE"]);
  });

  it("should throw error if relay closes connection with error", async () => {
    const spy = subscribeSpyTo(relay.req([{ kinds: [1] }], "sub1"), { expectErrors: true });
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
    relay.ready$.next(false);

    const spy = subscribeSpyTo(relay.req([{ kinds: [1] }], "sub1"), { expectErrors: true });

    // Fast-forward time by 20 seconds
    await vi.advanceTimersByTimeAsync(20000);

    expect(spy.receivedComplete()).toBe(false);
    expect(spy.receivedError()).toBe(false);
    expect(spy.receivedNext()).toBe(false);
  });

  it("should wait when relay isn't ready", async () => {
    // @ts-expect-error
    relay.ready$.next(false);

    subscribeSpyTo(relay.req([{ kinds: [1] }], "sub1"));

    // Wait 10ms to ensure the relay didn't receive anything
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(server.messages.length).toBe(0);

    // @ts-expect-error
    relay.ready$.next(true);

    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);
  });

  it("should wait for filters if filters are provided as an observable", async () => {
    const filters = new Subject<Filter | Filter[]>();
    subscribeSpyTo(relay.req(filters, "sub1"));

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
    subscribeSpyTo(relay.req(filters, "sub1"));

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
    const sub = subscribeSpyTo(relay.req(filters, "sub1"));

    // Send REQ message with filters
    filters.next([{ kinds: [1] }]);

    // Complete the observable
    filters.complete();

    await sub.onComplete();

    expect(sub.receivedComplete()).toBe(true);
  });

  it("should complete observable when relay closes connection", async () => {
    const sub = subscribeSpyTo(relay.req([{ kinds: [1] }], "sub1"));
    await server.connected;

    // Send CLOSE message
    server.close();

    expect(sub.receivedComplete()).toBe(true);
  });

  it("should error observable when relay closes connection with error", async () => {
    const sub = subscribeSpyTo(relay.req([{ kinds: [1] }], "sub1"), { expectErrors: true });
    await server.connected;

    // Send an error
    server.error({
      reason: "error message",
      code: 1000,
      wasClean: false,
    });

    expect(sub.receivedError()).toBe(true);
  });

  it("should reconnect when repeat operator is used", async () => {
    const sub = subscribeSpyTo(relay.req([{ kinds: [1] }], "sub1").pipe(repeat()));

    // First connection
    await server.connected;
    server.close();
    await server.closed;

    // Should not complete
    expect(sub.receivedComplete()).toBe(false);

    // Should reconnect
    await expect(server.connected).resolves.toBeDefined();

    // Cleanup to prevent retries breaking other tests
    sub.unsubscribe();
    await server.closed;
  });
});

describe("event", () => {
  it("should wait for authentication if relay responds with auth-required", async () => {
    // First event to trigger auth-required
    const firstSpy = subscribeSpyTo(relay.event(mockEvent), { expectErrors: true });
    await expect(server).toReceiveMessage(["EVENT", mockEvent]);

    // Send OK with auth-required message
    server.send(["OK", mockEvent.id, false, "auth-required: need to authenticate"]);
    await firstSpy.onComplete();

    // Create a second event that should wait for auth
    const secondSpy = subscribeSpyTo(relay.event(mockEvent), { expectErrors: true });

    // Verify no EVENT message was sent yet (waiting for auth)
    expect(server).not.toHaveReceivedMessages(["EVENT", mockEvent]);

    // Simulate successful authentication
    relay.authenticationResponse$.next({ ok: true, from: "wss://test" });

    // Now the EVENT should be sent
    await expect(server).toReceiveMessage(["EVENT", mockEvent]);

    // Send OK response to complete the event
    server.send(["OK", mockEvent.id, true, ""]);

    // Verify the second event completed successfully
    await secondSpy.onComplete();
    expect(secondSpy.receivedComplete()).toBe(true);
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
    await vi.advanceTimersByTimeAsync(10000);

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
    relay.ready$.next(false);

    const spy = subscribeSpyTo(relay.event(mockEvent), { expectErrors: true });

    // Fast-forward time by 20 seconds
    await vi.advanceTimersByTimeAsync(20000);

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
    relay.ready$.next(false);

    subscribeSpyTo(relay.event(mockEvent));

    // Wait 10ms to ensure the relay didn't receive anything
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(server.messages.length).toBe(0);

    // @ts-expect-error
    relay.ready$.next(true);

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

    // @ts-expect-error
    expect(relay.ready$.value).toBe(false);

    // Fast-forward time by 10ms
    await vi.advanceTimersByTimeAsync(5000);

    // @ts-expect-error
    expect(relay.ready$.value).toBe(true);
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

describe("request", () => {
  it("should retry when auth-required is received and authentication is completed", async () => {
    // First attempt to request
    const spy = subscribeSpyTo(relay.request({ kinds: [1] }, { id: "sub1" }));

    // Verify REQ was sent
    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);

    // Send auth-required response
    server.send(["AUTH", "challenge-string"]);
    server.send(["CLOSED", "sub1", "auth-required: need to authenticate"]);

    await server.nextMessage;

    // Wait for subscription to close
    await expect(server).toHaveReceivedMessages([["CLOSE", "sub1"]]);

    // Send auth event
    const authEvent = { ...mockEvent, id: "auth-id" };
    const auth = relay.auth(authEvent);

    // Verify AUTH was sent
    await expect(server).toReceiveMessage(["AUTH", authEvent]);
    server.send(["OK", authEvent.id, true, ""]);

    // Wait for auth to complete
    await auth;

    // Wait for retry
    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);

    // Send response
    server.send(["EVENT", "sub1", mockEvent]);
    server.send(["EOSE", "sub1"]);

    // Verify the final result is successful
    expect(spy.getLastValue()).toEqual(expect.objectContaining(mockEvent));
    expect(spy.receivedComplete()).toBe(true);
  });

  it("should support resubscribe", async () => {
    const spy = subscribeSpyTo(relay.request({ kinds: [1] }, { resubscribe: true }));

    await server.connected;
    server.close();
    await server.closed;

    expect(spy.receivedComplete()).toBe(false);

    // Should reconnect
    await expect(server.connected).resolves.toBeDefined();

    // Cleanup to prevent retries breaking other tests
    spy.unsubscribe();
    await server.closed;
  });

  it("should support retries on connection errors", async () => {
    const spy = subscribeSpyTo(relay.request({ kinds: [1] }, { retries: 5 }), { expectErrors: true });

    await server.connected;
    server.close({ wasClean: false, code: 1000, reason: "error message" });
    await server.closed;

    // Should retry
    await expect(server.connected).resolves.toBeDefined();

    // Cleanup to prevent retries breaking other tests
    spy.unsubscribe();
    await server.closed;
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

    // Wait for subscription to close
    await expect(server).toReceiveMessage(["CLOSE", "sub1"]);

    // Send auth event
    const authEvent = { ...mockEvent, id: "auth-id" };
    const auth = relay.auth(authEvent);

    // Verify AUTH was sent
    await expect(server).toReceiveMessage(["AUTH", authEvent]);
    server.send(["OK", authEvent.id, true, ""]);

    // Wait for auth to complete
    await auth;

    // Wait for retry
    await expect(server).toReceiveMessage(["REQ", "sub1", { kinds: [1] }]);

    // Send response
    server.send(["EVENT", "sub1", mockEvent]);
    server.send(["EOSE", "sub1"]);

    // Verify the final result is successful
    expect(spy.getValues()).toEqual([expect.objectContaining(mockEvent), "EOSE"]);
    expect(spy.receivedComplete()).toBe(false);
  });

  it("should support resubscribe", async () => {
    const spy = subscribeSpyTo(relay.subscription({ kinds: [1] }, { resubscribe: true }));

    await server.connected;
    server.close();
    await server.closed;

    expect(spy.receivedComplete()).toBe(false);

    // Should reconnect
    await expect(server.connected).resolves.toBeDefined();

    // Cleanup to prevent resubscribe breaking other tests
    spy.unsubscribe();
    await server.closed;
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

  it("should error subscription when CLOSED message is received", async () => {
    const spy = subscribeSpyTo(relay.count([{ kinds: [1] }], "count1"), { expectErrors: true });
    await server.connected;

    // Send CLOSED message for the subscription
    server.send(["CLOSED", "count1", "reason"]);

    // Verify the subscription completed with error
    expect(spy.receivedError()).toBe(true);
  });

  it("should error if no COUNT response received within timeout", async () => {
    vi.useFakeTimers();

    const spy = subscribeSpyTo(relay.count([{ kinds: [1] }], "count1"), { expectErrors: true });

    // Fast-forward time by 10 seconds
    await vi.advanceTimersByTimeAsync(10000);

    expect(spy.receivedError()).toBe(true);
    expect(spy.getError()?.message).toBe("COUNT timeout");
  });

  it("should not send multiple COUNT messages for multiple subscriptions", async () => {
    const sub = relay.count([{ kinds: [1] }], "count1");
    sub.subscribe();
    sub.subscribe();

    // Wait for all messages to be sent
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(server.messages).toEqual([["COUNT", "count1", { kinds: [1] }]]);
  });

  it("should wait when relay isn't ready", async () => {
    // @ts-expect-error
    relay.ready$.next(false);

    subscribeSpyTo(relay.count([{ kinds: [1] }], "count1"));

    // Wait 10ms to ensure the relay didn't receive anything
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(server.messages.length).toBe(0);

    // @ts-expect-error
    relay.ready$.next(true);

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

describe("close", () => {
  it("should close the socket", async () => {
    subscribeSpyTo(relay.req([{ kinds: [1] }]));
    await server.connected;

    relay.close();
    await server.closed;
    expect(relay.connected).toBe(false);
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
