import { kinds } from "applesauce-core/helpers/event";
import { AddressPointer, EventPointer } from "applesauce-core/helpers/pointers";
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

    const bookmark1 = {
      notes: [eventPointer1],
      articles: [addressPointer1],
      hashtags: ["tag1", "tag2"],
      urls: ["https://example1.com/"],
    };

    const bookmark2 = {
      notes: [eventPointer2, eventPointer3],
      articles: [addressPointer2],
      hashtags: ["tag2", "tag3"],
      urls: ["https://example1.com/", "https://example2.com/"],
    };

    const result = mergeBookmarks(bookmark1, bookmark2);

    // Check that duplicates are properly merged
    expect(result.notes).toHaveLength(2); // event1 should be merged, plus event2
    expect(result.articles).toHaveLength(1); // article1 should be merged
    expect(result.hashtags).toHaveLength(3); // unique tags
    expect(result.urls).toHaveLength(2); // unique urls

    // Check that relays are merged for duplicate event
    const mergedEvent = result.notes.find((note) => note.id === "event1");
    expect(mergedEvent?.relays).toHaveLength(3);
    expect(mergedEvent?.relays).toContain("wss://relay1.com/");
    expect(mergedEvent?.relays).toContain("wss://relay2.com/");
    expect(mergedEvent?.relays).toContain("wss://relay3.com/");

    // Check that relays are merged for duplicate article
    const mergedArticle = result.articles[0];
    expect(mergedArticle.relays).toHaveLength(3);
    expect(mergedArticle.relays).toContain("wss://relay1.com/");
    expect(mergedArticle.relays).toContain("wss://relay2.com/");
    expect(mergedArticle.relays).toContain("wss://relay3.com/");

    // Check that hashtags are unique
    expect(result.hashtags).toContain("tag1");
    expect(result.hashtags).toContain("tag2");
    expect(result.hashtags).toContain("tag3");

    // Check that urls are unique
    expect(result.urls).toContain("https://example1.com/");
    expect(result.urls).toContain("https://example2.com/");
  });

  it("should handle undefined bookmarks", () => {
    const bookmark = {
      notes: [{ id: "event1", relays: ["wss://relay1.com/"] }],
      articles: [],
      hashtags: ["tag1"],
      urls: ["https://example.com/"],
    };

    const result = mergeBookmarks(bookmark, undefined);

    expect(result).toEqual(bookmark);
    expect(mergeBookmarks(undefined, undefined)).toEqual({
      notes: [],
      articles: [],
      hashtags: [],
      urls: [],
    });
  });
});
