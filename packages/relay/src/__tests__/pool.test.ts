import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { Filter, NostrEvent } from "applesauce-core/helpers";
import { of } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WS } from "vitest-websocket-mock";

import { RelayPool } from "../pool.js";
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
