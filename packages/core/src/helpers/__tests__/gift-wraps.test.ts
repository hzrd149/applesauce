import { finalizeEvent, kinds, NostrEvent } from "nostr-tools";
import { wrapEvent } from "nostr-tools/nip59";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import {
  getGiftWrapRumor,
  getGiftWrapSeal,
  getRumorGiftWraps,
  getRumorSeals,
  getSealGiftWrap,
  getSealRumor,
  internalGiftWrapEvents,
  isGiftWrapUnlocked,
  isRumor,
  unlockGiftWrap,
  type Rumor,
} from "applesauce-common/helpers/gift-wrap";

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
