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
  const cases: Array<[string, GroupPointer, GroupPointer]> = [
    ["bare secure host", { relay: "relay.example.com", id: "group123" }, { relay: "wss://relay.example.com/", id: "group123" }],
    ["explicit secure host", { relay: "wss://relay.example.com", id: "group123" }, { relay: "wss://relay.example.com/", id: "group123" }],
    ["insecure host", { relay: "ws://relay.example.com", id: "group123" }, { relay: "ws://relay.example.com/", id: "group123" }],
    ["explicit port", { relay: "wss://relay.example.com:8443", id: "group123" }, { relay: "wss://relay.example.com:8443/", id: "group123" }],
    ["localhost port", { relay: "ws://localhost:4869", id: "group123" }, { relay: "ws://localhost:4869/", id: "group123" }],
    ["bracketed IPv6", { relay: "wss://[::1]:7447", id: "group123" }, { relay: "wss://[::1]:7447/", id: "group123" }],
    ["path and query", { relay: "wss://relay.example.com/socket?token=abc", id: "group123" }, { relay: "wss://relay.example.com/socket?token=abc", id: "group123" }],
    ["apostrophe id", { relay: "wss://relay.example.com", id: "room'with'apostrophes" }, { relay: "wss://relay.example.com/", id: "room'with'apostrophes" }],
    ["default id", { relay: "wss://relay.example.com", id: "" }, { relay: "wss://relay.example.com/", id: "_" }],
  ];

  it.each(cases)("round-trips %s", (_name, input, expected) => {
    expect(decodeGroupPointer(encodeGroupPointer(input))).toEqual(expected);
  });

  it.each(["'group123", "relay.example.com/#section'group123", "wss://relay.example.com/path#section'group123"])(
    "rejects invalid compatibility pointer %s",
    (pointer) => expect(decodeGroupPointer(pointer)).toBeNull(),
  );
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
