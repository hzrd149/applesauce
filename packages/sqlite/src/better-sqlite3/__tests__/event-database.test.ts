import { kinds } from "applesauce-core/helpers";
import { beforeEach, describe, expect, it } from "vitest";

import { BetterSqlite3EventDatabase } from "../event-database.js";
import { FakeUser } from "../../__tests__/fake-user.js";

let database: BetterSqlite3EventDatabase;
let user: FakeUser;

beforeEach(() => {
  database = new BetterSqlite3EventDatabase(":memory:");
  user = new FakeUser();
});

const profile = () => user.profile({ name: "test user" });
const note = () => user.note("Hello World");

describe("add", () => {
  it("should store and retrieve a single event", () => {
    const event = profile();
    const result = database.add(event);

    expect(result.id).toBe(event.id);
    expect(database.getEvent(event.id)).toEqual(expect.objectContaining({ id: event.id }));
    expect(database.hasEvent(event.id)).toBe(true);
  });

  it("should handle duplicate events correctly", () => {
    const originalEvent = profile();
    const duplicateEvent = { ...originalEvent };

    const first = database.add(originalEvent);
    const second = database.add(duplicateEvent);

    expect(first.id).toBe(originalEvent.id);
    expect(second.id).toBe(originalEvent.id);
    expect(first.id).toBe(second.id);
  });

  it("should handle multiple different events", () => {
    const event1 = profile();
    const event2 = note();

    const result1 = database.add(event1);
    const result2 = database.add(event2);

    expect(result1.id).toBe(event1.id);
    expect(result2.id).toBe(event2.id);
    expect(database.getEvent(event1.id)?.id).toBe(event1.id);
    expect(database.getEvent(event2.id)?.id).toBe(event2.id);
  });

  it("should store events without validation (validation is done at EventStore level)", () => {
    const invalidEvent = {
      ...profile(),
      sig: "invalid_signature",
    };

    // BetterSqlite3EventDatabase is a raw database layer - it doesn't validate signatures
    const result = database.add(invalidEvent);
    expect(result.id).toBe(invalidEvent.id);
    expect(database.hasEvent(invalidEvent.id)).toBe(true);
  });
});

describe("remove", () => {
  it("should remove an existing event", () => {
    const event = profile();
    database.add(event);

    expect(database.hasEvent(event.id)).toBe(true);

    const removed = database.remove(event.id);
    expect(removed).toBe(true);
    expect(database.hasEvent(event.id)).toBe(false);
    expect(database.getEvent(event.id)).toBeUndefined();
  });

  it("should return false when removing non-existent event", () => {
    const result = database.remove("non-existent-id");
    expect(result).toBe(false);
  });

  it("should handle removing already removed event", () => {
    const event = profile();
    database.add(event);

    database.remove(event.id);
    const secondRemoval = database.remove(event.id);

    expect(secondRemoval).toBe(false);
  });
});

describe("replaceable events", () => {
  it("should store and retrieve replaceable events", () => {
    const event = profile();
    database.add(event);

    const retrieved = database.getReplaceable(event.kind, event.pubkey);
    expect(retrieved?.id).toBe(event.id);
    expect(database.hasReplaceable(event.kind, event.pubkey)).toBe(true);
  });

  it("should replace older events with newer ones", () => {
    const oldEvent = user.profile({ name: "old name" }, { created_at: 1000 });
    const newEvent = user.profile({ name: "new name" }, { created_at: 2000 });

    database.add(oldEvent);
    database.add(newEvent);

    const retrieved = database.getReplaceable(oldEvent.kind, oldEvent.pubkey);
    expect(retrieved?.id).toBe(newEvent.id);
    expect(retrieved?.content).toContain("new name");
  });

  it("should not replace newer events with older ones", () => {
    const newEvent = user.profile({ name: "new name" }, { created_at: 2000 });
    const oldEvent = user.profile({ name: "old name" }, { created_at: 1000 });

    database.add(newEvent);
    database.add(oldEvent);

    const retrieved = database.getReplaceable(newEvent.kind, newEvent.pubkey);
    expect(retrieved?.id).toBe(newEvent.id);
    expect(retrieved?.content).toContain("new name");
  });

  it("should handle addressable replaceable events with identifiers", () => {
    const event1 = user.event({
      kind: 30000,
      content: "test content 1",
      tags: [["d", "identifier1"]],
    });
    const event2 = user.event({
      kind: 30000,
      content: "test content 2",
      tags: [["d", "identifier2"]],
    });

    database.add(event1);
    database.add(event2);

    expect(database.getReplaceable(30000, user.pubkey, "identifier1")?.id).toBe(event1.id);
    expect(database.getReplaceable(30000, user.pubkey, "identifier2")?.id).toBe(event2.id);
    expect(database.hasReplaceable(30000, user.pubkey, "identifier1")).toBe(true);
    expect(database.hasReplaceable(30000, user.pubkey, "identifier2")).toBe(true);
  });

  it("should return replaceable event history", () => {
    const event1 = user.profile({ name: "name1" }, { created_at: 1000 });
    const event2 = user.profile({ name: "name2" }, { created_at: 2000 });
    const event3 = user.profile({ name: "name3" }, { created_at: 3000 });

    database.add(event1);
    database.add(event2);
    database.add(event3);

    const history = database.getReplaceableHistory(event1.kind, event1.pubkey);
    expect(history).toHaveLength(3);
    expect(history.map((e) => e.id)).toContain(event1.id);
    expect(history.map((e) => e.id)).toContain(event2.id);
    expect(history.map((e) => e.id)).toContain(event3.id);
  });
});

describe("getByFilters", () => {
  it("should return events matching kind filter", () => {
    const profileEvent = profile();
    const noteEvent = note();

    database.add(profileEvent);
    database.add(noteEvent);

    const profiles = database.getByFilters({ kinds: [kinds.Metadata] });
    const notes = database.getByFilters({ kinds: [kinds.ShortTextNote] });

    expect(profiles.map((e) => e.id)).toContain(profileEvent.id);
    expect(profiles.map((e) => e.id)).not.toContain(noteEvent.id);
    expect(notes.map((e) => e.id)).toContain(noteEvent.id);
    expect(notes.map((e) => e.id)).not.toContain(profileEvent.id);
  });

  it("should return events matching author filter", () => {
    const user2 = new FakeUser();
    const event1 = profile();
    const event2 = user2.profile({ name: "user2" });

    database.add(event1);
    database.add(event2);

    const user1Events = database.getByFilters({ authors: [user.pubkey] });
    const user2Events = database.getByFilters({ authors: [user2.pubkey] });

    expect(user1Events.map((e) => e.id)).toContain(event1.id);
    expect(user1Events.map((e) => e.id)).not.toContain(event2.id);
    expect(user2Events.map((e) => e.id)).toContain(event2.id);
    expect(user2Events.map((e) => e.id)).not.toContain(event1.id);
  });

  it("should return events matching multiple filters", () => {
    const profileEvent = profile();
    const noteEvent = note();

    database.add(profileEvent);
    database.add(noteEvent);

    const results = database.getByFilters({
      kinds: [kinds.Metadata, kinds.ShortTextNote],
      authors: [user.pubkey],
    });

    expect(results.map((e) => e.id)).toContain(profileEvent.id);
    expect(results.map((e) => e.id)).toContain(noteEvent.id);
  });

  it("should handle empty results gracefully", () => {
    const results = database.getByFilters({ kinds: [999] });
    expect(results.length).toBe(0);
  });

  it("should return same event instances from memory", () => {
    const event = profile();
    database.add(event);

    const results = database.getByFilters({ kinds: [event.kind] });
    const retrievedEvent = Array.from(results)[0];

    expect(retrievedEvent?.id).toBe(event.id);
  });
});

describe("getTimeline", () => {
  it("should return events in chronological order", () => {
    const event1 = user.note("first", { created_at: 1000 });
    const event2 = user.note("second", { created_at: 2000 });
    const event3 = user.note("third", { created_at: 3000 });

    // Add in random order
    database.add(event2);
    database.add(event1);
    database.add(event3);

    const timeline = database.getTimeline({ kinds: [kinds.ShortTextNote] });

    expect(timeline).toHaveLength(3);
    expect(timeline[0]?.id).toBe(event3.id); // Most recent first
    expect(timeline[1]?.id).toBe(event2.id);
    expect(timeline[2]?.id).toBe(event1.id);
  });

  it("should return empty array when no events match", () => {
    const timeline = database.getTimeline({ kinds: [999] });
    expect(timeline).toEqual([]);
  });
});

describe("database lifecycle", () => {
  it("should close database connection", () => {
    expect(() => database.close()).not.toThrow();
  });

  it("should support Symbol.dispose", () => {
    expect(() => database[Symbol.dispose]()).not.toThrow();
  });
});

describe("error handling", () => {
  it("should handle database errors gracefully in getByFilters", () => {
    database.close(); // Close database to simulate error

    expect(() => database.getByFilters({ kinds: [1] })).toThrow();
  });

  it("should handle errors in add method", () => {
    const event = profile();
    database.close(); // Close database to simulate error

    expect(() => database.add(event)).toThrow();
  });

  it("should handle errors in remove method", () => {
    database.close(); // Close database to simulate error

    const result = database.remove("some-id");
    expect(result).toBe(false);
  });
});

describe("removeByFilters", () => {
  beforeEach(() => {
    // Reset database for each test
    database = new BetterSqlite3EventDatabase(":memory:");
    user = new FakeUser();
  });

  it("should remove events by kind filter", () => {
    const profile1 = user.profile({ name: "user1" });
    const profile2 = user.profile({ name: "user2" });
    const note1 = user.note("note1");
    const note2 = user.note("note2");

    database.add(profile1);
    database.add(profile2);
    database.add(note1);
    database.add(note2);

    // Remove all profile events (kind 0)
    const removed = database.removeByFilters({ kinds: [0] });
    expect(removed).toBe(2);

    // Verify profile events are gone
    expect(database.hasEvent(profile1.id)).toBe(false);
    expect(database.hasEvent(profile2.id)).toBe(false);

    // Verify note events remain
    expect(database.hasEvent(note1.id)).toBe(true);
    expect(database.hasEvent(note2.id)).toBe(true);
  });

  it("should remove events by author filter", () => {
    const user2 = new FakeUser();
    const profile1 = user.profile({ name: "user1" });
    const profile2 = user2.profile({ name: "user2" });
    const note1 = user.note("note1");
    const note2 = user2.note("note2");

    database.add(profile1);
    database.add(profile2);
    database.add(note1);
    database.add(note2);

    // Remove all events by user1
    const removed = database.removeByFilters({ authors: [user.pubkey] });
    expect(removed).toBe(2);

    // Verify user1 events are gone
    expect(database.hasEvent(profile1.id)).toBe(false);
    expect(database.hasEvent(note1.id)).toBe(false);

    // Verify user2 events remain
    expect(database.hasEvent(profile2.id)).toBe(true);
    expect(database.hasEvent(note2.id)).toBe(true);
  });

  it("should remove events by ID filter", () => {
    const profile1 = user.profile({ name: "user1" });
    const profile2 = user.profile({ name: "user2" });
    const note1 = user.note("note1");

    database.add(profile1);
    database.add(profile2);
    database.add(note1);

    // Remove specific events by ID
    const removed = database.removeByFilters({ ids: [profile1.id, note1.id] });
    expect(removed).toBe(2);

    // Verify specific events are gone
    expect(database.hasEvent(profile1.id)).toBe(false);
    expect(database.hasEvent(note1.id)).toBe(false);

    // Verify other event remains
    expect(database.hasEvent(profile2.id)).toBe(true);
  });

  it("should remove events by time range filter", () => {
    const oldEvent = user.profile({ name: "old" }, { created_at: 1000 });
    const middleEvent = user.profile({ name: "middle" }, { created_at: 2000 });
    const newEvent = user.profile({ name: "new" }, { created_at: 3000 });

    database.add(oldEvent);
    database.add(middleEvent);
    database.add(newEvent);

    // Remove events between timestamps 1500 and 2500
    const removed = database.removeByFilters({ since: 1500, until: 2500 });
    expect(removed).toBe(1);

    // Verify middle event is gone
    expect(database.hasEvent(middleEvent.id)).toBe(false);

    // Verify old and new events remain
    expect(database.hasEvent(oldEvent.id)).toBe(true);
    expect(database.hasEvent(newEvent.id)).toBe(true);
  });

  it("should remove events by tag filter", () => {
    const event1 = user.note("test", {
      tags: [
        ["t", "tag1"],
        ["t", "tag2"],
      ],
    });
    const event2 = user.note("test", {
      tags: [
        ["t", "tag2"],
        ["t", "tag3"],
      ],
    });
    const event3 = user.note("test", {
      tags: [
        ["t", "tag3"],
        ["t", "tag4"],
      ],
    });

    database.add(event1);
    database.add(event2);
    database.add(event3);

    // Remove events with tag "tag2"
    const removed = database.removeByFilters({ "#t": ["tag2"] });
    expect(removed).toBe(2);

    // Verify events with tag2 are gone
    expect(database.hasEvent(event1.id)).toBe(false);
    expect(database.hasEvent(event2.id)).toBe(false);

    // Verify event without tag2 remains
    expect(database.hasEvent(event3.id)).toBe(true);
  });

  it("should handle multiple filters with OR logic", () => {
    const profile1 = user.profile({ name: "user1" });
    const profile2 = user.profile({ name: "user2" });
    const note1 = user.note("note1");

    database.add(profile1);
    database.add(profile2);
    database.add(note1);

    // Remove events that are either profiles OR notes
    const removed = database.removeByFilters([
      { kinds: [0] }, // profiles
      { kinds: [1] }, // notes
    ]);
    expect(removed).toBe(3);

    // Verify all events are gone
    expect(database.hasEvent(profile1.id)).toBe(false);
    expect(database.hasEvent(profile2.id)).toBe(false);
    expect(database.hasEvent(note1.id)).toBe(false);
  });

  it("should handle complex filter combinations", () => {
    const user2 = new FakeUser();
    const profile1 = user.profile({ name: "user1" }, { created_at: 1000 });
    const profile2 = user2.profile({ name: "user2" }, { created_at: 2000 });
    const note1 = user.note("note1", { created_at: 1500 });
    const note2 = user2.note("note2", { created_at: 2500 });

    database.add(profile1);
    database.add(profile2);
    database.add(note1);
    database.add(note2);

    // Remove profiles by user1 OR notes by user2
    const removed = database.removeByFilters([
      { kinds: [0], authors: [user.pubkey] }, // profiles by user1
      { kinds: [1], authors: [user2.pubkey] }, // notes by user2
    ]);
    expect(removed).toBe(2);

    // Verify specific events are gone
    expect(database.hasEvent(profile1.id)).toBe(false);
    expect(database.hasEvent(note2.id)).toBe(false);

    // Verify other events remain
    expect(database.hasEvent(profile2.id)).toBe(true);
    expect(database.hasEvent(note1.id)).toBe(true);
  });

  it("should return 0 when no events match filters", () => {
    const profile1 = user.profile({ name: "user1" });
    database.add(profile1);

    // Try to remove notes (kind 1) when only profiles exist
    const removed = database.removeByFilters({ kinds: [1] });
    expect(removed).toBe(0);

    // Verify original event remains
    expect(database.hasEvent(profile1.id)).toBe(true);
  });

  it("should handle empty filters array", () => {
    const profile1 = user.profile({ name: "user1" });
    database.add(profile1);

    const removed = database.removeByFilters([]);
    expect(removed).toBe(0);

    // Verify original event remains
    expect(database.hasEvent(profile1.id)).toBe(true);
  });

  it("should properly clean up related data (tags)", () => {
    const event = user.note("test", {
      tags: [
        ["t", "tag1"],
        ["p", "pubkey1"],
      ],
    });
    database.add(event);

    // Verify event exists
    expect(database.hasEvent(event.id)).toBe(true);

    // Remove the event
    const removed = database.removeByFilters({ ids: [event.id] });
    expect(removed).toBe(1);

    // Verify event is gone
    expect(database.hasEvent(event.id)).toBe(false);
  });
});

describe("NIP-ND AND filter support", () => {
  beforeEach(() => {
    database = new BetterSqlite3EventDatabase(":memory:");
    user = new FakeUser();
  });

  describe("basic AND functionality", () => {
    it("should filter events with AND operator requiring all tag values", () => {
      const event1 = user.note("Has both meme and cat", {
        tags: [
          ["t", "meme"],
          ["t", "cat"],
        ],
      });
      const event2 = user.note("Has only meme", {
        tags: [["t", "meme"]],
      });
      const event3 = user.note("Has only cat", {
        tags: [["t", "cat"]],
      });
      const event4 = user.note("Has both plus dog", {
        tags: [
          ["t", "meme"],
          ["t", "cat"],
          ["t", "dog"],
        ],
      });

      database.add(event1);
      database.add(event2);
      database.add(event3);
      database.add(event4);

      // Query with AND operator - must have BOTH meme AND cat
      const results = database.getByFilters({
        kinds: [kinds.ShortTextNote],
        "&t": ["meme", "cat"],
      });

      expect(results).toHaveLength(2);
      expect(results.map((e) => e.id)).toContain(event1.id);
      expect(results.map((e) => e.id)).toContain(event4.id);
      expect(results.map((e) => e.id)).not.toContain(event2.id);
      expect(results.map((e) => e.id)).not.toContain(event3.id);
    });

    it("should handle AND with single value", () => {
      const event1 = user.note("Has meme", { tags: [["t", "meme"]] });
      const event2 = user.note("No tags", { tags: [] });

      database.add(event1);
      database.add(event2);

      const results = database.getByFilters({
        kinds: [kinds.ShortTextNote],
        "&t": ["meme"],
      });

      expect(results).toHaveLength(1);
      expect(results.map((e) => e.id)).toContain(event1.id);
    });

    it("should return empty array when no events match AND condition", () => {
      const event1 = user.note("Has only meme", { tags: [["t", "meme"]] });
      const event2 = user.note("Has only cat", { tags: [["t", "cat"]] });

      database.add(event1);
      database.add(event2);

      const results = database.getByFilters({
        kinds: [kinds.ShortTextNote],
        "&t": ["meme", "cat"],
      });

      expect(results).toHaveLength(0);
    });
  });

  describe("AND with OR combination", () => {
    it("should combine AND and OR filters on same tag type", () => {
      const event1 = user.note("Has meme, cat, and black", {
        tags: [
          ["t", "meme"],
          ["t", "cat"],
          ["t", "black"],
        ],
      });
      const event2 = user.note("Has meme, cat, and white", {
        tags: [
          ["t", "meme"],
          ["t", "cat"],
          ["t", "white"],
        ],
      });
      const event3 = user.note("Has only meme and black", {
        tags: [
          ["t", "meme"],
          ["t", "black"],
        ],
      });

      database.add(event1);
      database.add(event2);
      database.add(event3);

      // Must have BOTH meme AND cat, plus black OR white
      const results = database.getByFilters({
        kinds: [kinds.ShortTextNote],
        "&t": ["meme", "cat"],
        "#t": ["black", "white"],
      });

      expect(results).toHaveLength(2);
      expect(results.map((e) => e.id)).toContain(event1.id);
      expect(results.map((e) => e.id)).toContain(event2.id);
      expect(results.map((e) => e.id)).not.toContain(event3.id); // Missing cat
    });

    it("should filter out AND values from OR (NIP-ND rule)", () => {
      const event1 = user.note("Has meme and black", {
        tags: [
          ["t", "meme"],
          ["t", "black"],
        ],
      });
      const event2 = user.note("Has only meme", {
        tags: [["t", "meme"]],
      });

      database.add(event1);
      database.add(event2);

      // AND has "meme", OR has "meme" and "black"
      // "meme" should be filtered from OR, leaving only "black"
      const results = database.getByFilters({
        kinds: [kinds.ShortTextNote],
        "&t": ["meme"],
        "#t": ["meme", "black"],
      });

      // event1 has meme (AND) and black (OR) - should match
      // event2 has meme (AND) but not black (OR) - should NOT match
      expect(results).toHaveLength(1);
      expect(results.map((e) => e.id)).toContain(event1.id);
      expect(results.map((e) => e.id)).not.toContain(event2.id);
    });

    it("should handle case where all OR values are filtered out", () => {
      const event1 = user.note("Has meme", { tags: [["t", "meme"]] });
      const event2 = user.note("Has meme and cat", {
        tags: [
          ["t", "meme"],
          ["t", "cat"],
        ],
      });

      database.add(event1);
      database.add(event2);

      // AND has "meme", OR only has "meme" - so OR becomes empty and is ignored
      const results = database.getByFilters({
        kinds: [kinds.ShortTextNote],
        "&t": ["meme"],
        "#t": ["meme"],
      });

      // Both events should match since OR is effectively ignored
      expect(results).toHaveLength(2);
      expect(results.map((e) => e.id)).toContain(event1.id);
      expect(results.map((e) => e.id)).toContain(event2.id);
    });
  });

  describe("AND with multiple tag types", () => {
    it("should handle AND on different tag types", () => {
      const user2 = new FakeUser();
      const event1 = user.note("Has both tags", {
        tags: [
          ["t", "meme"],
          ["p", user2.pubkey],
        ],
      });
      const event2 = user.note("Has only t tag", {
        tags: [["t", "meme"]],
      });
      const event3 = user.note("Has only p tag", {
        tags: [["p", user2.pubkey]],
      });

      database.add(event1);
      database.add(event2);
      database.add(event3);

      const results = database.getByFilters({
        kinds: [kinds.ShortTextNote],
        "&t": ["meme"],
        "&p": [user2.pubkey],
      });

      expect(results).toHaveLength(1);
      expect(results.map((e) => e.id)).toContain(event1.id);
    });

    it("should combine AND and OR on different tag types", () => {
      const user2 = new FakeUser();
      const event1 = user.note("Perfect match", {
        tags: [
          ["t", "meme"],
          ["p", user2.pubkey],
          ["e", "event-1"],
        ],
      });
      const event2 = user.note("Missing AND tag", {
        tags: [
          ["p", user2.pubkey],
          ["e", "event-1"],
        ],
      });
      const event3 = user.note("Missing OR tag", {
        tags: [
          ["t", "meme"],
          ["p", user2.pubkey],
        ],
      });

      database.add(event1);
      database.add(event2);
      database.add(event3);

      const results = database.getByFilters({
        kinds: [kinds.ShortTextNote],
        "&t": ["meme"],
        "&p": [user2.pubkey],
        "#e": ["event-1", "event-2"], // OR condition
      });

      expect(results).toHaveLength(1);
      expect(results.map((e) => e.id)).toContain(event1.id);
    });
  });

  describe("AND with other filter types", () => {
    it("should combine AND tags with kinds filter", () => {
      const profile = user.profile({ name: "test" });
      const note = user.note("test", {
        tags: [
          ["t", "meme"],
          ["t", "cat"],
        ],
      });

      database.add(profile);
      database.add(note);

      const results = database.getByFilters({
        kinds: [kinds.ShortTextNote],
        "&t": ["meme", "cat"],
      });

      expect(results).toHaveLength(1);
      expect(results.map((e) => e.id)).toContain(note.id);
    });

    it("should combine AND tags with authors filter", () => {
      const user2 = new FakeUser();
      const event1 = user.note("user1 note", {
        tags: [
          ["t", "meme"],
          ["t", "cat"],
        ],
      });
      const event2 = user2.note("user2 note", {
        tags: [
          ["t", "meme"],
          ["t", "cat"],
        ],
      });

      database.add(event1);
      database.add(event2);

      const results = database.getByFilters({
        authors: [user.pubkey],
        "&t": ["meme", "cat"],
      });

      expect(results).toHaveLength(1);
      expect(results.map((e) => e.id)).toContain(event1.id);
    });

    it("should combine AND tags with time filters", () => {
      const event1 = user.note("old", {
        created_at: 1000,
        tags: [
          ["t", "meme"],
          ["t", "cat"],
        ],
      });
      const event2 = user.note("new", {
        created_at: 2000,
        tags: [
          ["t", "meme"],
          ["t", "cat"],
        ],
      });

      database.add(event1);
      database.add(event2);

      const results = database.getByFilters({
        since: 1500,
        "&t": ["meme", "cat"],
      });

      expect(results).toHaveLength(1);
      expect(results.map((e) => e.id)).toContain(event2.id);
    });
  });

  describe("multiple filters with AND tags (OR logic between filters)", () => {
    it("should handle OR logic between filters with AND tags", () => {
      const event1 = user.note("Has meme and cat", {
        tags: [
          ["t", "meme"],
          ["t", "cat"],
        ],
      });
      const event2 = user.note("Has dog and bird", {
        tags: [
          ["t", "dog"],
          ["t", "bird"],
        ],
      });
      const event3 = user.note("Has only meme", {
        tags: [["t", "meme"]],
      });

      database.add(event1);
      database.add(event2);
      database.add(event3);

      // Filter 1: must have meme AND cat
      // Filter 2: must have dog AND bird
      const results = database.getByFilters([
        { kinds: [kinds.ShortTextNote], "&t": ["meme", "cat"] },
        { kinds: [kinds.ShortTextNote], "&t": ["dog", "bird"] },
      ]);

      expect(results).toHaveLength(2);
      expect(results.map((e) => e.id)).toContain(event1.id);
      expect(results.map((e) => e.id)).toContain(event2.id);
      expect(results.map((e) => e.id)).not.toContain(event3.id);
    });
  });

  describe("edge cases", () => {
    it("should handle empty AND array", () => {
      const event = user.note("test", { tags: [["t", "meme"]] });
      database.add(event);

      const results = database.getByFilters({
        kinds: [kinds.ShortTextNote],
        "&t": [],
      });

      // Empty AND array should not filter anything
      expect(results).toHaveLength(1);
    });

    it("should handle events with duplicate tag values", () => {
      const event = user.note("test", {
        tags: [
          ["t", "meme"],
          ["t", "meme"], // duplicate
          ["t", "cat"],
        ],
      });
      database.add(event);

      const results = database.getByFilters({
        kinds: [kinds.ShortTextNote],
        "&t": ["meme", "cat"],
      });

      expect(results).toHaveLength(1);
      expect(results.map((e) => e.id)).toContain(event.id);
    });

    it("should handle three or more AND values", () => {
      const event1 = user.note("Has all three", {
        tags: [
          ["t", "meme"],
          ["t", "cat"],
          ["t", "funny"],
        ],
      });
      const event2 = user.note("Has only two", {
        tags: [
          ["t", "meme"],
          ["t", "cat"],
        ],
      });

      database.add(event1);
      database.add(event2);

      const results = database.getByFilters({
        kinds: [kinds.ShortTextNote],
        "&t": ["meme", "cat", "funny"],
      });

      expect(results).toHaveLength(1);
      expect(results.map((e) => e.id)).toContain(event1.id);
    });
  });
});
