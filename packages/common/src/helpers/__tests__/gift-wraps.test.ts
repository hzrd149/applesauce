import { setEncryptedContentCache, unlockEncryptedContent } from "applesauce-core/helpers/encrypted-content";
import { finalizeEvent, kinds, NostrEvent } from "applesauce-core/helpers/event";
import { wrapEvent } from "nostr-tools/nip59";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import {
  GiftWrapSymbol,
  getGiftWrapRumor,
  getGiftWrapSeal,
  getRumorGiftWraps,
  getRumorSeals,
  getSealGiftWrap,
  getSealRumor,
  internalGiftWrapEvents,
  isGiftWrapUnlocked,
  isRumor,
  isSealUnlocked,
  RumorSymbol,
  SealSymbol,
  unlockGiftWrap,
  unlockSeal,
  type Rumor,
} from "../gift-wrap.js";

let alice: FakeUser;
let bob: FakeUser;
let charlie: FakeUser;

beforeEach(() => {
  internalGiftWrapEvents.reset();
  alice = new FakeUser();
  bob = new FakeUser();
  charlie = new FakeUser();
});

describe("isRumor", () => {
  it("should return true for valid rumor", () => {
    const rumor = {
      id: "a".repeat(64),
      pubkey: alice.pubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: kinds.ShortTextNote,
      tags: [],
      content: "Hello world",
    };

    expect(isRumor(rumor)).toBe(true);
  });

  it("should return false for signed event", () => {
    const event = alice.note("Hello world");
    expect(isRumor(event)).toBe(false);
  });

  it("should return false for invalid input", () => {
    expect(isRumor(null)).toBe(false);
    expect(isRumor(undefined)).toBe(false);
    expect(isRumor({})).toBe(false);
    expect(isRumor({ id: "invalid" })).toBe(false);
  });
});

describe("gift wrap reference management", () => {
  let giftWrapEvent: NostrEvent;
  let rumorEvent: Rumor;

  beforeEach(async () => {
    // Create a rumor event (unsigned event)
    rumorEvent = {
      id: "b".repeat(64),
      pubkey: alice.pubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: kinds.PrivateDirectMessage,
      tags: [["p", bob.pubkey]],
      content: "This is a private message",
    };

    // Create a gift wrap event
    giftWrapEvent = wrapEvent(rumorEvent, alice.key, bob.pubkey);
  });

  it("should be locked initially", () => {
    expect(isGiftWrapUnlocked(giftWrapEvent)).toBe(false);
  });

  describe("after unlocking", () => {
    beforeEach(async () => {
      await unlockGiftWrap(giftWrapEvent, bob);
    });

    it("should not be locked after unlocking", () => {
      expect(isGiftWrapUnlocked(giftWrapEvent)).toBe(true);
    });

    it("should have seal event reference on gift wrap", () => {
      const seal = getGiftWrapSeal(giftWrapEvent);
      expect(seal).toBeDefined();
      expect(seal!.kind).toBe(kinds.Seal);
    });

    it("should have rumor event reference on gift wrap", () => {
      const rumor = getGiftWrapRumor(giftWrapEvent);
      expect(rumor).toBeDefined();
      expect(rumor!.content).toBe(rumorEvent.content);
    });

    it("seal events should always have references to their parent gift wrap event", () => {
      const seal = getGiftWrapSeal(giftWrapEvent);
      expect(seal).toBeDefined();

      const parentGiftWraps = getSealGiftWrap(seal!);
      expect(parentGiftWraps).toBe(giftWrapEvent);
    });

    it("rumor events should always have references to their parent seal and gift wrap event", () => {
      const rumor = getGiftWrapRumor(giftWrapEvent);
      const seal = getGiftWrapSeal(giftWrapEvent);

      expect(rumor).toBeDefined();
      expect(seal).toBeDefined();

      // Rumor should reference its parent seal
      const parentSeals = getRumorSeals(rumor!);
      expect(parentSeals).toContain(seal!);

      // Rumor should reference its parent gift wrap
      const parentGiftWraps = getRumorGiftWraps(rumor!);
      expect(parentGiftWraps).toContain(giftWrapEvent);
    });

    it("gift wraps should always have a reference to the rumor and seal event", () => {
      const seal = getGiftWrapSeal(giftWrapEvent);
      const rumor = getGiftWrapRumor(giftWrapEvent);

      expect(seal).toBeDefined();
      expect(rumor).toBeDefined();
    });
  });
});

describe("unlockGiftWrap in various states", () => {
  let giftWrapEvent: NostrEvent;
  let rumorEvent: Rumor;

  beforeEach(async () => {
    rumorEvent = {
      id: "c".repeat(64),
      pubkey: alice.pubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: kinds.ShortTextNote,
      tags: [["p", bob.pubkey]],
      content: "Test message for unlocking states",
    };

    // Create a gift wrap event
    giftWrapEvent = wrapEvent(rumorEvent, alice.key, bob.pubkey);
  });

  it("should unlock when both gift wrap and seal are locked", async () => {
    expect(isGiftWrapUnlocked(giftWrapEvent)).toBe(false);

    const rumor = await unlockGiftWrap(giftWrapEvent, bob);

    expect(rumor).toBeDefined();
    expect(rumor.content).toBe(rumorEvent.content);
    expect(isGiftWrapUnlocked(giftWrapEvent)).toBe(true);
  });

  it("should handle already unlocked gift wrap", async () => {
    // First unlock
    await unlockGiftWrap(giftWrapEvent, bob);
    expect(isGiftWrapUnlocked(giftWrapEvent)).toBe(true);

    // Unlock again - should work without issues
    const rumor = await unlockGiftWrap(giftWrapEvent, bob);
    expect(rumor).toBeDefined();
    expect(rumor.content).toBe(rumorEvent.content);
  });

  it("should throw error when failing to read seal", async () => {
    // Corrupt the gift wrap content to make seal unreadable
    giftWrapEvent.content = "invalid content";

    await expect(unlockGiftWrap(giftWrapEvent, bob)).rejects.toThrow();
  });
});

describe("cross-referencing integrity", () => {
  let giftWrapEvent: NostrEvent;
  let rumorEvent: Rumor;

  beforeEach(async () => {
    rumorEvent = {
      id: "e".repeat(64),
      pubkey: alice.pubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: kinds.ShortTextNote,
      tags: [["p", bob.pubkey]],
      content: "Test message for cross-referencing",
    };

    // Create a gift wrap event
    giftWrapEvent = wrapEvent(rumorEvent, alice.key, bob.pubkey);

    await unlockGiftWrap(giftWrapEvent, bob);
  });

  it("should maintain consistent references across all levels", () => {
    const seal = getGiftWrapSeal(giftWrapEvent);
    const rumor = getGiftWrapRumor(giftWrapEvent);

    expect(seal).toBeDefined();
    expect(rumor).toBeDefined();

    // Test bidirectional references
    expect(getSealGiftWrap(seal!)).toBe(giftWrapEvent);
    expect(getRumorGiftWraps(rumor!)).toContain(giftWrapEvent);
    expect(getRumorSeals(rumor!)).toContain(seal!);
    expect(getSealRumor(seal!)).toBe(rumor);
  });

  it("should preserve references after multiple operations", () => {
    const seal = getGiftWrapSeal(giftWrapEvent);
    const rumor = getGiftWrapRumor(giftWrapEvent);

    // Perform multiple gets to ensure caching doesn't break references
    for (let i = 0; i < 5; i++) {
      expect(getGiftWrapSeal(giftWrapEvent)).toBe(seal);
      expect(getGiftWrapRumor(giftWrapEvent)).toBe(rumor);
      expect(getSealRumor(seal!)).toBe(rumor);
    }

    // References should still be intact
    expect(getSealGiftWrap(seal!)).toBe(giftWrapEvent);
    expect(getRumorGiftWraps(rumor!)).toContain(giftWrapEvent);
    expect(getRumorSeals(rumor!)).toContain(seal!);
  });
});

describe("error handling", () => {
  it("should handle invalid gift wrap gracefully", () => {
    const invalidGiftWrap = alice.event({
      kind: kinds.GiftWrap,
      content: "invalid content",
    });

    expect(getGiftWrapSeal(invalidGiftWrap)).toBeUndefined();
    expect(getGiftWrapRumor(invalidGiftWrap)).toBeUndefined();
  });

  it("should handle missing references gracefully", () => {
    const seal = alice.event({ kind: kinds.Seal, content: "test" });

    expect(getSealGiftWrap(seal)).toBeUndefined();
    expect(getRumorSeals({} as Rumor)).toEqual([]);
    expect(getRumorGiftWraps({} as Rumor)).toEqual([]);
  });
});

describe("multiple gift wraps with same rumor", () => {
  let rumorEvent: Rumor;
  let giftWrapToBob: NostrEvent;
  let giftWrapToCharlie: NostrEvent;

  beforeEach(async () => {
    // Create a single rumor event that will be wrapped multiple times
    rumorEvent = finalizeEvent(
      {
        created_at: Math.floor(Date.now() / 1000),
        kind: kinds.ShortTextNote,
        tags: [
          ["p", bob.pubkey],
          ["p", charlie.pubkey],
        ],
        content: "Message to multiple recipients",
      },
      alice.key,
    );

    // Create gift wraps to different recipients with the same rumor
    giftWrapToBob = wrapEvent(rumorEvent, alice.key, bob.pubkey);
    giftWrapToCharlie = wrapEvent(rumorEvent, alice.key, charlie.pubkey);

    // Unlock both gift wraps
    await unlockGiftWrap(giftWrapToBob, bob);
    await unlockGiftWrap(giftWrapToCharlie, charlie);
  });

  it("should return the same rumor instance from multiple gift wraps", () => {
    const rumorFromBob = getGiftWrapRumor(giftWrapToBob);
    const rumorFromCharlie = getGiftWrapRumor(giftWrapToCharlie);

    expect(rumorFromBob).toBeDefined();
    expect(rumorFromCharlie).toBeDefined();

    // Should be the exact same instance (reference equality)
    expect(rumorFromBob).toBe(rumorFromCharlie);

    // Should match the original rumor data
    expect(rumorFromBob!.content).toBe(rumorEvent.content);
    expect(rumorFromBob!.id).toBe(rumorEvent.id);
  });

  it("should track all upstream seals from multiple gift wraps", () => {
    const rumor = getGiftWrapRumor(giftWrapToBob);
    const sealToBob = getGiftWrapSeal(giftWrapToBob);
    const sealToCharlie = getGiftWrapSeal(giftWrapToCharlie);

    expect(rumor).toBeDefined();
    expect(sealToBob).toBeDefined();
    expect(sealToCharlie).toBeDefined();

    const parentSeals = getRumorSeals(rumor!);

    // Rumor should reference both seals
    expect(parentSeals).toContain(sealToBob!);
    expect(parentSeals).toContain(sealToCharlie!);
    expect(parentSeals).toHaveLength(2);
  });

  it("should track all upstream gift wraps from multiple gift wraps", () => {
    const rumor = getGiftWrapRumor(giftWrapToBob);

    expect(rumor).toBeDefined();

    const parentGiftWraps = getRumorGiftWraps(rumor!);

    // Rumor should reference both gift wraps
    expect(parentGiftWraps).toContain(giftWrapToBob);
    expect(parentGiftWraps).toContain(giftWrapToCharlie);
    expect(parentGiftWraps).toHaveLength(2);
  });

  it("should maintain consistent bidirectional references", () => {
    const rumor = getGiftWrapRumor(giftWrapToBob);
    const sealToBob = getGiftWrapSeal(giftWrapToBob);
    const sealToCharlie = getGiftWrapSeal(giftWrapToCharlie);

    expect(rumor).toBeDefined();
    expect(sealToBob).toBeDefined();
    expect(sealToCharlie).toBeDefined();

    // Each seal should reference back to its respective gift wrap
    expect(getSealGiftWrap(sealToBob!)).toBe(giftWrapToBob);
    expect(getSealGiftWrap(sealToCharlie!)).toBe(giftWrapToCharlie);

    // Each seal should reference the same rumor instance
    expect(getSealRumor(sealToBob!)).toBe(rumor);
    expect(getSealRumor(sealToCharlie!)).toBe(rumor);

    // Each gift wrap should reference the same rumor instance
    expect(getGiftWrapRumor(giftWrapToBob)).toBe(rumor);
    expect(getGiftWrapRumor(giftWrapToCharlie)).toBe(rumor);
  });

  it("should handle additional gift wraps added later", async () => {
    // Get initial state
    const rumor = getGiftWrapRumor(giftWrapToBob);
    const initialGiftWraps = getRumorGiftWraps(rumor!);
    const initialSeals = getRumorSeals(rumor!);

    expect(initialGiftWraps).toHaveLength(2);
    expect(initialSeals).toHaveLength(2);

    // Create another fake user and add another gift wrap
    const dave = new FakeUser();
    const giftWrapToDave = wrapEvent(rumorEvent, alice.key, dave.pubkey);
    await unlockGiftWrap(giftWrapToDave, dave);

    // Should still return the same rumor instance
    const rumorFromDave = getGiftWrapRumor(giftWrapToDave);
    expect(rumorFromDave).toBe(rumor);

    // Should now track all three gift wraps and seals
    const updatedGiftWraps = getRumorGiftWraps(rumor!);
    const updatedSeals = getRumorSeals(rumor!);

    expect(updatedGiftWraps).toHaveLength(3);
    expect(updatedSeals).toHaveLength(3);
    expect(updatedGiftWraps).toContain(giftWrapToBob);
    expect(updatedGiftWraps).toContain(giftWrapToCharlie);
    expect(updatedGiftWraps).toContain(giftWrapToDave);
  });
});

describe("setCachedValue migration — non-enumerable accumulated-state writes", () => {
  it("SealSymbol Set-init (getRumorSeals) is non-enumerable and later .add() mutates the same Set", () => {
    const rumor = {
      id: "f".repeat(64),
      pubkey: alice.pubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: kinds.ShortTextNote,
      tags: [],
      content: "standalone rumor",
    } as unknown as Rumor;

    // Lazily initializes the Set (gift-wrap.ts:95)
    expect(getRumorSeals(rumor)).toEqual([]);

    // Non-enumerable: not visible via Reflect.ownKeys' enumerable check, nor plain spread
    const descriptor = Object.getOwnPropertyDescriptor(rumor, SealSymbol);
    expect(descriptor?.enumerable).toBe(false);
    expect(Object.getOwnPropertySymbols({ ...rumor })).not.toContain(SealSymbol);

    // Same Set reference: mutating it directly (as addParentSealReference does) is reflected
    const seal = alice.event({ kind: kinds.Seal, content: "seal-content" });
    const set = Reflect.get(rumor, SealSymbol) as Set<NostrEvent>;
    set.add(seal);
    expect(getRumorSeals(rumor)).toContain(seal);
  });

  it("SealSymbol Set-init (addParentSealReference, via unlock) is non-enumerable and keeps accumulating via .add()", async () => {
    const rumorEvent = {
      id: "g".repeat(64),
      pubkey: alice.pubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: kinds.ShortTextNote,
      tags: [["p", bob.pubkey]],
      content: "accumulated seal reference",
    };
    const giftWrap = wrapEvent(rumorEvent, alice.key, bob.pubkey);

    const rumor = await unlockGiftWrap(giftWrap, bob);
    const seal = getGiftWrapSeal(giftWrap)!;

    const descriptor = Object.getOwnPropertyDescriptor(rumor, SealSymbol);
    expect(descriptor?.enumerable).toBe(false);
    expect(Object.getOwnPropertySymbols({ ...rumor })).not.toContain(SealSymbol);

    // The underlying Set still accepts later .add() calls (writable descriptor)
    const anotherSeal = alice.event({ kind: kinds.Seal, content: "another-seal" });
    const parents = Reflect.get(rumor, SealSymbol) as Set<NostrEvent>;
    parents.add(anotherSeal);
    expect(getRumorSeals(rumor)).toContain(seal);
    expect(getRumorSeals(rumor)).toContain(anotherSeal);
  });

  it("RumorSymbol success write (getSealRumor) is non-enumerable and dropped by a plain spread", async () => {
    const rumorEvent = {
      id: "h".repeat(64),
      pubkey: alice.pubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: kinds.ShortTextNote,
      tags: [["p", bob.pubkey]],
      content: "rumor symbol enumerability",
    };
    const giftWrap = wrapEvent(rumorEvent, alice.key, bob.pubkey);

    await unlockGiftWrap(giftWrap, bob);
    const seal = getGiftWrapSeal(giftWrap)!;

    expect(RumorSymbol in seal).toBe(true);
    const descriptor = Object.getOwnPropertyDescriptor(seal, RumorSymbol);
    expect(descriptor?.enumerable).toBe(false);
    expect(Object.getOwnPropertySymbols({ ...seal })).not.toContain(RumorSymbol);
  });

  it("a rumor that fails to parse writes no RumorSymbol at all", async () => {
    // Build a seal event with content that decrypts fine but fails to parse as a rumor
    const seal = alice.event({ kind: kinds.Seal, content: "encrypted-placeholder" });
    setEncryptedContentCache(seal, "not valid json{{{");

    expect(getSealRumor(seal)).toBeUndefined();

    // No sentinel of any kind. Caching `undefined` here would make the presence checks in
    // isSealUnlocked/unlockSeal report this seal as unlocked and hand back `undefined` typed
    // as a Rumor, and would poison the seal permanently.
    expect(Reflect.has(seal, RumorSymbol)).toBe(false);

    // The consequences that invariant protects, asserted directly rather than inferred.
    expect(isSealUnlocked(seal)).toBe(false);
    await expect(unlockSeal(seal, alice)).rejects.toThrow();

    // And the rejection is not sticky: once the content parses, the seal resolves normally.
    const rumor = {
      id: "f".repeat(64),
      pubkey: alice.pubkey,
      created_at: 1700000000,
      kind: kinds.PrivateDirectMessage,
      tags: [],
      content: "now parseable",
    };
    setEncryptedContentCache(seal, JSON.stringify(rumor));
    expect(getSealRumor(seal)?.content).toBe("now parseable");
  });

  it("a rejected seal caches nothing on either the wrap or the seal", () => {
    // The verification guards must return before any setCachedValue, so a rejected seal leaves
    // no memo that a later call would read back.
    const forged = {
      id: "a".repeat(64),
      pubkey: alice.pubkey,
      created_at: 1700000000,
      kind: kinds.Seal,
      tags: [],
      content: "forged",
      sig: "0".repeat(128),
    };
    const wrap = charlie.event({ kind: kinds.GiftWrap, content: "ignored" });
    setEncryptedContentCache(wrap, JSON.stringify(forged));

    expect(getGiftWrapSeal(wrap)).toBeUndefined();
    expect(Reflect.has(wrap, SealSymbol)).toBe(false);

    // JSON round-trip first: alice.event() finalizes, and finalizeEvent stamps
    // verifiedSymbol = true, so mutating the object in place would hit that memo and verify.
    const badSeal: NostrEvent = {
      ...JSON.parse(JSON.stringify(alice.event({ kind: kinds.Seal, content: "encrypted-placeholder" }))),
      sig: "0".repeat(128),
    };
    setEncryptedContentCache(badSeal, JSON.stringify({ ...forged, sig: undefined }));
    expect(getSealRumor(badSeal)).toBeUndefined();
    expect(Reflect.has(badSeal, RumorSymbol)).toBe(false);
  });

  it("GiftWrapSymbol and SealSymbol writes in getGiftWrapSeal are non-enumerable and dropped by a plain spread", async () => {
    const rumorEvent = {
      id: "i".repeat(64),
      pubkey: alice.pubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: kinds.ShortTextNote,
      tags: [["p", bob.pubkey]],
      content: "gift-wrap/seal symbol enumerability",
    };
    const giftWrap = wrapEvent(rumorEvent, alice.key, bob.pubkey);

    await unlockGiftWrap(giftWrap, bob);
    const seal = getGiftWrapSeal(giftWrap)!;

    // GiftWrapSymbol on the seal (upstream reference, gift-wrap.ts:217)
    const giftWrapDescriptor = Object.getOwnPropertyDescriptor(seal, GiftWrapSymbol);
    expect(giftWrapDescriptor?.enumerable).toBe(false);
    expect(Object.getOwnPropertySymbols({ ...seal })).not.toContain(GiftWrapSymbol);
    expect(getSealGiftWrap(seal)).toBe(giftWrap);

    // SealSymbol on the gift wrap (downstream reference, gift-wrap.ts:222)
    const sealDescriptor = Object.getOwnPropertyDescriptor(giftWrap, SealSymbol);
    expect(sealDescriptor?.enumerable).toBe(false);
    expect(Object.getOwnPropertySymbols({ ...giftWrap })).not.toContain(SealSymbol);
    expect(getGiftWrapSeal(giftWrap)).toBe(seal);
  });
});

describe("seal signature verification", () => {
  // The seal's signature is the only authorship proof in a NIP-59 envelope, so these assert
  // against independently-constructed hostile input rather than against helper output.
  //
  // Every hostile seal below is handed to the helper as a JSON *string*. That matters: the
  // helper's own safeParse then yields a fresh object, which guarantees no `verifiedSymbol`
  // rides along from however the fixture was built. nostr-tools' finalizeEvent stamps
  // verifiedSymbol = true via plain (enumerable) assignment, so a spread of a finalized event
  // would carry a forged "already verified" verdict and make these tests vacuous.
  const sealFields = (user: FakeUser, content: string) =>
    JSON.parse(
      JSON.stringify(finalizeEvent({ kind: kinds.Seal, created_at: 1700000000, tags: [], content }, user.key)),
    );

  it("rejects a seal carrying an invalid signature", () => {
    const forged = { ...sealFields(alice, "sealed"), sig: "0".repeat(128) };

    const wrap = charlie.event({ kind: kinds.GiftWrap, content: "ignored" });
    setEncryptedContentCache(wrap, JSON.stringify(forged));

    expect(getGiftWrapSeal(wrap)).toBeUndefined();
    expect(getGiftWrapRumor(wrap)).toBeUndefined();
  });

  it("rejects a seal whose id does not hash its own content", () => {
    // Valid signature over the ORIGINAL content, then content swapped — id no longer matches.
    const tampered = { ...sealFields(alice, "sealed"), content: "swapped after signing" };

    const wrap = charlie.event({ kind: kinds.GiftWrap, content: "ignored" });
    setEncryptedContentCache(wrap, JSON.stringify(tampered));

    expect(getGiftWrapSeal(wrap)).toBeUndefined();
  });

  it("does not hand back a stored seal to a wrap that merely claims its id", async () => {
    // The dedupe lookup in getGiftWrapSeal is keyed on an id taken from sender-controlled JSON.
    // Verifying only on the cache-miss branch would let a co-recipient — who legitimately knows
    // a seal's id, since NIP-17 gives every recipient the same seal — bind that seal to a wrap
    // of their own. Verifying BEFORE the lookup is what closes it.
    const rumor: Rumor = {
      id: "c".repeat(64),
      pubkey: alice.pubkey,
      created_at: 1700000000,
      kind: kinds.PrivateDirectMessage,
      tags: [["p", bob.pubkey]],
      content: "genuine message",
    };
    const genuineWrap = wrapEvent(rumor, alice.key, bob.pubkey);
    await unlockGiftWrap(genuineWrap, bob);
    const genuineSeal = getGiftWrapSeal(genuineWrap)!;

    // Precondition: the genuine seal really is in the internal set, so the lookup would hit.
    expect(internalGiftWrapEvents.getEvent(genuineSeal.id)).toBeDefined();

    const spoof = {
      id: genuineSeal.id,
      pubkey: charlie.pubkey,
      created_at: 1700000000,
      kind: kinds.Seal,
      tags: [],
      content: "attacker chosen",
      sig: "0".repeat(128),
    };
    const attackWrap = charlie.event({ kind: kinds.GiftWrap, content: "ignored" });
    setEncryptedContentCache(attackWrap, JSON.stringify(spoof));

    expect(getGiftWrapSeal(attackWrap)).toBeUndefined();
    expect(getSealGiftWrap(genuineSeal)).toBe(genuineWrap);

    // Discriminating control: the genuine wrap still resolves, so the guard is selective
    // rather than a blanket rejection.
    expect(getGiftWrapSeal(genuineWrap)).toBe(genuineSeal);
  });

  it("rejects an unverified seal passed directly to getSealRumor", () => {
    // getSealRumor and unlockSeal are exported and take any NostrEvent, so a consumer can hand
    // in a seal that never passed through getGiftWrapSeal. Without a check here, the
    // rumor.pubkey === seal.pubkey binding would be comparing against an unverified pubkey.
    const genuine = sealFields(alice, "sealed");
    const tampered: NostrEvent = { ...genuine, pubkey: charlie.pubkey };

    const rumor = {
      id: "d".repeat(64),
      pubkey: charlie.pubkey,
      created_at: 1700000000,
      kind: kinds.PrivateDirectMessage,
      tags: [],
      content: "attributed to charlie",
    };
    setEncryptedContentCache(tampered, JSON.stringify(rumor));

    expect(getSealRumor(tampered)).toBeUndefined();

    // Discriminating control: the untouched seal yields its rumor, so the rejection above is
    // caused by the failed verification and not by the fixture shape.
    const honest: NostrEvent = { ...genuine };
    const honestRumor = {
      id: "e".repeat(64),
      pubkey: alice.pubkey,
      created_at: 1700000000,
      kind: kinds.PrivateDirectMessage,
      tags: [],
      content: "attributed to alice",
    };
    setEncryptedContentCache(honest, JSON.stringify(honestRumor));
    expect(getSealRumor(honest)?.content).toBe("attributed to alice");
  });
});

describe("seal/rumor author mismatch", () => {
  // Build a seal alice really signed, whose rumor claims charlie as author.
  const mismatchedSeal = (): NostrEvent => {
    const seal: NostrEvent = JSON.parse(
      JSON.stringify(finalizeEvent({ kind: kinds.Seal, created_at: 1700000000, tags: [], content: "x" }, alice.key)),
    );
    setEncryptedContentCache(
      seal,
      JSON.stringify({
        id: "9".repeat(64),
        pubkey: charlie.pubkey,
        created_at: 1700000000,
        kind: kinds.PrivateDirectMessage,
        tags: [],
        content: "forged authorship",
      }),
    );
    return seal;
  };

  it("returns undefined rather than throwing", () => {
    const seal = mismatchedSeal();

    expect(() => getSealRumor(seal)).not.toThrow();
    expect(getSealRumor(seal)).toBeUndefined();
  });

  it("caches nothing and leaves the rejected rumor out of the internal event set", () => {
    const seal = mismatchedSeal();

    expect(getSealRumor(seal)).toBeUndefined();

    // No memo on the seal, so the rejection is not sticky and the seal is not reported unlocked.
    expect(Reflect.has(seal, RumorSymbol)).toBe(false);
    expect(isSealUnlocked(seal)).toBe(false);

    // The rejected rumor must not be retained — it was previously added to the set BEFORE the
    // author check ran, so a rumor the helper refuses to return still ended up stored.
    expect(internalGiftWrapEvents.getEvent("9".repeat(64))).toBeUndefined();
  });

  it("one bad wrap does not stop the rest of a timeline from resolving", async () => {
    // The reason this returns undefined instead of throwing. WrappedMessagesModel maps
    // getGiftWrapRumor over the whole gift-wrap timeline inside an RxJS map; a throw there
    // errors the observable, which is terminal, killing every message rather than one.
    const good: Rumor = {
      id: "8".repeat(64),
      pubkey: alice.pubkey,
      created_at: 1700000000,
      kind: kinds.PrivateDirectMessage,
      tags: [["p", bob.pubkey]],
      content: "legitimate message",
    };
    const goodWrap = wrapEvent(good, alice.key, bob.pubkey);
    await unlockGiftWrap(goodWrap, bob);

    // A real wrap carrying a real alice-signed seal, whose decrypted payload claims charlie as
    // author. The forged payload has to be planted at the seal's plaintext layer: wrapEvent
    // cannot produce this, because nip59's createRumor hardcodes `pubkey: getPublicKey(key)`,
    // and routing a seal through JSON.stringify would drop its content cache so the wrap would
    // fail earlier at the `!content` guard — either shortcut makes this test vacuous.
    const badWrap = wrapEvent(good, alice.key, bob.pubkey);
    await unlockEncryptedContent(badWrap, badWrap.pubkey, bob);
    const badSeal = getGiftWrapSeal(badWrap)!;
    setEncryptedContentCache(
      badSeal,
      JSON.stringify({ ...good, id: "7".repeat(64), pubkey: charlie.pubkey, content: "forged authorship" }),
    );

    const timeline = [badWrap, goodWrap];
    let rumors: (Rumor | undefined)[] = [];
    expect(() => {
      rumors = timeline.map((gift) => getGiftWrapRumor(gift));
    }).not.toThrow();

    // Exactly the shape the real models use: map, then filter out the undefined.
    const resolved = rumors.filter((r) => !!r);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.content).toBe("legitimate message");
  });
});
