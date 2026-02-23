import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { NostrEvent } from "applesauce-core/helpers";
import { NEVER, of } from "rxjs";
import { describe, expect, it } from "vitest";
import { RequestComplete } from "../helpers/complete-conditions.js";
import type { IRelay, SubscriptionResponse } from "../types.js";

// Create mock relay objects
const createMockRelay = (url: string): IRelay => ({ url }) as IRelay;

const relay1 = createMockRelay("wss://relay1.com");
const relay2 = createMockRelay("wss://relay2.com");
const relay3 = createMockRelay("wss://relay3.com");

const mockEvent1: NostrEvent = { id: "1", kind: 1 } as NostrEvent;
const mockEvent2: NostrEvent = { id: "2", kind: 1 } as NostrEvent;
const mockEvent3: NostrEvent = { id: "3", kind: 1 } as NostrEvent;

describe("RequestComplete", () => {
  describe("onAllEose", () => {
    it("should complete when all relays send EOSE", () => {
      const operator = RequestComplete.onAllEose();
      const source = of(
        [relay1, mockEvent1] as [IRelay, SubscriptionResponse],
        [relay2, mockEvent2] as [IRelay, SubscriptionResponse],
        [relay1, "EOSE"] as [IRelay, SubscriptionResponse],
        [relay2, "EOSE"] as [IRelay, SubscriptionResponse],
      );

      const spy = subscribeSpyTo(source.pipe(operator));

      expect(spy.receivedComplete()).toBe(true);
      expect(spy.getValues().length).toBe(4);
      expect(spy.getLastValue()).toEqual([relay2, "EOSE"]);
    });

    it("should handle single relay", () => {
      const operator = RequestComplete.onAllEose();
      const source = of<[IRelay, SubscriptionResponse]>([relay1, mockEvent1], [relay1, "EOSE"]);

      const spy = subscribeSpyTo(source.pipe(operator));

      expect(spy.receivedComplete()).toBe(true);
      expect(spy.getValues().length).toBe(2);
    });

    it("should not complete until all relays send EOSE", () => {
      const operator = RequestComplete.onAllEose();
      const source = of<[IRelay, SubscriptionResponse]>(
        [relay1, mockEvent1],
        [relay2, mockEvent2],
        [relay1, "EOSE"],
        // relay2 never sends EOSE
      );

      const spy = subscribeSpyTo(source.pipe(operator));

      expect(spy.receivedComplete()).toBe(true); // Source completes naturally
      expect(spy.getValues().length).toBe(3);
    });
  });

  describe("onFirstEose", () => {
    it("should complete on first EOSE", () => {
      const operator = RequestComplete.onFirstEose();
      const source = of<[IRelay, SubscriptionResponse]>(
        [relay1, mockEvent1],
        [relay1, "EOSE"],
        [relay2, mockEvent2], // Should not receive this
      );

      const spy = subscribeSpyTo(source.pipe(operator));

      expect(spy.receivedComplete()).toBe(true);
      expect(spy.getValues().length).toBe(2);
      expect(spy.getLastValue()).toEqual([relay1, "EOSE"]);
    });

    it("should complete on first EOSE from any relay", () => {
      const operator = RequestComplete.onFirstEose();
      const source = of<[IRelay, SubscriptionResponse]>(
        [relay1, mockEvent1],
        [relay2, "EOSE"], // First EOSE from relay2
      );

      const spy = subscribeSpyTo(source.pipe(operator));

      expect(spy.receivedComplete()).toBe(true);
      expect(spy.getLastValue()).toEqual([relay2, "EOSE"]);
    });
  });

  describe("onEoseCount", () => {
    it("should complete after N relays send EOSE", () => {
      const operator = RequestComplete.onEoseCount(2);
      const source = of<[IRelay, SubscriptionResponse]>(
        [relay1, "EOSE"],
        [relay2, mockEvent1],
        [relay2, "EOSE"], // Second EOSE
        [relay3, mockEvent2], // Should not receive
      );

      const spy = subscribeSpyTo(source.pipe(operator));

      expect(spy.receivedComplete()).toBe(true);
      expect(spy.getValues().length).toBe(3);
    });

    it("should not count duplicate EOSE from same relay", () => {
      const operator = RequestComplete.onEoseCount(2);
      const source = of<[IRelay, SubscriptionResponse]>(
        [relay1, "EOSE"],
        [relay1, "EOSE"], // Same relay again - doesn't count
        [relay2, "EOSE"], // This is the second unique relay
      );

      const spy = subscribeSpyTo(source.pipe(operator));

      expect(spy.receivedComplete()).toBe(true);
      expect(spy.getValues().length).toBe(3);
    });
  });

  describe("onEventCount", () => {
    it("should complete after N events", () => {
      const operator = RequestComplete.onEventCount(3);
      const source = of<[IRelay, SubscriptionResponse]>(
        [relay1, mockEvent1],
        [relay1, mockEvent2],
        [relay2, mockEvent3], // Third event
        [relay2, "EOSE"], // Should not receive
      );

      const spy = subscribeSpyTo(source.pipe(operator));

      expect(spy.receivedComplete()).toBe(true);
      expect(spy.getValues().length).toBe(3);
    });

    it("should not count EOSE as events", () => {
      const operator = RequestComplete.onEventCount(2);
      const source = of<[IRelay, SubscriptionResponse]>(
        [relay1, mockEvent1],
        [relay1, "EOSE"], // EOSE doesn't count
        [relay2, mockEvent2], // Second event
      );

      const spy = subscribeSpyTo(source.pipe(operator));

      expect(spy.receivedComplete()).toBe(true);
      expect(spy.getValues().length).toBe(3);
    });
  });

  describe("onRelayEose", () => {
    it("should complete when specific relay sends EOSE", () => {
      const operator = RequestComplete.onRelayEose("wss://relay2.com");
      const source = of<[IRelay, SubscriptionResponse]>(
        [relay1, "EOSE"], // Wrong relay
        [relay2, mockEvent1],
        [relay2, "EOSE"], // Correct relay
      );

      const spy = subscribeSpyTo(source.pipe(operator));

      expect(spy.receivedComplete()).toBe(true);
      expect(spy.getLastValue()).toEqual([relay2, "EOSE"]);
    });
  });

  describe("onTimeout", () => {
    it("should complete after timeout", (done) => {
      const operator = RequestComplete.onTimeout(100);
      const spy = subscribeSpyTo(NEVER.pipe(operator));

      setTimeout(() => {
        expect(spy.receivedComplete()).toBe(true);
        expect(spy.getValues().length).toBe(0); // No values before timeout
        done();
      }, 150);
    });
  });

  describe("any", () => {
    it("should complete when any operator completes", () => {
      const operator = RequestComplete.any([RequestComplete.onEventCount(5), RequestComplete.onFirstEose()]);

      const source = of<[IRelay, SubscriptionResponse]>(
        [relay1, mockEvent1],
        [relay1, "EOSE"], // First EOSE triggers
      );

      const spy = subscribeSpyTo(source.pipe(operator));

      expect(spy.receivedComplete()).toBe(true);
      expect(spy.getValues().length).toBe(2);
    });

    it("should complete on first satisfied operator", () => {
      const operator = RequestComplete.any([RequestComplete.onEventCount(2), RequestComplete.onEoseCount(2)]);

      const source = of<[IRelay, SubscriptionResponse]>(
        [relay1, mockEvent1],
        [relay2, mockEvent2], // Second event triggers onEventCount(2)
        [relay1, "EOSE"], // Should not receive
      );

      const spy = subscribeSpyTo(source.pipe(operator));

      expect(spy.receivedComplete()).toBe(true);
      expect(spy.getValues().length).toBe(2);
    });
  });

  describe("all", () => {
    it("should apply operators in sequence", () => {
      const operator = RequestComplete.all([RequestComplete.onEventCount(2), RequestComplete.onFirstEose()]);

      const source = of(
        [relay1, mockEvent1] as [IRelay, SubscriptionResponse],
        [relay1, mockEvent2] as [IRelay, SubscriptionResponse], // Satisfies onEventCount(2)
        [relay1, "EOSE"] as [IRelay, SubscriptionResponse], // Then waits for first EOSE
      );

      const spy = subscribeSpyTo(source.pipe(operator));

      expect(spy.receivedComplete()).toBe(true);
      // onEventCount(2) completes after 2 events, so we only get 2 values
      expect(spy.getValues().length).toBe(2);
    });
  });
});
