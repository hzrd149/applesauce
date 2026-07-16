import { finalizeEvent, generateSecretKey, getPublicKey, kinds, nip04, NostrEvent } from "nostr-tools";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HiddenContentSigner } from "../hidden-content.js";
import { getHiddenTags, HiddenTagsSymbol, setHiddenTagsCache, unlockHiddenTags } from "../hidden-tags.js";
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
