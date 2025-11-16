import { kinds } from "nostr-tools";
import { beforeEach, describe, expect, it } from "vitest";

import { FakeUser } from "../../__tests__/fixtures.js";
import { matchFilter, matchFilters } from "../filter.js";

let user1: FakeUser;
let user2: FakeUser;

beforeEach(() => {
  user1 = new FakeUser();
  user2 = new FakeUser();
});

describe("matchFilter - Basic Functionality", () => {
  it("should match event by kind", () => {
    const event = user1.note("Test");
    expect(matchFilter({ kinds: [kinds.ShortTextNote] }, event)).toBe(true);
    expect(matchFilter({ kinds: [kinds.Metadata] }, event)).toBe(false);
  });

  it("should match event by author", () => {
    const event = user1.note("Test");
    expect(matchFilter({ authors: [user1.pubkey] }, event)).toBe(true);
    expect(matchFilter({ authors: [user2.pubkey] }, event)).toBe(false);
  });

  it("should match event by id", () => {
    const event = user1.note("Test");
    expect(matchFilter({ ids: [event.id] }, event)).toBe(true);
    expect(matchFilter({ ids: ["other-id"] }, event)).toBe(false);
  });

  it("should match event by tag (OR logic)", () => {
    const event = user1.note("Test", {
      tags: [
        ["t", "meme"],
        ["t", "cat"],
      ],
    });

    expect(matchFilter({ "#t": ["meme"] }, event)).toBe(true);
    expect(matchFilter({ "#t": ["cat"] }, event)).toBe(true);
    expect(matchFilter({ "#t": ["meme", "dog"] }, event)).toBe(true);
    expect(matchFilter({ "#t": ["dog"] }, event)).toBe(false);
  });

  it("should match event by time", () => {
    const event = user1.note("Test", { created_at: 1000 });

    expect(matchFilter({ since: 500 }, event)).toBe(true);
    expect(matchFilter({ since: 1500 }, event)).toBe(false);
    expect(matchFilter({ until: 1500 }, event)).toBe(true);
    expect(matchFilter({ until: 500 }, event)).toBe(false);
  });
});

describe("matchFilter - NIP-ND AND Operator", () => {
  describe("basic AND functionality", () => {
    it("should match event with AND operator requiring all tag values", () => {
      const event = user1.note("Test", {
        tags: [
          ["t", "meme"],
          ["t", "cat"],
        ],
      });

      // Must have both meme AND cat
      expect(matchFilter({ "&t": ["meme", "cat"] }, event)).toBe(true);
    });

    it("should not match event missing one AND tag value", () => {
      const event = user1.note("Test", {
        tags: [["t", "meme"]],
      });

      // Missing "cat"
      expect(matchFilter({ "&t": ["meme", "cat"] }, event)).toBe(false);
    });

    it("should not match event missing all AND tag values", () => {
      const event = user1.note("Test", {
        tags: [["t", "dog"]],
      });

      expect(matchFilter({ "&t": ["meme", "cat"] }, event)).toBe(false);
    });

    it("should match event with single AND value", () => {
      const event = user1.note("Test", {
        tags: [["t", "meme"]],
      });

      expect(matchFilter({ "&t": ["meme"] }, event)).toBe(true);
    });

    it("should handle empty AND array", () => {
      const event = user1.note("Test", {
        tags: [["t", "meme"]],
      });

      // Empty AND array should not filter anything
      expect(matchFilter({ "&t": [] }, event)).toBe(true);
    });
  });

  describe("AND with OR combination", () => {
    it("should combine AND and OR filters on same tag type", () => {
      // From NIP-ND spec example:
      // "&t": ["meme", "cat"] - must have both
      // "#t": ["black", "white"] - must have black OR white
      const event1 = user1.note("Test", {
        tags: [
          ["t", "meme"],
          ["t", "cat"],
          ["t", "black"],
        ],
      });

      const event2 = user1.note("Test", {
        tags: [
          ["t", "meme"],
          ["t", "cat"],
          ["t", "white"],
        ],
      });

      const event3 = user1.note("Test", {
        tags: [
          ["t", "meme"],
          ["t", "cat"],
        ],
      });

      const filter = {
        "&t": ["meme", "cat"],
        "#t": ["black", "white"],
      };

      expect(matchFilter(filter, event1)).toBe(true);
      expect(matchFilter(filter, event2)).toBe(true);
      expect(matchFilter(filter, event3)).toBe(false); // Missing black/white
    });

    it("should filter out OR values that are in AND tags (NIP-ND rule)", () => {
      const event1 = user1.note("Test", {
        tags: [
          ["t", "meme"],
          ["t", "cat"],
        ],
      });

      const event2 = user1.note("Test", {
        tags: [["t", "meme"]],
      });

      const event3 = user1.note("Test", {
        tags: [["t", "cat"]],
      });

      // Both AND and OR specify "meme", but AND takes precedence
      // So this requires: meme (from AND) AND cat (from OR after filtering)
      const filter = {
        "&t": ["meme"],
        "#t": ["meme", "cat"], // "meme" should be filtered out from OR
      };

      expect(matchFilter(filter, event1)).toBe(true); // Has both
      expect(matchFilter(filter, event2)).toBe(false); // Missing cat
      expect(matchFilter(filter, event3)).toBe(false); // Missing meme
    });

    it("should handle case where all OR values are filtered out", () => {
      const event = user1.note("Test", {
        tags: [["t", "meme"]],
      });

      // AND has "meme", OR only has "meme" - so OR becomes empty and is ignored
      const filter = {
        "&t": ["meme"],
        "#t": ["meme"],
      };

      expect(matchFilter(filter, event)).toBe(true);
    });

    it("should not match when missing AND but has OR", () => {
      const event = user1.note("Test", {
        tags: [["t", "black"]],
      });

      const filter = {
        "&t": ["meme", "cat"],
        "#t": ["black", "white"],
      };

      expect(matchFilter(filter, event)).toBe(false);
    });
  });

  describe("AND with multiple tag types", () => {
    it("should handle AND on different tag types", () => {
      const event1 = user1.note("Test", {
        tags: [
          ["t", "meme"],
          ["p", user2.pubkey],
        ],
      });

      const event2 = user1.note("Test", {
        tags: [["t", "meme"]],
      });

      const filter = {
        "&t": ["meme"],
        "&p": [user2.pubkey],
      };

      expect(matchFilter(filter, event1)).toBe(true);
      expect(matchFilter(filter, event2)).toBe(false);
    });

    it("should combine AND and OR on different tag types", () => {
      const event1 = user1.note("Test", {
        tags: [
          ["t", "meme"],
          ["p", user2.pubkey],
          ["e", "event-1"],
        ],
      });

      const event2 = user1.note("Test", {
        tags: [
          ["t", "meme"],
          ["p", user2.pubkey],
        ],
      });

      const filter = {
        "&t": ["meme"],
        "&p": [user2.pubkey],
        "#e": ["event-1", "event-2"],
      };

      expect(matchFilter(filter, event1)).toBe(true);
      expect(matchFilter(filter, event2)).toBe(false); // Missing e tag
    });
  });

  describe("AND with other filter types", () => {
    it("should combine AND with author filter", () => {
      const event1 = user1.note("Test", {
        tags: [
          ["t", "meme"],
          ["t", "cat"],
        ],
      });

      const event2 = user2.note("Test", {
        tags: [
          ["t", "meme"],
          ["t", "cat"],
        ],
      });

      const filter = {
        authors: [user1.pubkey],
        "&t": ["meme", "cat"],
      };

      expect(matchFilter(filter, event1)).toBe(true);
      expect(matchFilter(filter, event2)).toBe(false);
    });

    it("should combine AND with kind filter", () => {
      const event1 = user1.note("Test", {
        tags: [
          ["t", "meme"],
          ["t", "cat"],
        ],
      });

      const event2 = user1.profile({ name: "Test" });

      const filter = {
        kinds: [kinds.ShortTextNote],
        "&t": ["meme", "cat"],
      };

      expect(matchFilter(filter, event1)).toBe(true);
      expect(matchFilter(filter, event2)).toBe(false);
    });

    it("should combine AND with time filters", () => {
      const event1 = user1.note("Test", {
        created_at: 2000,
        tags: [
          ["t", "meme"],
          ["t", "cat"],
        ],
      });

      const event2 = user1.note("Test", {
        created_at: 500,
        tags: [
          ["t", "meme"],
          ["t", "cat"],
        ],
      });

      const filter = {
        since: 1000,
        "&t": ["meme", "cat"],
      };

      expect(matchFilter(filter, event1)).toBe(true);
      expect(matchFilter(filter, event2)).toBe(false);
    });

    it("should handle complex real-world scenario", () => {
      const perfectMatch = user1.note("Test", {
        created_at: 2000,
        tags: [
          ["t", "nostr"],
          ["t", "bitcoin"],
          ["t", "meme"],
          ["p", user2.pubkey],
        ],
      });

      const missingAndTag = user1.note("Test", {
        created_at: 2000,
        tags: [
          ["t", "nostr"],
          ["t", "meme"],
          ["p", user2.pubkey],
        ],
      });

      const wrongTime = user1.note("Test", {
        created_at: 500,
        tags: [
          ["t", "nostr"],
          ["t", "bitcoin"],
          ["t", "meme"],
          ["p", user2.pubkey],
        ],
      });

      const wrongAuthor = user2.note("Test", {
        created_at: 2000,
        tags: [
          ["t", "nostr"],
          ["t", "bitcoin"],
          ["t", "meme"],
          ["p", user2.pubkey],
        ],
      });

      const filter = {
        authors: [user1.pubkey],
        kinds: [kinds.ShortTextNote],
        since: 1000,
        "&t": ["nostr", "bitcoin"],
        "#t": ["meme"],
        "#p": [user2.pubkey],
      };

      expect(matchFilter(filter, perfectMatch)).toBe(true);
      expect(matchFilter(filter, missingAndTag)).toBe(false);
      expect(matchFilter(filter, wrongTime)).toBe(false);
      expect(matchFilter(filter, wrongAuthor)).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("should handle event with no tags", () => {
      const event = user1.note("Test", { tags: [] });

      expect(matchFilter({ "&t": ["meme"] }, event)).toBe(false);
      expect(matchFilter({ "#t": ["meme"] }, event)).toBe(false);
    });

    it("should handle AND on non-indexable tag", () => {
      const event = user1.note("Test", {
        tags: [["nonindexable", "value"]],
      });

      // Non-single-letter tags are not indexable
      expect(matchFilter({ "&nonindexable": ["value"] }, event)).toBe(false);
    });

    it("should match event with extra tags beyond AND requirements", () => {
      const event = user1.note("Test", {
        tags: [
          ["t", "meme"],
          ["t", "cat"],
          ["t", "dog"],
          ["t", "bird"],
        ],
      });

      expect(matchFilter({ "&t": ["meme", "cat"] }, event)).toBe(true);
    });

    it("should handle multiple AND values with duplicates in event", () => {
      const event = user1.note("Test", {
        tags: [
          ["t", "meme"],
          ["t", "meme"], // duplicate
          ["t", "cat"],
        ],
      });

      expect(matchFilter({ "&t": ["meme", "cat"] }, event)).toBe(true);
    });
  });
});

describe("matchFilters - Multiple Filters", () => {
  it("should match if any filter matches (OR at filter level)", () => {
    const event1 = user1.note("Test", {
      tags: [
        ["t", "meme"],
        ["t", "cat"],
      ],
    });

    const event2 = user2.note("Test", { tags: [] });

    const filters = [
      {
        "&t": ["meme", "cat"],
      },
      {
        authors: [user2.pubkey],
      },
    ];

    expect(matchFilters(filters, event1)).toBe(true);
    expect(matchFilters(filters, event2)).toBe(true);
  });

  it("should not match if no filters match", () => {
    const event = user1.note("Test", {
      tags: [["t", "dog"]],
    });

    const filters = [
      {
        "&t": ["meme", "cat"],
      },
      {
        authors: [user2.pubkey],
      },
    ];

    expect(matchFilters(filters, event)).toBe(false);
  });

  it("should handle empty filters array", () => {
    const event = user1.note("Test");

    expect(matchFilters([], event)).toBe(false);
  });
});
