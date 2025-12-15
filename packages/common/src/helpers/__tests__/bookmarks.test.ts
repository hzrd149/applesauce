import { kinds } from "applesauce-core/helpers/event";
import { AddressPointer, EventPointer, isAddressPointer, isEventPointer } from "applesauce-core/helpers/pointers";
import { describe, expect, it } from "vitest";
import { mergeBookmarks } from "../bookmark.js";

describe("mergeBookmarks", () => {
  it("should merge bookmarks and handle duplicates", () => {
    // Create test data with some duplicates
    const eventPointer1: EventPointer = {
      id: "event1",
      relays: ["wss://relay1.com/", "wss://relay2.com/"],
      author: "author1",
    };

    const eventPointer2: EventPointer = {
      id: "event1", // Same ID as eventPointer1
      relays: ["wss://relay2.com/", "wss://relay3.com/"],
      author: "author1",
    };

    const eventPointer3: EventPointer = {
      id: "event2",
      relays: ["wss://relay1.com/"],
      author: "author2",
    };

    const addressPointer1: AddressPointer = {
      kind: kinds.LongFormArticle,
      pubkey: "pubkey1",
      identifier: "article1",
      relays: ["wss://relay1.com/", "wss://relay2.com/"],
    };

    const addressPointer2: AddressPointer = {
      kind: kinds.LongFormArticle,
      pubkey: "pubkey1",
      identifier: "article1", // Same as addressPointer1
      relays: ["wss://relay3.com/"],
    };

    const bookmark1 = [eventPointer1, addressPointer1];
    const bookmark2 = [eventPointer2, eventPointer3, addressPointer2];

    const result = mergeBookmarks(bookmark1, bookmark2);

    // Check that result is a flat array
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(3); // event1 (merged), event2, article1 (merged)

    // Check that duplicates are properly merged
    const eventPointers = result.filter(isEventPointer);
    const addressPointers = result.filter(isAddressPointer);

    expect(eventPointers).toHaveLength(2); // event1 should be merged, plus event2
    expect(addressPointers).toHaveLength(1); // article1 should be merged

    // Check that relays are merged for duplicate event
    const mergedEvent = eventPointers.find((note) => note.id === "event1");
    expect(mergedEvent?.relays).toHaveLength(3);
    expect(mergedEvent?.relays).toContain("wss://relay1.com/");
    expect(mergedEvent?.relays).toContain("wss://relay2.com/");
    expect(mergedEvent?.relays).toContain("wss://relay3.com/");

    // Check that relays are merged for duplicate article
    const mergedArticle = addressPointers[0];
    expect(mergedArticle.relays).toHaveLength(3);
    expect(mergedArticle.relays).toContain("wss://relay1.com/");
    expect(mergedArticle.relays).toContain("wss://relay2.com/");
    expect(mergedArticle.relays).toContain("wss://relay3.com/");
  });

  it("should handle undefined bookmarks", () => {
    const bookmark: EventPointer[] = [{ id: "event1", relays: ["wss://relay1.com/"], author: "author1" }];

    const result = mergeBookmarks(bookmark, undefined);

    expect(result).toEqual(bookmark);
    expect(mergeBookmarks(undefined, undefined)).toEqual([]);
  });

  it("should handle empty arrays", () => {
    const result = mergeBookmarks([], []);
    expect(result).toEqual([]);
  });

  it("should merge multiple bookmark arrays", () => {
    const bookmark1: EventPointer[] = [{ id: "event1", relays: ["wss://relay1.com/"], author: "author1" }];
    const bookmark2: EventPointer[] = [{ id: "event2", relays: ["wss://relay2.com/"], author: "author2" }];
    const bookmark3: AddressPointer[] = [
      {
        kind: kinds.LongFormArticle,
        pubkey: "pubkey1",
        identifier: "article1",
        relays: ["wss://relay3.com/"],
      },
    ];

    const result = mergeBookmarks(bookmark1, bookmark2, bookmark3);

    expect(result).toHaveLength(3);
    expect(result.filter(isEventPointer)).toHaveLength(2);
    expect(result.filter(isAddressPointer)).toHaveLength(1);
  });
});
