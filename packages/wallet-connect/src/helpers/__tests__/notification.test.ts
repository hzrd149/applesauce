// Wave 0 gap: notification.ts had only exports-snapshot coverage before this file. These
// tests exercise the setCachedValue migration (05.1-11): WalletNotificationSymbol must be
// non-enumerable and dropped by a plain spread.

import { describe, expect, it } from "vitest";

import { FakeUser } from "../../__tests__/fake-user.js";
import { WalletNotificationFactory } from "../../factories/notification.js";
import { getWalletNotification, WalletNotification, WalletNotificationSymbol } from "../notification.js";

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
