import { unlockHiddenTags } from "applesauce-core/helpers/hidden-tags";
import { EventPointer } from "applesauce-core/helpers/pointers";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import {
  getAddressPointersFromList,
  getEventPointersFromList,
  getProfilePointersFromList,
  getRelaysFromList,
  isEventPointerInList,
} from "../lists.js";

const user = new FakeUser();

describe("list helpers cache by ReadListTags", () => {
  it("does not cache hidden/all values before hidden tags are unlocked", async () => {
    const hiddenEventId = "b".repeat(64);
    const publicEventId = "a".repeat(64);
    const hiddenTags = [
      ["e", hiddenEventId],
      ["a", `30023:${user.pubkey}:hidden-article`],
      ["p", "f".repeat(64)],
      ["relay", "wss://hidden-relay.example"],
    ];

    const list = user.list(
      [
        ["e", publicEventId],
        ["a", `30023:${user.pubkey}:public-article`],
        ["p", "e".repeat(64)],
        ["relay", "wss://public-relay.example"],
      ],
      { content: await user.nip04.encrypt(user.pubkey, JSON.stringify(hiddenTags)) },
    );

    expect(getEventPointersFromList(list, "hidden")).toEqual([]);
    expect(getAddressPointersFromList(list, "hidden")).toEqual([]);
    expect(getProfilePointersFromList(list, "hidden")).toEqual([]);
    expect(getRelaysFromList(list, "hidden")).toEqual([]);

    expect(getEventPointersFromList(list, "all")).toEqual([expect.objectContaining({ id: publicEventId })]);
    expect(getAddressPointersFromList(list, "all")).toEqual([
      expect.objectContaining({ kind: 30023, pubkey: user.pubkey, identifier: "public-article" }),
    ]);
    expect(getProfilePointersFromList(list, "all")).toEqual([expect.objectContaining({ pubkey: "e".repeat(64) })]);
    expect(getRelaysFromList(list, "all")).toEqual(["wss://public-relay.example/"]);

    await unlockHiddenTags(list, user);

    expect(getEventPointersFromList(list, "hidden")).toEqual([expect.objectContaining({ id: hiddenEventId })]);
    expect(getAddressPointersFromList(list, "hidden")).toEqual([
      expect.objectContaining({ kind: 30023, pubkey: user.pubkey, identifier: "hidden-article" }),
    ]);
    expect(getProfilePointersFromList(list, "hidden")).toEqual([expect.objectContaining({ pubkey: "f".repeat(64) })]);
    expect(getRelaysFromList(list, "hidden")).toEqual(["wss://hidden-relay.example/"]);

    expect(getEventPointersFromList(list, "all")).toEqual([
      expect.objectContaining({ id: hiddenEventId }),
      expect.objectContaining({ id: publicEventId }),
    ]);
    expect(getAddressPointersFromList(list, "all")).toEqual([
      expect.objectContaining({ kind: 30023, pubkey: user.pubkey, identifier: "hidden-article" }),
      expect.objectContaining({ kind: 30023, pubkey: user.pubkey, identifier: "public-article" }),
    ]);
    expect(getProfilePointersFromList(list, "all")).toEqual([
      expect.objectContaining({ pubkey: "f".repeat(64) }),
      expect.objectContaining({ pubkey: "e".repeat(64) }),
    ]);
    expect(getRelaysFromList(list, "all")).toEqual(["wss://hidden-relay.example/", "wss://public-relay.example/"]);
  });

  it("keeps caches separate per type and shares cache for default/public", async () => {
    const hiddenEventId = "d".repeat(64);
    const publicEventId = "c".repeat(64);
    const hiddenTags = [
      ["e", hiddenEventId],
      ["a", `30023:${user.pubkey}:hidden-article`],
      ["p", "d".repeat(64)],
      ["relay", "wss://shared-relay.example"],
    ];
    const list = user.list(
      [
        ["e", publicEventId],
        ["a", `30023:${user.pubkey}:public-article`],
        ["p", "c".repeat(64)],
        ["relay", "wss://shared-relay.example"],
      ],
      { content: await user.nip04.encrypt(user.pubkey, JSON.stringify(hiddenTags)) },
    );

    await unlockHiddenTags(list, user);

    const publicEvents = getEventPointersFromList(list, "public");
    const defaultEvents = getEventPointersFromList(list);
    const hiddenEvents = getEventPointersFromList(list, "hidden");
    const allEvents = getEventPointersFromList(list, "all");
    expect(defaultEvents).toBe(publicEvents);
    expect(hiddenEvents).not.toBe(publicEvents);
    expect(allEvents).not.toBe(publicEvents);
    expect(allEvents).not.toBe(hiddenEvents);

    const publicAddresses = getAddressPointersFromList(list, "public");
    const defaultAddresses = getAddressPointersFromList(list);
    const hiddenAddresses = getAddressPointersFromList(list, "hidden");
    const allAddresses = getAddressPointersFromList(list, "all");
    expect(defaultAddresses).toBe(publicAddresses);
    expect(hiddenAddresses).not.toBe(publicAddresses);
    expect(allAddresses).not.toBe(publicAddresses);
    expect(allAddresses).not.toBe(hiddenAddresses);

    const publicProfiles = getProfilePointersFromList(list, "public");
    const defaultProfiles = getProfilePointersFromList(list);
    const hiddenProfiles = getProfilePointersFromList(list, "hidden");
    const allProfiles = getProfilePointersFromList(list, "all");
    expect(defaultProfiles).toBe(publicProfiles);
    expect(hiddenProfiles).not.toBe(publicProfiles);
    expect(allProfiles).not.toBe(publicProfiles);
    expect(allProfiles).not.toBe(hiddenProfiles);

    const publicRelays = getRelaysFromList(list, "public");
    const defaultRelays = getRelaysFromList(list);
    const hiddenRelays = getRelaysFromList(list, "hidden");
    const allRelays = getRelaysFromList(list, "all");
    expect(defaultRelays).toBe(publicRelays);
    expect(hiddenRelays).not.toBe(publicRelays);
    expect(allRelays).not.toBe(publicRelays);
    expect(allRelays).not.toBe(hiddenRelays);

    // relaySet de-duplicates between hidden and public when combined
    expect(publicRelays).toEqual(["wss://shared-relay.example/"]);
    expect(hiddenRelays).toEqual(["wss://shared-relay.example/"]);
    expect(allRelays).toEqual(["wss://shared-relay.example/"]);
  });
});

describe("isEventPointerInList", () => {
  it("matches event IDs using string and pointer input", () => {
    const eventId = "1".repeat(64);
    const list = user.list([["e", eventId]]);

    const pointer: EventPointer = {
      id: eventId,
      relays: ["wss://relay.example"],
      author: user.pubkey,
    };

    expect(isEventPointerInList(list, eventId)).toBe(true);
    expect(isEventPointerInList(list, pointer)).toBe(true);
  });

  it("ignores relay differences on pointer input", () => {
    const eventId = "2".repeat(64);
    const list = user.list([["e", eventId, "wss://relay-a.example"]]);
    const pointer: EventPointer = { id: eventId, relays: ["wss://relay-b.example"], author: user.pubkey };

    expect(isEventPointerInList(list, pointer)).toBe(true);
  });

  it("checks public, hidden, and all types correctly across unlock", async () => {
    const publicEventId = "3".repeat(64);
    const hiddenEventId = "4".repeat(64);
    const hiddenTags = [["e", hiddenEventId]];
    const list = user.list([["e", publicEventId]], {
      content: await user.nip04.encrypt(user.pubkey, JSON.stringify(hiddenTags)),
    });

    expect(isEventPointerInList(list, publicEventId, "public")).toBe(true);
    expect(isEventPointerInList(list, hiddenEventId, "public")).toBe(false);
    expect(isEventPointerInList(list, hiddenEventId, "hidden")).toBe(false);
    expect(isEventPointerInList(list, hiddenEventId, "all")).toBe(false);
    expect(isEventPointerInList(list, publicEventId, "all")).toBe(true);

    await unlockHiddenTags(list, user);

    expect(isEventPointerInList(list, hiddenEventId, "hidden")).toBe(true);
    expect(isEventPointerInList(list, hiddenEventId, "all")).toBe(true);
    expect(isEventPointerInList(list, publicEventId, "all")).toBe(true);
  });

  it("returns false when no matching e tag exists", () => {
    const list = user.list([["p", "a".repeat(64)]]);
    expect(isEventPointerInList(list, "f".repeat(64))).toBe(false);
  });
});
