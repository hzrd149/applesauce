// Wave 0 gap: request.ts had only exports-snapshot coverage before this file. These tests
// exercise the setCachedValue migration (05.1-11): WalletRequestSymbol must be
// non-enumerable and dropped by a plain spread.

import { describe, expect, it } from "vitest";

import { FakeUser } from "../../__tests__/fake-user.js";
import { WalletRequestFactory } from "../../factories/request.js";
import { GetBalanceMethod } from "../methods.js";
import { getWalletRequest, WalletRequestSymbol } from "../request.js";

const user = new FakeUser();
const service = new FakeUser().pubkey;

describe("getWalletRequest", () => {
  it("parses and memoizes the request content non-enumerably", async () => {
    const request: GetBalanceMethod["request"] = { method: "get_balance", params: {} };
    const event = await WalletRequestFactory.create<GetBalanceMethod>(service, request).as(user).sign();

    // Unattempted before the first read.
    expect(WalletRequestSymbol in event).toBe(false);

    const parsed = getWalletRequest<GetBalanceMethod>(event);
    expect(parsed).toEqual(request);

    // Non-enumerable: Reflect.ownKeys sees it, but a plain spread drops it.
    expect(Reflect.ownKeys(event)).toContain(WalletRequestSymbol);
    expect(Object.getOwnPropertyDescriptor(event, WalletRequestSymbol)?.enumerable).toBe(false);

    const spread = { ...event };
    expect(Reflect.ownKeys(spread)).not.toContain(WalletRequestSymbol);
    expect(WalletRequestSymbol in spread).toBe(false);

    // A second read short-circuits and returns the exact same memoized object.
    expect(getWalletRequest<GetBalanceMethod>(event)).toBe(parsed);
  });
});
