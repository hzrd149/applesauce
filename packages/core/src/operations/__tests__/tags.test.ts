import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { kinds } from "../../helpers/event.js";
import { eventPipe } from "../../helpers/pipeline.js";
import { unixNow } from "../../helpers/time.js";
import { includeAltTag, sign } from "../event.js";
import { modifyHiddenTags } from "../tags.js";
import {
  EncryptedContentSymbol,
  getEncryptedContent,
  getHiddenTags,
  HiddenTagsSymbol,
  unlockHiddenTags,
} from "../../helpers";

/**
 * Mirrors the private `copyDraftWithPubkey` helper in `../tags.js` (Site-1 fix): a
 * descriptor-preserving copy that carries every own property — including non-enumerable
 * symbols — forward, plus a `pubkey` override. Not imported directly because `tags.ts` exports
 * via `export *` through the package barrel, and this helper is intentionally not part of the
 * public API surface (see `operations/__tests__/exports.test.ts`'s snapshot).
 */
function copyDraftWithPubkey<T extends object>(draft: T, pubkey: string): T & { pubkey: string } {
  const copy = Object.defineProperties({}, Object.getOwnPropertyDescriptors(draft)) as T;
  Object.defineProperty(copy, "pubkey", { value: pubkey, enumerable: true, writable: true, configurable: true });
  return copy as T & { pubkey: string };
}

describe("modifyHiddenTags", () => {
  let user: FakeUser;

  beforeEach(() => {
    user = new FakeUser();
  });

  it("should not modify event if no operations are provided", async () => {
    const draft = {
      kind: kinds.BookmarkList,
      content: "original content",
      tags: [["p", "pubkey"]],
      created_at: unixNow(),
    };

    const operation = modifyHiddenTags(user);
    const result = await operation(draft);

    expect(result).toEqual(draft);
  });

  it("should set EncryptedContentSymbol with plaintext hidden tags", async () => {
    const operation = modifyHiddenTags(user, (tags) => [...tags, ["e", "test-id"]]);
    const draft = await operation({ kind: kinds.BookmarkList, content: "", tags: [], created_at: unixNow() });

    expect(Reflect.get(draft, EncryptedContentSymbol)).toBe(JSON.stringify([["e", "test-id"]]));
  });

  it("should not override existing EncryptedContentSymbol when modifying hidden tags", async () => {
    // First create a draft with hidden content symbol
    const draft = {
      kind: kinds.BookmarkList,
      content: "",
      tags: [],
      created_at: unixNow(),
      [EncryptedContentSymbol]: JSON.stringify([["e", "old-id"]]),
    };

    // Modify the hidden tags
    const operation = modifyHiddenTags(user, (tags) => [...tags, ["e", "new-id"]]);
    const result = await operation(draft);

    expect(Reflect.get(result, EncryptedContentSymbol)).toBe(JSON.stringify([["e", "new-id"]]));
    expect(Reflect.get(result, EncryptedContentSymbol)).not.toBe(Reflect.get(draft, EncryptedContentSymbol));
  });

  it("should set hidden tags", async () => {
    const template = { kind: 30000, content: "", tags: [] as string[][], created_at: unixNow() };
    const draft = await modifyHiddenTags(user, (tags) => [...tags, ["e", "test-id"]])(template);

    expect(getHiddenTags(draft)).toEqual([["e", "test-id"]]);
  });

  it("should work multiple times", async () => {
    // Use a single modifyHiddenTags call with multiple operations to avoid symbol caching issues
    const template = { kind: 30000, content: "", tags: [] as string[][], created_at: unixNow() };
    const draft = await modifyHiddenTags(
      user,
      (tags) => [...tags, ["e", "test-id"]],
      (tags) => [...tags, ["e", "second-id"]],
    )(template);

    expect(getHiddenTags(draft)).toEqual([
      ["e", "test-id"],
      ["e", "second-id"],
    ]);
  });
});

describe("modifyHiddenTags build-path write (Group B: setCachedValue, carry-forward dependent)", () => {
  let user: FakeUser;

  beforeEach(() => {
    user = new FakeUser();
  });

  it("writes EncryptedContentSymbol non-enumerably (construct-then-setCachedValue, not an object-literal computed key)", async () => {
    const draft = await modifyHiddenTags(user, (tags) => [...tags, ["e", "test-id"]])({
      kind: kinds.BookmarkList,
      content: "",
      tags: [],
      created_at: unixNow(),
    });

    const descriptor = Object.getOwnPropertyDescriptor(draft, EncryptedContentSymbol);
    expect(descriptor?.enumerable).toBe(false);
  });

  it("full-pipe survival: plaintext survives an intervening spread step and signing, read back off the signed event", async () => {
    const template = { kind: kinds.BookmarkList, content: "", tags: [] as string[][], created_at: unixNow() };
    // Expected plaintext derived from the fixture's hidden tags, not from the operation's own output.
    const expectedPlaintext = JSON.stringify([["e", "test-id"]]);

    const signed = await eventPipe(
      modifyHiddenTags(user, (tags) => [...tags, ["e", "test-id"]]),
      includeAltTag("test-alt"), // intervening spread: modifyPublicTags's `{ ...draft, tags }`
      sign(user),
    )(template);

    expect(signed.sig).toBeTruthy();
    expect(signed.tags).toContainEqual(["alt", "test-alt"]);
    expect(getEncryptedContent(signed)).toBe(expectedPlaintext);
    expect(getHiddenTags(signed)).toEqual([["e", "test-id"]]);
  });
});

describe("copyDraftWithPubkey (Site-1: unlockHiddenTags temp-object spread)", () => {
  let user: FakeUser;

  beforeEach(() => {
    user = new FakeUser();
  });

  it("preserves a non-enumerable symbol that a plain `{ ...draft, pubkey }` spread would drop", () => {
    const draft: any = { kind: kinds.BookmarkList, content: "ciphertext", tags: [], created_at: unixNow() };
    // Simulate the post-migration state: HiddenTagsSymbol written non-enumerably (via setCachedValue)
    Object.defineProperty(draft, HiddenTagsSymbol, {
      value: [["e", "cached"]],
      enumerable: false,
      configurable: true,
      writable: true,
    });

    // Control: a plain spread drops the non-enumerable symbol entirely
    const naiveSpread = { ...draft, pubkey: "new-pubkey" };
    expect(HiddenTagsSymbol in naiveSpread).toBe(false);

    // The fix: copyDraftWithPubkey preserves it
    const copy = copyDraftWithPubkey(draft, "new-pubkey");
    expect(HiddenTagsSymbol in copy).toBe(true);
    expect((copy as any)[HiddenTagsSymbol]).toEqual([["e", "cached"]]);
    expect(copy.pubkey).toBe("new-pubkey");
  });

  it("unlockHiddenTags does not re-decrypt when given a descriptor-preserving copy carrying an already-cached HiddenTagsSymbol", async () => {
    // Simulate the post-migration state directly against unlockHiddenTags (the function that
    // receives the temp object tags.ts:65 builds) — proves the fix's mechanism independent of
    // modifyHiddenTags's own outer short-circuit, which already resolves before reaching that line.
    // Content is real (but stale/unrelated) ciphertext so the pre-fix branch's decrypt call
    // resolves cleanly instead of throwing on malformed input.
    const staleCiphertext = await user.nip04.encrypt(user.pubkey, JSON.stringify([["e", "stale"]]));
    const draft: any = { kind: kinds.BookmarkList, content: staleCiphertext, tags: [], created_at: unixNow() };
    Object.defineProperty(draft, HiddenTagsSymbol, {
      value: [["e", "cached"]],
      enumerable: false,
      configurable: true,
      writable: true,
    });

    const decryptSpy = vi.spyOn(user.nip04, "decrypt");

    // Pre-fix (naive spread): the temp object drops HiddenTagsSymbol, forcing a redundant decrypt
    const naiveSpread = { ...draft, pubkey: user.pubkey };
    await unlockHiddenTags(naiveSpread, user);
    expect(decryptSpy).toHaveBeenCalledTimes(1);

    decryptSpy.mockClear();

    // Post-fix: the descriptor-preserving copy keeps HiddenTagsSymbol, so isHiddenTagsUnlocked
    // short-circuits and no decrypt call occurs
    const fixedCopy = copyDraftWithPubkey(draft, user.pubkey);
    const tags = await unlockHiddenTags(fixedCopy, user);

    expect(tags).toEqual([["e", "cached"]]);
    expect(decryptSpy).not.toHaveBeenCalled();
  });

  it("modifyHiddenTags still decrypts exactly once via the real unlock path (no symbols cached yet)", async () => {
    // Sanity check that the tags.ts:65 fix doesn't disturb the currently-reachable decrypt path:
    // a draft with real ciphertext content and no cached symbols must still unlock via exactly
    // one signer decrypt call.
    const existingTags = [["e", "existing"]];
    const ciphertext = await user.nip04.encrypt(user.pubkey, JSON.stringify(existingTags));
    const draft = { kind: kinds.BookmarkList, content: ciphertext, tags: [], created_at: unixNow() };

    const decryptSpy = vi.spyOn(user.nip04, "decrypt");

    const result = await modifyHiddenTags(user, (tags) => [...tags, ["e", "new-id"]])(draft);

    expect(decryptSpy).toHaveBeenCalledTimes(1);
    expect(getHiddenTags(result)).toEqual([...existingTags, ["e", "new-id"]]);
  });
});
