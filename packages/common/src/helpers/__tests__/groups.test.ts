import { NostrEvent } from "applesauce-core/helpers/event";
import { HiddenContentSigner } from "applesauce-core/helpers/hidden-content";
import { isHiddenTagsUnlocked, unlockHiddenTags } from "applesauce-core/helpers/hidden-tags";
import { describe, expect, it } from "vitest";
import {
  decodeGroupPointer,
  encodeGroupPointer,
  getHiddenGroups,
  GROUPS_LIST_KIND,
  GroupPointer,
  unlockHiddenGroups,
} from "../groups.js";

// A trivial reversible "encryption" - no real crypto needed to exercise the lock/unlock lifecycle
const signer: HiddenContentSigner = {
  nip04: {
    encrypt: (_pubkey: string, plaintext: string) => `nip04:${plaintext}`,
    decrypt: (_pubkey: string, ciphertext: string) => ciphertext.slice("nip04:".length),
  },
};

function createLockedGroupsBookmark(hiddenTags: string[][]): NostrEvent {
  return {
    id: "test-id",
    pubkey: "test-pubkey",
    created_at: 0,
    kind: GROUPS_LIST_KIND,
    tags: [],
    content: `nip04:${JSON.stringify(hiddenTags)}`,
    sig: "test-sig",
  };
}

describe("Group pointer utilities", () => {
  describe("decodeGroupPointer", () => {
    it("should decode a valid group pointer", () => {
      const pointer = decodeGroupPointer("relay.example.com'group123");
      expect(pointer).toEqual({
        relay: "wss://relay.example.com/",
        id: "group123",
      });
    });

    it("should add wss:// protocol if missing", () => {
      const pointer = decodeGroupPointer("relay.example.com'group123");
      expect(pointer?.relay).toBe("wss://relay.example.com/");
    });

    it("should preserve existing protocol if present", () => {
      const pointer = decodeGroupPointer("wss://relay.example.com'group123");
      expect(pointer?.relay).toBe("wss://relay.example.com/");

      const wsPointer = decodeGroupPointer("ws://relay.example.com'group123");
      expect(wsPointer?.relay).toBe("ws://relay.example.com/");
    });

    it("should handle default group id", () => {
      const pointer = decodeGroupPointer("relay.example.com'");
      expect(pointer).toEqual({
        relay: "wss://relay.example.com/",
        id: "_",
      });
    });

    it("should return null if relay is missing", () => {
      expect(decodeGroupPointer("'group123")).toBe(null);
    });
  });

  describe("encodeGroupPointer", () => {
    it("should encode a valid group pointer", () => {
      const pointer: GroupPointer = {
        relay: "wss://relay.example.com",
        id: "group123",
      };
      expect(encodeGroupPointer(pointer)).toBe("relay.example.com'group123");
    });

    it("should strip protocol from relay", () => {
      const pointer: GroupPointer = {
        relay: "wss://relay.example.com",
        id: "group123",
      };
      expect(encodeGroupPointer(pointer)).toBe("relay.example.com'group123");

      const wsPointer: GroupPointer = {
        relay: "ws://relay.example.com",
        id: "group123",
      };
      expect(encodeGroupPointer(wsPointer)).toBe("relay.example.com'group123");
    });

    it("should handle invalid URLs by using the raw value", () => {
      const pointer: GroupPointer = {
        relay: "invalid-url",
        id: "group123",
      };
      expect(encodeGroupPointer(pointer)).toBe("invalid-url'group123");
    });
  });
});

describe("getHiddenGroups / unlockHiddenGroups", () => {
  it("never resolves a poisoned undefined memo after the hidden tags are unlocked by another path (D-02/D-03)", async () => {
    // Hand-derived from the NIP-51 "group" tag shape: [tag, id, relay, name?]
    const hiddenTags: string[][] = [["group", "group123", "wss://relay.example.com", "Group 123"]];
    const expectedGroups: GroupPointer[] = [{ id: "group123", relay: "wss://relay.example.com", name: "Group 123" }];

    const bookmark = createLockedGroupsBookmark(hiddenTags);

    // Calling getHiddenGroups while the hidden tags are still locked must not permanently poison
    // the memo with `undefined`.
    expect(getHiddenGroups(bookmark)).toBeUndefined();

    // Unlock the hidden tags via a path other than unlockHiddenGroups
    await unlockHiddenTags(bookmark, signer);
    expect(isHiddenTagsUnlocked(bookmark)).toBe(true);

    // unlockHiddenGroups must return the real groups, never resolve the poisoned undefined
    // memo (which would bypass its own `if (!groups) throw` guard).
    const groups = await unlockHiddenGroups(bookmark, signer);
    expect(groups).toEqual(expectedGroups);
  });
});
