import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { includeAltTag, sign } from "../../operations/event.js";
import { getCachedValue, getOrComputeCachedValue, setCachedValue } from "../cache.js";
import { EncryptedContentSymbol } from "../encrypted-content.js";
import { EventTemplate, kinds } from "../event.js";
import { eventPipe } from "../pipeline.js";
import { unixNow } from "../time.js";

/**
 * Both halves of the D-13 two-sided convention live in this ONE file — the
 * contrast between them IS the lesson. The first half proves an identity memo
 * (this package's `cache.ts` write mechanism) is DROPPED by a spread. The
 * second half proves a preserved (carry-forward) symbol written non-enumerably
 * via `setCachedValue` SURVIVES a downstream operation's own internal spread —
 * specifically because `pipeFromAsyncArray`'s carry-forward loop
 * (`helpers/pipeline.ts`, Plan 01) restores it — while a symbol NOT in
 * `PRESERVE_EVENT_SYMBOLS` written the exact same way is dropped by that same
 * spread and never restored. See `cache.ts`'s one-rule doc block (D-05) for
 * the mechanism this half guards.
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

describe("carry-forward payloads (pipeline carry-forward mechanism, Plan 01)", () => {
  // Retargeted (05.1-06) onto the real pipeline mechanism instead of modifyHiddenTags's old
  // enumerable write. That write ({ ...draft, content, [EncryptedContentSymbol]: plaintext })
  // is an object-literal computed-key assignment, which IS enumerable by default — it would
  // survive any later spread regardless of whether the carry-forward loop below exists, so a
  // suite built on it proves nothing about the mechanism (05.1-CONTEXT.md scope point 5).
  //
  // What this suite actually guards: `setCachedValue` (this file's own helper) writes
  // EncryptedContentSymbol NON-enumerably onto the draft, before the pipe runs. includeAltTag
  // routes through modifyPublicTags, whose `{ ...draft, tags }` return copies only enumerable
  // own properties — so that non-enumerable write is genuinely dropped by the spread. The
  // ONLY thing that can put it back is pipeFromAsyncArray's carry-forward loop
  // (helpers/pipeline.ts), which explicitly restores any symbol in PRESERVE_EVENT_SYMBOLS that
  // the previous step's value had and the new result is missing. sign()'s own Reflect
  // re-copy (operations/event.ts) then carries the (already-restored) value the rest of the
  // way — it cannot restore a symbol its own `draft` argument never received, so it does not
  // confound this probe.
  //
  // Companion (D-13, two-sided convention on one screen): a symbol NOT in
  // PRESERVE_EVENT_SYMBOLS, written the exact same way, is dropped by the exact same spread
  // and is never restored — the carry-forward loop only iterates the preserve set.
  //
  // Non-vacuity (RESEARCH.md § Validation Architecture / Pitfall 2): with the carry-forward
  // loop in pipeline.ts temporarily commented out, the "preserved symbol survives" assertion
  // below was observed to fail (RED) — `getCachedValue(signed, EncryptedContentSymbol)` was
  // `undefined` instead of `plaintext` — then the loop was restored and the suite went GREEN
  // again. See 05.1-06-SUMMARY.md for the recorded transcript of that probe.

  it("a preserved symbol dropped by a downstream operation's own spread is restored by the pipe's carry-forward loop", async () => {
    const user = new FakeUser();
    const plaintext = JSON.stringify([["p", "friend-pubkey"]]);
    const altDescription = "carry-forward probe";
    const nonPreservedMemo = Symbol("test-memo-not-in-preserve-set");

    const draft: EventTemplate = { kind: kinds.Mutelist, content: "", tags: [], created_at: unixNow() };

    // Non-enumerable writes via setCachedValue — deliberately NOT modifyHiddenTags's own
    // enumerable object-literal write, which would survive any spread unconditionally and
    // prove nothing about the carry-forward loop under test.
    setCachedValue(draft, EncryptedContentSymbol, plaintext);
    setCachedValue(draft, nonPreservedMemo, "will-not-survive");

    const signed = await eventPipe(
      includeAltTag(altDescription), // routes through modifyPublicTags's `{ ...draft, tags }` spread
      sign(user),
    )(draft);

    // The event is genuinely signed, and the intervening operation actually ran: includeAltTag's
    // effect landing on the signed event proves the spread executed (a no-op would make this
    // suite vacuous in a different way).
    expect(signed.id).toBeTruthy();
    expect(signed.sig).toBeTruthy();
    expect(signed.tags).toContainEqual(["alt", altDescription]);

    // Preserved: EncryptedContentSymbol is a PRESERVE_EVENT_SYMBOLS member, so the pipe's
    // carry-forward loop restored it after includeAltTag's spread dropped it. Asserted against
    // the literal constant this test set up — not derived via getEncryptedContent (that would
    // be asserting against implementation output) — so this only passes if the carry-forward
    // loop actually ran.
    expect(getCachedValue(signed, EncryptedContentSymbol)).toBe(plaintext);

    // Companion: a symbol NOT in PRESERVE_EVENT_SYMBOLS, written the same way, is dropped by
    // the same spread and never restored.
    expect(Reflect.has(signed, nonPreservedMemo)).toBe(false);
  });
});
