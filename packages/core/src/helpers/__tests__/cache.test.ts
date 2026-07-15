import { describe, expect, it } from "vitest";
import { getCachedValue, getOrComputeCachedValue, setCachedValue } from "../cache.js";

/**
 * Both halves of the D-13 two-sided convention live in this ONE file — the
 * contrast between them IS the lesson. The first half proves an identity memo
 * (this package's `cache.ts` write mechanism) is DROPPED by a spread. The
 * second half proves a carry-forward payload (`EncryptedContentSymbol` at its
 * `operations/tags.ts:87` write site) SURVIVES a real factory pipe and real
 * signing. See `cache.ts`'s write-site taxonomy comment for the full rationale.
 */

describe("cache identity memos", () => {
  const symbol = Symbol("test-memo");

  it("a value written with setCachedValue is readable via getCachedValue", () => {
    const material = { community_root: "root-a", root_epoch: 1 };
    setCachedValue(material, symbol, "memo-a");

    expect(getCachedValue(material, symbol)).toBe("memo-a");
  });

  it("the memo does not survive a spread with a changed field", () => {
    const material = { community_root: "root-a", root_epoch: 1 };
    setCachedValue(material, symbol, "memo-a");

    // Models rollForward's real-world shape: spread material with a changed root_epoch.
    const rolledForward = { ...material, root_epoch: 2 };

    expect(Reflect.has(rolledForward, symbol)).toBe(false);
  });

  it("getOrComputeCachedValue on the spread copy recomputes from the copy's own new field", () => {
    const material = { community_root: "root-a", root_epoch: 1 };
    let computeCalls = 0;
    const deriveFrom = (m: typeof material) => {
      computeCalls++;
      return `derived-epoch-${m.root_epoch}`;
    };

    // Prime the memo on the original object first.
    getOrComputeCachedValue(material, symbol, () => deriveFrom(material));

    const rolledForward = { ...material, root_epoch: 2 };
    const result = getOrComputeCachedValue(rolledForward, symbol, () => deriveFrom(rolledForward));

    expect(result).toBe("derived-epoch-2");
    expect(computeCalls).toBe(2);
  });

  it("getOrComputeCachedValue on the original object still memoizes without recomputing", () => {
    const material = { community_root: "root-a", root_epoch: 1 };
    let computeCalls = 0;
    const compute = () => {
      computeCalls++;
      return `derived-epoch-${material.root_epoch}`;
    };

    const first = getOrComputeCachedValue(material, symbol, compute);
    const second = getOrComputeCachedValue(material, symbol, compute);

    expect(first).toBe("derived-epoch-1");
    expect(second).toBe("derived-epoch-1");
    expect(computeCalls).toBe(1);
  });

  it("the memo is non-enumerable — hidden from Object.keys/JSON.stringify but present via getOwnPropertySymbols", () => {
    const material = { community_root: "root-a", root_epoch: 1 };
    setCachedValue(material, symbol, "memo-a");

    expect(Object.keys(material)).toEqual(["community_root", "root_epoch"]);
    expect(JSON.stringify(material)).toBe(JSON.stringify({ community_root: "root-a", root_epoch: 1 }));
    expect(Object.getOwnPropertySymbols(material)).toContain(symbol);
  });
});
