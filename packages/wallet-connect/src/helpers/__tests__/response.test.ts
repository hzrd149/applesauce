// Wave 0 gap: response.ts had only exports-snapshot coverage before this file. These tests
// exercise the setCachedValue migration (05.1-11): WalletResponseSymbol must be
// non-enumerable and dropped by a plain spread.

import { describe, expect, it } from "vitest";

import { FakeUser } from "../../__tests__/fake-user.js";
import { WalletRequestFactory } from "../../factories/request.js";
import { WalletResponseFactory } from "../../factories/response.js";
import { GetBalanceMethod } from "../methods.js";
import { getWalletResponse, WalletResponseSymbol } from "../response.js";

const client = new FakeUser();
const service = new FakeUser();

describe("getWalletResponse", () => {
  it("parses and memoizes the response content non-enumerably", async () => {
    const request: GetBalanceMethod["request"] = { method: "get_balance", params: {} };
    const requestEvent = await WalletRequestFactory.create<GetBalanceMethod>(service.pubkey, request)
      .as(client)
      .sign();

    const response: GetBalanceMethod["response"] = {
      result_type: "get_balance",
      error: null,
      result: { balance: 21_000 },
    };
    const event = await WalletResponseFactory.create<GetBalanceMethod>(requestEvent, response).as(service).sign();

    // Unattempted before the first read.
    expect(WalletResponseSymbol in event).toBe(false);

    const parsed = getWalletResponse<GetBalanceMethod>(event);
    expect(parsed).toEqual(response);

    // Non-enumerable: Reflect.ownKeys sees it, but a plain spread drops it.
    expect(Reflect.ownKeys(event)).toContain(WalletResponseSymbol);
    expect(Object.getOwnPropertyDescriptor(event, WalletResponseSymbol)?.enumerable).toBe(false);

    const spread = { ...event };
    expect(Reflect.ownKeys(spread)).not.toContain(WalletResponseSymbol);
    expect(WalletResponseSymbol in spread).toBe(false);

    // A second read short-circuits and returns the exact same memoized object.
    expect(getWalletResponse<GetBalanceMethod>(event)).toBe(parsed);
  });
});
