// Wave 0 gap: history.ts had only exports-snapshot coverage before this file. These tests
// exercise the setCachedValue migration (05.1-11): HistoryContentSymbol must be
// non-enumerable and dropped by a plain spread.

import { describe, expect, it } from "vitest";
import { setHiddenTagsCache } from "applesauce-core/helpers";

import { FakeUser } from "../../__tests__/fake-user.js";
import { WalletHistoryFactory } from "../../factories/history.js";
import { getHistoryContent, HistoryContent, HistoryContentSymbol, isHistoryContentUnlocked } from "../history.js";

const user = new FakeUser();

describe("getHistoryContent", () => {
  it("parses and memoizes the history content non-enumerably", async () => {
    const content: HistoryContent = {
      direction: "in",
      amount: 1000,
      created: ["a".repeat(64)],
    };
    const event = await WalletHistoryFactory.create(content).as(user).sign();

    // Unattempted before the first read. Note: isHistoryContentUnlocked itself computes and
    // memoizes the content as a side effect when the symbol isn't set yet, so this check must
    // run before any call to isHistoryContentUnlocked/getHistoryContent.
    expect(HistoryContentSymbol in event).toBe(false);

    expect(isHistoryContentUnlocked(event)).toBe(true);

    const parsed = getHistoryContent(event);
    expect(parsed).toEqual(content);

    // Non-enumerable: Reflect.ownKeys sees it, but a plain spread drops it.
    expect(Reflect.ownKeys(event)).toContain(HistoryContentSymbol);
    expect(Object.getOwnPropertyDescriptor(event, HistoryContentSymbol)?.enumerable).toBe(false);

    const spread = { ...event };
    expect(Reflect.ownKeys(spread)).not.toContain(HistoryContentSymbol);
    expect(HistoryContentSymbol in spread).toBe(false);

    // A second read short-circuits and returns the exact same memoized object.
    expect(getHistoryContent(event)).toBe(parsed);
  });
});

describe("getHistoryContent — malformed tags return undefined", () => {
  // Finding #5 of the throw/undefined review. WalletHistory's meta$ maps getHistoryContent inside
  // an RxJS pipe, where a throw errors the observable and is terminal.
  const historyWithTags = async (tags: string[][]) => {
    const event = await WalletHistoryFactory.create({ direction: "in", amount: 1000, created: [] }).as(user).sign();
    // Drop the memo written at sign time, then plant the tags the getter should choke on.
    Reflect.deleteProperty(event, HistoryContentSymbol);
    setHiddenTagsCache(event, tags);
    return event;
  };

  it("returns undefined when direction is missing", async () => {
    const event = await historyWithTags([["amount", "1000"]]);

    expect(() => getHistoryContent(event)).not.toThrow();
    expect(getHistoryContent(event)).toBeUndefined();
  });

  it("returns undefined when amount is missing", async () => {
    const event = await historyWithTags([["direction", "in"]]);

    expect(() => getHistoryContent(event)).not.toThrow();
    expect(getHistoryContent(event)).toBeUndefined();
  });

  it("returns undefined when amount does not parse as a number", async () => {
    const event = await historyWithTags([
      ["direction", "in"],
      ["amount", "not-a-number"],
    ]);

    expect(() => getHistoryContent(event)).not.toThrow();
    expect(getHistoryContent(event)).toBeUndefined();
  });

  it("caches nothing on rejection, so a later correct value is still readable", async () => {
    const event = await historyWithTags([["amount", "1000"]]);
    expect(getHistoryContent(event)).toBeUndefined();

    expect(Reflect.has(event, HistoryContentSymbol)).toBe(false);
    expect(isHistoryContentUnlocked(event)).toBe(false);

    // Not sticky.
    setHiddenTagsCache(event, [
      ["direction", "out"],
      ["amount", "42"],
    ]);
    expect(getHistoryContent(event)?.amount).toBe(42);
  });
});
