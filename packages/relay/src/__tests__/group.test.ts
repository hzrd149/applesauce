import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { NostrEvent } from "nostr-tools";
import { of } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WS } from "vitest-websocket-mock";

import { RelayGroup } from "../group.js";
import { Relay } from "../relay.js";

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
    group.req([{ kinds: [1] }], "test-sub").subscribe();

    await expect(mockRelay1).toReceiveMessage(["REQ", "test-sub", { kinds: [1] }]);
    await expect(mockRelay2).toReceiveMessage(["REQ", "test-sub", { kinds: [1] }]);
  });

  it("should emit events from all relays", async () => {
    const spy = subscribeSpyTo(group.req([{ kinds: [1] }], "test-sub"));

    await expect(mockRelay1).toReceiveMessage(["REQ", "test-sub", { kinds: [1] }]);
    await expect(mockRelay2).toReceiveMessage(["REQ", "test-sub", { kinds: [1] }]);

    mockRelay1.send(["EVENT", "test-sub", { ...mockEvent, id: "1" }]);
    mockRelay2.send(["EVENT", "test-sub", { ...mockEvent, id: "2" }]);

    expect(spy.getValues()).toEqual([expect.objectContaining({ id: "1" }), expect.objectContaining({ id: "2" })]);
  });

  it("should only emit EOSE once all relays have emitted EOSE", async () => {
    const spy = subscribeSpyTo(group.req([{ kinds: [1] }], "test-sub"));

    mockRelay1.send(["EOSE", "test-sub"]);
    expect(spy.getValues()).not.toContain("EOSE");

    mockRelay2.send(["EOSE", "test-sub"]);
    expect(spy.getValues()).toContain("EOSE");
  });

  it("should ignore relays that have an error", async () => {
    const spy = subscribeSpyTo(group.req([{ kinds: [1] }], "test-sub"));

    mockRelay1.error();
    mockRelay2.send(["EVENT", "test-sub", mockEvent]);
    mockRelay2.send(["EOSE", "test-sub"]);

    expect(spy.getValues()).toEqual([expect.objectContaining(mockEvent), "EOSE"]);
  });

  it("should emit EOSE if all relays error", async () => {
    const spy = subscribeSpyTo(group.req([{ kinds: [1] }], "test-sub"));

    mockRelay1.error();
    mockRelay2.error();

    expect(spy.getValues()).toEqual(["EOSE"]);
  });

  it("should still pass events to subscription when one relay is offline", async () => {
    // Close one relay to simulate it being offline
    mockRelay1.close();

    // Make the request
    const spy = subscribeSpyTo(group.req([{ kinds: [1] }], "test-sub", { eventStore: null }));

    // Send event from the remaining online relay
    mockRelay2.send(["EVENT", "test-sub", mockEvent]);
    mockRelay2.send(["EOSE", "test-sub"]);

    expect(spy.getValues()).toEqual([expect.objectContaining(mockEvent)]);
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
});
