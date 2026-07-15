import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { modifyHiddenTags } from "../../operations/tags.js";
import { includeAltTag, sign } from "../../operations/event.js";
import { getCachedValue, getOrComputeCachedValue, setCachedValue } from "../cache.js";
import { getEncryptedContent } from "../encrypted-content.js";
import { kinds } from "../event.js";
import { getHiddenTags } from "../hidden-tags.js";
import { eventPipe } from "../pipeline.js";
import { unixNow } from "../time.js";

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

describe("carry-forward payloads", () => {
  // Asserts the OPPOSITE outcome of the memo half above: EncryptedContentSymbol
  // is a carry-forward payload at this write site (operations/tags.ts:87), not
  // an identity memo, so it MUST survive the pipe's spreads and the sign
  // operation's re-copy. See cache.ts's write-site taxonomy (D-06) for the
  // full category definitions. Enforcement contract: if a future cleanup
  // migrates this write site (or encrypted-content.ts:117,
  // common/operations/gift-wrap.ts:121) onto setCachedValue, this suite goes
  // red immediately — that is its job. This half is a regression guard, not a
  // proof of the 05-01 fix — the carry-forward sites never routed through
  // cache.ts, so it was green before and after that fix.

  it("real pipe + real signing preserve plaintext hidden tags on the signed event", async () => {
    const user = new FakeUser();
    const plaintextTags = [["p", "friend-pubkey"]];
    const altDescription = "carry-forward regression probe";

    const signed = await eventPipe(
      modifyHiddenTags(user, (tags) => [...tags, ["p", "friend-pubkey"]]),
      includeAltTag(altDescription),
      sign(user),
    )({ kind: kinds.Mutelist, content: "", tags: [], created_at: unixNow() });

    // The event is genuinely signed.
    expect(signed.id).toBeTruthy();
    expect(signed.sig).toBeTruthy();
    expect(signed.pubkey).toBe(user.pubkey);

    // The content really was encrypted, not passed through.
    expect(signed.content).not.toBe("");
    expect(signed.content).not.toBe(JSON.stringify(plaintextTags));

    // The intervening operation actually ran: includeAltTag's public-tag spread sits between
    // the hidden-tag write and sign() below, so its effect landing on the signed event proves
    // the spread executed (a no-op insertion would make this test vacuous in a new way).
    expect(signed.tags).toContainEqual(["alt", altDescription]);

    // The plaintext survived every spread in the pipe — including the alt-tag spread above —
    // and reads back correctly.
    expect(getHiddenTags(signed)).toEqual(plaintextTags);
    expect(getEncryptedContent(signed)).toBe(JSON.stringify(plaintextTags));
  });
});
