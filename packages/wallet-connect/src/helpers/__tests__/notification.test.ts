// Wave 0 gap: notification.ts had only exports-snapshot coverage before this file. These
// tests exercise the setCachedValue migration (05.1-11): WalletNotificationSymbol must be
// non-enumerable and dropped by a plain spread.

import { describe, expect, it } from "vitest";

import { FakeUser } from "../../__tests__/fake-user.js";
import { WalletNotificationFactory } from "../../factories/notification.js";
import { setHiddenContentCache } from "applesauce-core/helpers";
import {
  getWalletNotification,
  isWalletNotificationUnlocked,
  WalletNotification,
  WalletNotificationSymbol,
} from "../notification.js";

const user = new FakeUser();
const client = new FakeUser().pubkey;

function paymentReceived(): WalletNotification {
  return {
    notification_type: "payment_received",
    notification: {
      type: "incoming",
      state: "settled",
      amount: 21_000,
      fees_paid: 0,
      created_at: 1_700_000_000,
    },
  };
}

describe("getWalletNotification", () => {
  it("parses and memoizes the notification content non-enumerably", async () => {
    const event = await WalletNotificationFactory.create(client, paymentReceived()).as(user).sign();

    // Unattempted before the first read.
    expect(WalletNotificationSymbol in event).toBe(false);

    const parsed = getWalletNotification(event);
    expect(parsed).toEqual(paymentReceived());

    // Non-enumerable: Reflect.ownKeys sees it, but a plain spread drops it.
    expect(Reflect.ownKeys(event)).toContain(WalletNotificationSymbol);
    expect(Object.getOwnPropertyDescriptor(event, WalletNotificationSymbol)?.enumerable).toBe(false);

    const spread = { ...event };
    expect(Reflect.ownKeys(spread)).not.toContain(WalletNotificationSymbol);
    expect(WalletNotificationSymbol in spread).toBe(false);

    // A second read short-circuits and returns the exact same memoized object.
    expect(getWalletNotification(event)).toBe(parsed);
  });
});

describe("getWalletNotification — malformed content returns undefined", () => {
  // Finding #2 of the throw/undefined review. This content arrives from the remote wallet
  // service, so malformed JSON is a routine network condition rather than a programmer error,
  // and the getter's return type already carries undefined for it.
  it("returns undefined for content that is not valid JSON", async () => {
    const event = await WalletNotificationFactory.create(client, paymentReceived()).as(user).sign();
    setHiddenContentCache(event, "not json{{{");

    expect(() => getWalletNotification(event)).not.toThrow();
    expect(getWalletNotification(event)).toBeUndefined();
  });

  it("caches nothing on rejection, so a later correct value is still readable", async () => {
    const event = await WalletNotificationFactory.create(client, paymentReceived()).as(user).sign();
    setHiddenContentCache(event, "not json{{{");

    expect(getWalletNotification(event)).toBeUndefined();
    expect(Reflect.has(event, WalletNotificationSymbol)).toBe(false);
    expect(isWalletNotificationUnlocked(event)).toBe(false);

    // Not sticky — the rejection described the content available at the time, nothing more.
    setHiddenContentCache(event, JSON.stringify(paymentReceived()));
    expect(getWalletNotification(event)).toEqual(paymentReceived());
  });
});
