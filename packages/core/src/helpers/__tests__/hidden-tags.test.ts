import { finalizeEvent, generateSecretKey, getPublicKey, kinds, nip04, NostrEvent } from "nostr-tools";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HiddenContentSigner } from "../hidden-content.js";
import { setHiddenContentCache } from "../hidden-content.js";
import {
  getHiddenTags,
  HiddenTagsSymbol,
  isHiddenTagsUnlocked,
  setHiddenTagsCache,
  unlockHiddenTags,
} from "../hidden-tags.js";
import { unixNow } from "../time.js";

/**
 * Mirrors the private `copyDraftWithPubkey` helper in `operations/tags.ts` (Site-1 fix): a
 * descriptor-preserving copy that carries every own property -- including non-enumerable
 * symbols -- forward, plus a `pubkey` override. Not imported directly (internal, not part of
 * the public API surface); this mirror lets the regression below exercise the exact mechanism
 * against the REAL (now non-enumerable) hidden-tags.ts write, not a hand-simulated descriptor.
 */
function copyDraftWithPubkey<T extends object>(draft: T, pubkey: string): T & { pubkey: string } {
  const copy = Object.defineProperties({}, Object.getOwnPropertyDescriptors(draft)) as T;
  Object.defineProperty(copy, "pubkey", { value: pubkey, enumerable: true, writable: true, configurable: true });
  return copy as T & { pubkey: string };
}

const key = generateSecretKey();
const pubkey = getPublicKey(key);
const signer: HiddenContentSigner = {
  nip04: {
    encrypt: (pubkey: string, plaintext: string) => nip04.encrypt(key, pubkey, plaintext),
    decrypt: (pubkey: string, ciphertext: string) => nip04.decrypt(key, pubkey, ciphertext),
  },
};

describe("Private Lists", () => {
  describe("unlockHiddenTags", () => {
    let list: NostrEvent;

    beforeEach(async () => {
      list = finalizeEvent(
        {
          kind: kinds.Mutelist,
          created_at: unixNow(),
          content: await nip04.encrypt(
            key,
            pubkey,
            JSON.stringify([["p", "npub1ye5ptcxfyyxl5vjvdjar2ua3f0hynkjzpx552mu5snj3qmx5pzjscpknpr"]]),
          ),
          tags: [],
        },
        key,
      );
    });

    it("should unlock hidden tags", async () => {
      await unlockHiddenTags(list, signer);

      expect(getHiddenTags(list)).toEqual(
        expect.arrayContaining([["p", "npub1ye5ptcxfyyxl5vjvdjar2ua3f0hynkjzpx552mu5snj3qmx5pzjscpknpr"]]),
      );
    });

    it("writes HiddenTagsSymbol non-enumerable and a plain spread copy drops it", async () => {
      await unlockHiddenTags(list, signer);

      const descriptor = Object.getOwnPropertyDescriptor(list, HiddenTagsSymbol);
      expect(descriptor?.enumerable).toBe(false);

      const copy = { ...list };
      expect(Object.prototype.hasOwnProperty.call(copy, HiddenTagsSymbol)).toBe(false);
    });
  });

  describe("re-entry (Plan 03 Site-1 regression, exercised against the real non-enumerable write)", () => {
    let list: NostrEvent;

    beforeEach(async () => {
      list = finalizeEvent(
        {
          kind: kinds.Mutelist,
          created_at: unixNow(),
          content: await nip04.encrypt(key, pubkey, JSON.stringify([["p", "cached-pubkey"]])),
          tags: [],
        },
        key,
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("does not force a redundant decrypt when the same event's hidden tags are unlocked twice", async () => {
      const decryptSpy = vi.spyOn(signer.nip04!, "decrypt");

      await unlockHiddenTags(list, signer);
      expect(decryptSpy).toHaveBeenCalledTimes(1);

      // Re-entry: unlocking the SAME event again must short-circuit via the cache, not re-decrypt
      await unlockHiddenTags(list, signer);
      expect(decryptSpy).toHaveBeenCalledTimes(1);
    });

    it("a descriptor-preserving copy of an already-unlocked event (mirrors modifyHiddenTags's Site-1 fix) also avoids a redundant decrypt", async () => {
      await unlockHiddenTags(list, signer);

      const decryptSpy = vi.spyOn(signer.nip04!, "decrypt");

      // Control: a naive spread drops the now-non-enumerable HiddenTagsSymbol
      const naiveSpread = { ...list };
      await unlockHiddenTags(naiveSpread, signer);
      expect(decryptSpy).toHaveBeenCalledTimes(1);

      decryptSpy.mockClear();

      // Fix: the descriptor-preserving copy (Site-1) keeps HiddenTagsSymbol, so unlockHiddenTags
      // short-circuits and no decrypt call occurs
      const fixedCopy = copyDraftWithPubkey(list, list.pubkey);
      await unlockHiddenTags(fixedCopy, signer);
      expect(decryptSpy).not.toHaveBeenCalled();
    });
  });
});

describe("setHiddenTagsCache", () => {
  it("writes HiddenTagsSymbol non-enumerable and a plain spread copy drops it", () => {
    const draft = { kind: kinds.Mutelist, content: "", tags: [], created_at: unixNow() };
    setHiddenTagsCache(draft, [["p", "cached-pubkey"]]);

    const descriptor = Object.getOwnPropertyDescriptor(draft, HiddenTagsSymbol);
    expect(descriptor?.enumerable).toBe(false);

    const copy = { ...draft };
    expect(Object.prototype.hasOwnProperty.call(copy, HiddenTagsSymbol)).toBe(false);
  });
});

describe("getHiddenTags — malformed content returns undefined", () => {
  // Findings #1 of the throw/undefined review. getHiddenTags is read across whole timelines
  // from inside RxJS pipes (every hidden-* getter in applesauce-common delegates to it), where
  // a throw errors the observable and is terminal — one corrupt list would take down every
  // event in the pipe, not just the malformed one.
  const listWithHiddenContent = (plaintext: string) => {
    const event = { kind: kinds.Mutelist, content: "ciphertext", tags: [], created_at: unixNow(), pubkey, id: "", sig: "" } as unknown as NostrEvent;
    setHiddenContentCache(event, plaintext);
    return event;
  };

  it("returns undefined for content that is not valid JSON", () => {
    const event = listWithHiddenContent("not json{{{");

    expect(() => getHiddenTags(event)).not.toThrow();
    expect(getHiddenTags(event)).toBeUndefined();
  });

  it("returns undefined for JSON that is not an array of tags", () => {
    const event = listWithHiddenContent(JSON.stringify({ not: "an array" }));

    expect(() => getHiddenTags(event)).not.toThrow();
    expect(getHiddenTags(event)).toBeUndefined();
  });

  it("caches nothing on rejection, so a later correct value is still readable", () => {
    const event = listWithHiddenContent("not json{{{");
    expect(getHiddenTags(event)).toBeUndefined();

    // No memo — caching the rejection would leave the list permanently unreadable and would
    // break isHiddenTagsUnlocked, which tests for presence rather than value.
    expect(Reflect.has(event, HiddenTagsSymbol)).toBe(false);
    expect(isHiddenTagsUnlocked(event)).toBe(false);

    // The rejection is not sticky.
    setHiddenContentCache(event, JSON.stringify([["p", "abc"]]));
    expect(getHiddenTags(event)).toEqual([["p", "abc"]]);
  });

  it("one malformed list does not stop the rest of a timeline from resolving", () => {
    const bad = listWithHiddenContent("not json{{{");
    const good = listWithHiddenContent(JSON.stringify([["p", "good"]]));

    let results: (string[][] | undefined)[] = [];
    expect(() => {
      results = [bad, good].map((e) => getHiddenTags(e));
    }).not.toThrow();

    expect(results.filter((r) => !!r)).toEqual([[["p", "good"]]]);
  });
});
