import { beforeEach, describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { kinds, NostrEvent } from "../../helpers/event.js";
import { EventMemory } from "../event-memory.js";

let eventMemory: EventMemory;
let user1: FakeUser;
let user2: FakeUser;

beforeEach(() => {
  eventMemory = new EventMemory();
  user1 = new FakeUser();
  user2 = new FakeUser();
});

describe("EventMemory - Basic Operations", () => {
  describe("add and getEvent", () => {
    it("should add an event and retrieve it by id", () => {
      const note = user1.note("Test note");
      const added = eventMemory.add(note);

      expect(added).toBe(note);
      expect(eventMemory.getEvent(note.id)).toBe(note);
      expect(eventMemory.size).toBe(1);
    });

    it("should return existing event when adding duplicate", () => {
      const note = user1.note("Test note");
      const first = eventMemory.add(note);
      const second = eventMemory.add(note);

      expect(first).toBe(second);
      expect(eventMemory.size).toBe(1);
    });

    it("should add multiple events from different users", () => {
      const note1 = user1.note("Note 1");
      const note2 = user2.note("Note 2");

      eventMemory.add(note1);
      eventMemory.add(note2);

      expect(eventMemory.size).toBe(2);
      expect(eventMemory.getEvent(note1.id)).toBe(note1);
      expect(eventMemory.getEvent(note2.id)).toBe(note2);
    });
  });

  describe("hasEvent", () => {
    it("should return true for existing events", () => {
      const note = user1.note("Test");
      eventMemory.add(note);

      expect(eventMemory.hasEvent(note.id)).toBe(true);
    });

    it("should return false for non-existing events", () => {
      expect(eventMemory.hasEvent("non-existent-id")).toBe(false);
    });
  });

  describe("remove", () => {
    it("should remove an event by id", () => {
      const note = user1.note("Test");
      eventMemory.add(note);

      expect(eventMemory.hasEvent(note.id)).toBe(true);
      expect(eventMemory.remove(note.id)).toBe(true);
      expect(eventMemory.hasEvent(note.id)).toBe(false);
      expect(eventMemory.size).toBe(0);
    });

    it("should remove an event by object reference", () => {
      const note = user1.note("Test");
      eventMemory.add(note);

      expect(eventMemory.remove(note)).toBe(true);
      expect(eventMemory.hasEvent(note.id)).toBe(false);
    });

    it("should return false when removing non-existent event", () => {
      expect(eventMemory.remove("non-existent-id")).toBe(false);
    });

    it("should remove event from all indexes", () => {
      const note = user1.note("Test");
      eventMemory.add(note);

      // Verify it's in the indexes
      const byKind = eventMemory.getByFilters({ kinds: [kinds.ShortTextNote] });
      expect(byKind).toContainEqual(note);

      const byAuthor = eventMemory.getByFilters({ authors: [user1.pubkey] });
      expect(byAuthor).toContainEqual(note);

      // Remove and verify it's gone from all indexes
      eventMemory.remove(note);

      const byKindAfter = eventMemory.getByFilters({ kinds: [kinds.ShortTextNote] });
      expect(byKindAfter).not.toContainEqual(note);

      const byAuthorAfter = eventMemory.getByFilters({ authors: [user1.pubkey] });
      expect(byAuthorAfter).not.toContainEqual(note);
    });
  });

  describe("reset", () => {
    it("should clear all events and indexes", () => {
      const note1 = user1.note("Note 1");
      const note2 = user2.note("Note 2");

      eventMemory.add(note1);
      eventMemory.add(note2);

      expect(eventMemory.size).toBe(2);

      eventMemory.reset();

      expect(eventMemory.size).toBe(0);
      expect(eventMemory.getEvent(note1.id)).toBeUndefined();
      expect(eventMemory.getEvent(note2.id)).toBeUndefined();
    });
  });
});

describe("EventMemory - Replaceable Events", () => {
  describe("replaceable events (kind 0)", () => {
    it("should store and retrieve replaceable events", () => {
      const profile = user1.profile({ name: "Alice" });
      eventMemory.add(profile);

      expect(eventMemory.hasReplaceable(kinds.Metadata, user1.pubkey)).toBe(true);
      expect(eventMemory.getReplaceable(kinds.Metadata, user1.pubkey)).toBe(profile);
    });

    it("should keep history of replaceable events", () => {
      const profile1 = user1.profile({ name: "Alice" }, { created_at: 1000 });
      const profile2 = user1.profile({ name: "Alice Updated" }, { created_at: 2000 });
      const profile3 = user1.profile({ name: "Alice Final" }, { created_at: 3000 });

      eventMemory.add(profile1);
      eventMemory.add(profile2);
      eventMemory.add(profile3);

      const latest = eventMemory.getReplaceable(kinds.Metadata, user1.pubkey);
      expect(latest).toBe(profile3);

      const history = eventMemory.getReplaceableHistory(kinds.Metadata, user1.pubkey);
      expect(history).toHaveLength(3);
      expect(history![0]).toBe(profile3); // Most recent first
      expect(history![1]).toBe(profile2);
      expect(history![2]).toBe(profile1);
    });

    it("should handle replaceable events added out of order", () => {
      const profile1 = user1.profile({ name: "Alice" }, { created_at: 1000 });
      const profile2 = user1.profile({ name: "Alice Updated" }, { created_at: 2000 });

      // Add in reverse order
      eventMemory.add(profile2);
      eventMemory.add(profile1);

      const latest = eventMemory.getReplaceable(kinds.Metadata, user1.pubkey);
      expect(latest).toBe(profile2); // Should still return the newest
    });
  });

  describe("addressable replaceable events (kind 30000+)", () => {
    it("should store addressable events with d tag", () => {
      const event1 = user1.event({ kind: 30000, tags: [["d", "article-1"]], content: "Article 1" });
      eventMemory.add(event1);

      expect(eventMemory.hasReplaceable(30000, user1.pubkey, "article-1")).toBe(true);
      expect(eventMemory.getReplaceable(30000, user1.pubkey, "article-1")).toBe(event1);
    });

    it("should handle multiple addressable events with different identifiers", () => {
      const article1 = user1.event({ kind: 30000, tags: [["d", "article-1"]], content: "Article 1" });
      const article2 = user1.event({ kind: 30000, tags: [["d", "article-2"]], content: "Article 2" });

      eventMemory.add(article1);
      eventMemory.add(article2);

      expect(eventMemory.getReplaceable(30000, user1.pubkey, "article-1")).toBe(article1);
      expect(eventMemory.getReplaceable(30000, user1.pubkey, "article-2")).toBe(article2);
    });

    it("should update addressable events with same identifier", () => {
      const v1 = user1.event({
        kind: 30000,
        tags: [["d", "article"]],
        content: "Version 1",
        created_at: 1000,
      });
      const v2 = user1.event({
        kind: 30000,
        tags: [["d", "article"]],
        content: "Version 2",
        created_at: 2000,
      });

      eventMemory.add(v1);
      eventMemory.add(v2);

      expect(eventMemory.getReplaceable(30000, user1.pubkey, "article")).toBe(v2);

      const history = eventMemory.getReplaceableHistory(30000, user1.pubkey, "article");
      expect(history).toHaveLength(2);
      expect(history![0]).toBe(v2);
      expect(history![1]).toBe(v1);
    });
  });

  describe("remove replaceable events", () => {
    it("should remove replaceable event from history", () => {
      const profile = user1.profile({ name: "Alice" });
      eventMemory.add(profile);

      expect(eventMemory.hasReplaceable(kinds.Metadata, user1.pubkey)).toBe(true);

      eventMemory.remove(profile);

      expect(eventMemory.hasReplaceable(kinds.Metadata, user1.pubkey)).toBe(false);
      expect(eventMemory.getReplaceable(kinds.Metadata, user1.pubkey)).toBeUndefined();
    });

    it("should handle removing from replaceable history with multiple versions", () => {
      const v1 = user1.profile({ name: "V1" }, { created_at: 1000 });
      const v2 = user1.profile({ name: "V2" }, { created_at: 2000 });
      const v3 = user1.profile({ name: "V3" }, { created_at: 3000 });

      eventMemory.add(v1);
      eventMemory.add(v2);
      eventMemory.add(v3);

      // Remove middle version
      eventMemory.remove(v2);

      const history = eventMemory.getReplaceableHistory(kinds.Metadata, user1.pubkey);
      expect(history).toHaveLength(2);
      expect(history).toContainEqual(v1);
      expect(history).toContainEqual(v3);
      expect(history).not.toContainEqual(v2);
    });
  });
});

describe("EventMemory - Query Filters", () => {
  describe("filter by kinds", () => {
    it("should filter events by single kind", () => {
      const note = user1.note("Note");
      const profile = user1.profile({ name: "Alice" });

      eventMemory.add(note);
      eventMemory.add(profile);

      const notes = eventMemory.getByFilters({ kinds: [kinds.ShortTextNote] });
      expect(notes).toHaveLength(1);
      expect(notes).toContainEqual(note);
    });

    it("should filter events by multiple kinds", () => {
      const note = user1.note("Note");
      const profile = user1.profile({ name: "Alice" });
      const reaction = user1.event({ kind: kinds.Reaction, content: "+" });

      eventMemory.add(note);
      eventMemory.add(profile);
      eventMemory.add(reaction);

      const results = eventMemory.getByFilters({ kinds: [kinds.ShortTextNote, kinds.Reaction] });
      expect(results).toHaveLength(2);
      expect(results).toContainEqual(note);
      expect(results).toContainEqual(reaction);
    });
  });

  describe("filter by authors", () => {
    it("should filter events by single author", () => {
      const note1 = user1.note("User 1 note");
      const note2 = user2.note("User 2 note");

      eventMemory.add(note1);
      eventMemory.add(note2);

      const user1Events = eventMemory.getByFilters({ authors: [user1.pubkey] });
      expect(user1Events).toHaveLength(1);
      expect(user1Events).toContainEqual(note1);
    });

    it("should filter events by multiple authors", () => {
      const note1 = user1.note("User 1 note");
      const note2 = user2.note("User 2 note");
      const user3 = new FakeUser();
      const note3 = user3.note("User 3 note");

      eventMemory.add(note1);
      eventMemory.add(note2);
      eventMemory.add(note3);

      const results = eventMemory.getByFilters({ authors: [user1.pubkey, user2.pubkey] });
      expect(results).toHaveLength(2);
      expect(results).toContainEqual(note1);
      expect(results).toContainEqual(note2);
    });
  });

  describe("filter by kind AND author (composite index)", () => {
    it("should efficiently filter by both kind and author", () => {
      // Add various events
      const user1Note = user1.note("User 1 note");
      const user1Profile = user1.profile({ name: "User 1" });
      const user2Note = user2.note("User 2 note");
      const user2Profile = user2.profile({ name: "User 2" });

      eventMemory.add(user1Note);
      eventMemory.add(user1Profile);
      eventMemory.add(user2Note);
      eventMemory.add(user2Profile);

      // Query for user1's notes specifically
      const results = eventMemory.getByFilters({
        kinds: [kinds.ShortTextNote],
        authors: [user1.pubkey],
      });

      expect(results).toHaveLength(1);
      expect(results).toContainEqual(user1Note);
    });

    it("should handle multiple kinds and authors with composite index", () => {
      const user1Note = user1.note("Note");
      const user1Profile = user1.profile({ name: "Alice" });
      const user2Note = user2.note("Note");
      const user2Profile = user2.profile({ name: "Bob" });

      eventMemory.add(user1Note);
      eventMemory.add(user1Profile);
      eventMemory.add(user2Note);
      eventMemory.add(user2Profile);

      // Should use composite index for small cross-product
      const results = eventMemory.getByFilters({
        kinds: [kinds.ShortTextNote, kinds.Metadata],
        authors: [user1.pubkey],
      });

      expect(results).toHaveLength(2);
      expect(results).toContainEqual(user1Note);
      expect(results).toContainEqual(user1Profile);
    });

    it("should fall back to separate indexes for large cross-product", () => {
      // Create many events
      const users = Array.from({ length: 10 }, () => new FakeUser());
      const notes: NostrEvent[] = [];

      users.forEach((user) => {
        const note = user.note("Test");
        notes.push(note);
        eventMemory.add(note);
      });

      // Query with large cross-product (should use separate indexes)
      const results = eventMemory.getByFilters({
        kinds: [kinds.ShortTextNote, kinds.Metadata, kinds.Reaction],
        authors: users.map((u) => u.pubkey),
      });

      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe("filter by ids", () => {
    it("should filter events by single id", () => {
      const note1 = user1.note("Note 1");
      const note2 = user1.note("Note 2");

      eventMemory.add(note1);
      eventMemory.add(note2);

      const results = eventMemory.getByFilters({ ids: [note1.id] });
      expect(results).toHaveLength(1);
      expect(results).toContainEqual(note1);
    });

    it("should filter events by multiple ids", () => {
      const note1 = user1.note("Note 1");
      const note2 = user1.note("Note 2");
      const note3 = user1.note("Note 3");

      eventMemory.add(note1);
      eventMemory.add(note2);
      eventMemory.add(note3);

      const results = eventMemory.getByFilters({ ids: [note1.id, note3.id] });
      expect(results).toHaveLength(2);
      expect(results).toContainEqual(note1);
      expect(results).toContainEqual(note3);
    });
  });

  describe("filter by tags", () => {
    it("should filter events by single tag", () => {
      const note1 = user1.note("Note 1", { tags: [["p", user2.pubkey]] });
      const note2 = user1.note("Note 2", { tags: [["p", "other-pubkey"]] });

      eventMemory.add(note1);
      eventMemory.add(note2);

      const results = eventMemory.getByFilters({ "#p": [user2.pubkey] });
      expect(results).toHaveLength(1);
      expect(results).toContainEqual(note1);
    });

    it("should filter events by multiple tag values", () => {
      const note1 = user1.note("Note 1", { tags: [["e", "event-1"]] });
      const note2 = user1.note("Note 2", { tags: [["e", "event-2"]] });
      const note3 = user1.note("Note 3", { tags: [["e", "event-3"]] });

      eventMemory.add(note1);
      eventMemory.add(note2);
      eventMemory.add(note3);

      const results = eventMemory.getByFilters({ "#e": ["event-1", "event-3"] });
      expect(results).toHaveLength(2);
      expect(results).toContainEqual(note1);
      expect(results).toContainEqual(note3);
    });
  });

  describe("filter by time", () => {
    it("should filter events by since", () => {
      const old = user1.note("Old", { created_at: 1000 });
      const recent = user1.note("Recent", { created_at: 2000 });

      eventMemory.add(old);
      eventMemory.add(recent);

      const results = eventMemory.getByFilters({ since: 1500 });
      expect(results).toHaveLength(1);
      expect(results).toContainEqual(recent);
    });

    it("should filter events by until", () => {
      const old = user1.note("Old", { created_at: 1000 });
      const recent = user1.note("Recent", { created_at: 2000 });

      eventMemory.add(old);
      eventMemory.add(recent);

      const results = eventMemory.getByFilters({ until: 1500 });
      expect(results).toHaveLength(1);
      expect(results).toContainEqual(old);
    });

    it("should filter events by time range", () => {
      const events = [
        user1.note("1", { created_at: 1000 }),
        user1.note("2", { created_at: 2000 }),
        user1.note("3", { created_at: 3000 }),
        user1.note("4", { created_at: 4000 }),
      ];

      events.forEach((e) => eventMemory.add(e));

      const results = eventMemory.getByFilters({ since: 1500, until: 3500 });
      expect(results).toHaveLength(2);
      expect(results).toContainEqual(events[1]);
      expect(results).toContainEqual(events[2]);
    });
  });

  describe("combined filters", () => {
    it("should handle complex filter combinations", () => {
      const target = user1.note("Target", {
        created_at: 2000,
        tags: [["p", user2.pubkey]],
      });

      const wrong1 = user2.note("Wrong author", {
        created_at: 2000,
        tags: [["p", user2.pubkey]],
      });

      const wrong2 = user1.note("Wrong time", {
        created_at: 1000,
        tags: [["p", user2.pubkey]],
      });

      const wrong3 = user1.note("Wrong tag", {
        created_at: 2000,
        tags: [["p", "other"]],
      });

      eventMemory.add(target);
      eventMemory.add(wrong1);
      eventMemory.add(wrong2);
      eventMemory.add(wrong3);

      const results = eventMemory.getByFilters({
        authors: [user1.pubkey],
        kinds: [kinds.ShortTextNote],
        "#p": [user2.pubkey],
        since: 1500,
        until: 2500,
      });

      expect(results).toHaveLength(1);
      expect(results).toContainEqual(target);
    });
  });

  describe("multiple filters (OR)", () => {
    it("should combine results from multiple filters", () => {
      const note1 = user1.note("Note 1");
      const note2 = user2.note("Note 2");

      eventMemory.add(note1);
      eventMemory.add(note2);

      const results = eventMemory.getByFilters([{ authors: [user1.pubkey] }, { authors: [user2.pubkey] }]);

      expect(results).toHaveLength(2);
      expect(results).toContainEqual(note1);
      expect(results).toContainEqual(note2);
    });
  });
});

describe("EventMemory - Timeline", () => {
  it("should return events sorted by created_at descending", () => {
    const events = [
      user1.note("1", { created_at: 3000 }),
      user1.note("2", { created_at: 1000 }),
      user1.note("3", { created_at: 2000 }),
    ];

    // Add in random order
    events.forEach((e) => eventMemory.add(e));

    const timeline = eventMemory.getTimeline({});

    expect(timeline).toHaveLength(3);
    expect(timeline[0].created_at).toBe(3000);
    expect(timeline[1].created_at).toBe(2000);
    expect(timeline[2].created_at).toBe(1000);
  });

  it("should maintain sort order with filters", () => {
    const user1Events = [user1.note("1", { created_at: 3000 }), user1.note("2", { created_at: 1000 })];

    const user2Events = [user2.note("3", { created_at: 4000 }), user2.note("4", { created_at: 2000 })];

    [...user1Events, ...user2Events].forEach((e) => eventMemory.add(e));

    const timeline = eventMemory.getTimeline({ authors: [user1.pubkey] });

    expect(timeline).toHaveLength(2);
    expect(timeline[0].created_at).toBe(3000);
    expect(timeline[1].created_at).toBe(1000);
  });
});

describe("EventMemory - Claims and Pruning", () => {
  describe("claim/unclaim", () => {
    it("should track claimed events", () => {
      const note = user1.note("Test");
      eventMemory.add(note);

      expect(eventMemory.isClaimed(note)).toBe(false);

      eventMemory.claim(note);
      expect(eventMemory.isClaimed(note)).toBe(true);
    });

    it("should handle multiple claims on same event", () => {
      const note = user1.note("Test");
      eventMemory.add(note);

      eventMemory.claim(note);
      eventMemory.claim(note);
      eventMemory.claim(note);

      expect(eventMemory.isClaimed(note)).toBe(true);

      eventMemory.removeClaim(note);
      expect(eventMemory.isClaimed(note)).toBe(true);

      eventMemory.removeClaim(note);
      expect(eventMemory.isClaimed(note)).toBe(true);

      eventMemory.removeClaim(note);
      expect(eventMemory.isClaimed(note)).toBe(false);
    });

    it("should clear all claims", () => {
      const note = user1.note("Test");
      eventMemory.add(note);

      eventMemory.claim(note);
      eventMemory.claim(note);
      eventMemory.claim(note);

      eventMemory.clearClaim(note);
      expect(eventMemory.isClaimed(note)).toBe(false);
    });
  });

  describe("prune", () => {
    it("should remove unclaimed events", () => {
      const claimed = user1.note("Claimed");
      const unclaimed = user1.note("Unclaimed");

      eventMemory.add(claimed);
      eventMemory.add(unclaimed);
      eventMemory.claim(claimed);

      const removed = eventMemory.prune();

      expect(removed).toBe(1);
      expect(eventMemory.hasEvent(claimed.id)).toBe(true);
      expect(eventMemory.hasEvent(unclaimed.id)).toBe(false);
    });

    it("should respect prune limit", () => {
      const events = Array.from({ length: 10 }, (_, i) => user1.note(`Note ${i}`));

      events.forEach((e) => eventMemory.add(e));

      const removed = eventMemory.prune(5);

      expect(removed).toBe(5);
      expect(eventMemory.size).toBe(5);
    });

    it("should not remove claimed events", () => {
      const events = Array.from({ length: 5 }, (_, i) => user1.note(`Note ${i}`));

      events.forEach((e) => {
        eventMemory.add(e);
        eventMemory.claim(e);
      });

      const removed = eventMemory.prune();

      expect(removed).toBe(0);
      expect(eventMemory.size).toBe(5);
    });
  });

  describe("touch", () => {
    it("should move event to top of LRU", () => {
      const note1 = user1.note("Note 1");
      const note2 = user1.note("Note 2");

      eventMemory.add(note1);
      eventMemory.add(note2);

      // Touch note1 to move it to the top
      eventMemory.touch(note1);

      // Both should still be in memory
      expect(eventMemory.hasEvent(note1.id)).toBe(true);
      expect(eventMemory.hasEvent(note2.id)).toBe(true);
    });
  });
});

describe("EventMemory - Edge Cases", () => {
  it("should handle events with same timestamp", () => {
    const events = [
      user1.note("1", { created_at: 1000 }),
      user1.note("2", { created_at: 1000 }),
      user1.note("3", { created_at: 1000 }),
    ];

    events.forEach((e) => eventMemory.add(e));

    const timeline = eventMemory.getTimeline({});
    expect(timeline).toHaveLength(3);

    // Remove middle event
    eventMemory.remove(events[1]);

    const afterRemove = eventMemory.getTimeline({});
    expect(afterRemove).toHaveLength(2);
    expect(afterRemove).toContainEqual(events[0]);
    expect(afterRemove).toContainEqual(events[2]);
  });

  it("should handle empty filters", () => {
    const note = user1.note("Test");
    eventMemory.add(note);

    const results = eventMemory.getByFilters({});
    expect(results).toHaveLength(1); // Empty filter returns all events
    expect(results).toContainEqual(note);
  });

  it("should handle filters with no matches", () => {
    const note = user1.note("Test");
    eventMemory.add(note);

    const results = eventMemory.getByFilters({ authors: ["non-existent-pubkey"] });
    expect(results).toHaveLength(0);
  });

  it("should handle removeByFilters", () => {
    const user1Notes = [user1.note("Note 1"), user1.note("Note 2")];
    const user2Notes = [user2.note("Note 3")];

    [...user1Notes, ...user2Notes].forEach((e) => eventMemory.add(e));

    const removed = eventMemory.removeByFilters({ authors: [user1.pubkey] });

    expect(removed).toBe(2);
    expect(eventMemory.size).toBe(1);
    expect(eventMemory.hasEvent(user2Notes[0].id)).toBe(true);
  });
});

describe("EventMemory - NIP-91 AND Operator", () => {
  describe("basic AND functionality", () => {
    it("should filter events with AND operator requiring all tag values", () => {
      // Create events with different tag combinations
      const event1 = user1.note("Has both meme and cat", {
        tags: [
          ["t", "meme"],
          ["t", "cat"],
        ],
      });
      const event2 = user1.note("Has only meme", {
        tags: [["t", "meme"]],
      });
      const event3 = user1.note("Has only cat", {
        tags: [["t", "cat"]],
      });
      const event4 = user1.note("Has both plus dog", {
        tags: [
          ["t", "meme"],
          ["t", "cat"],
          ["t", "dog"],
        ],
      });

      eventMemory.add(event1);
      eventMemory.add(event2);
      eventMemory.add(event3);
      eventMemory.add(event4);

      // Query with AND operator - must have BOTH meme AND cat
      const results = eventMemory.getByFilters({
        kinds: [kinds.ShortTextNote],
        "&t": ["meme", "cat"],
      });

      expect(results).toHaveLength(2);
      expect(results).toContainEqual(event1);
      expect(results).toContainEqual(event4);
      expect(results).not.toContainEqual(event2);
      expect(results).not.toContainEqual(event3);
    });

    it("should handle AND with single value", () => {
      const event1 = user1.note("Has meme", { tags: [["t", "meme"]] });
      const event2 = user1.note("No tags", { tags: [] });

      eventMemory.add(event1);
      eventMemory.add(event2);

      const results = eventMemory.getByFilters({
        kinds: [kinds.ShortTextNote],
        "&t": ["meme"],
      });

      expect(results).toHaveLength(1);
      expect(results).toContainEqual(event1);
    });

    it("should return empty set when no events match AND condition", () => {
      const event1 = user1.note("Has only meme", { tags: [["t", "meme"]] });
      const event2 = user1.note("Has only cat", { tags: [["t", "cat"]] });

      eventMemory.add(event1);
      eventMemory.add(event2);

      const results = eventMemory.getByFilters({
        kinds: [kinds.ShortTextNote],
        "&t": ["meme", "cat", "dog"],
      });

      expect(results).toHaveLength(0);
    });
  });

  describe("AND with OR combination", () => {
    it("should combine AND and OR filters on same tag type", () => {
      // From NIP-91 spec example:
      // "&t": ["meme", "cat"] - must have both
      // "#t": ["black", "white"] - must have black OR white
      const event1 = user1.note("Has meme, cat, and black", {
        tags: [
          ["t", "meme"],
          ["t", "cat"],
          ["t", "black"],
        ],
      });
      const event2 = user1.note("Has meme, cat, and white", {
        tags: [
          ["t", "meme"],
          ["t", "cat"],
          ["t", "white"],
        ],
      });
      const event3 = user1.note("Has meme and black (missing cat)", {
        tags: [
          ["t", "meme"],
          ["t", "black"],
        ],
      });
      const event4 = user1.note("Has cat and black (missing meme)", {
        tags: [
          ["t", "cat"],
          ["t", "black"],
        ],
      });
      const event5 = user1.note("Has meme and cat (missing black/white)", {
        tags: [
          ["t", "meme"],
          ["t", "cat"],
        ],
      });

      [event1, event2, event3, event4, event5].forEach((e) => eventMemory.add(e));

      const results = eventMemory.getByFilters({
        kinds: [kinds.ShortTextNote],
        "&t": ["meme", "cat"],
        "#t": ["black", "white"],
      });

      expect(results).toHaveLength(2);
      expect(results).toContainEqual(event1);
      expect(results).toContainEqual(event2);
      expect(results).not.toContainEqual(event3);
      expect(results).not.toContainEqual(event4);
      expect(results).not.toContainEqual(event5);
    });

    it("should filter out OR values that are in AND tags (NIP-91 rule)", () => {
      // If "meme" is in AND, it should be ignored in OR
      const event1 = user1.note("Has meme and cat", {
        tags: [
          ["t", "meme"],
          ["t", "cat"],
        ],
      });
      const event2 = user1.note("Has only meme", {
        tags: [["t", "meme"]],
      });
      const event3 = user1.note("Has only cat", {
        tags: [["t", "cat"]],
      });

      [event1, event2, event3].forEach((e) => eventMemory.add(e));

      // Both AND and OR specify "meme", but AND takes precedence
      const results = eventMemory.getByFilters({
        kinds: [kinds.ShortTextNote],
        "&t": ["meme"],
        "#t": ["meme", "cat"], // "meme" should be filtered out from OR
      });

      // Should match events that have "meme" (from AND) AND ("cat" from OR)
      expect(results).toHaveLength(1);
      expect(results).toContainEqual(event1);
    });

    it("should handle case where all OR values are filtered out", () => {
      const event1 = user1.note("Has meme", {
        tags: [["t", "meme"]],
      });

      eventMemory.add(event1);

      // AND has "meme", OR only has "meme" - so OR becomes empty and is ignored
      const results = eventMemory.getByFilters({
        kinds: [kinds.ShortTextNote],
        "&t": ["meme"],
        "#t": ["meme"], // This gets filtered out completely
      });

      // Should match event1 because it satisfies the AND condition
      expect(results).toHaveLength(1);
      expect(results).toContainEqual(event1);
    });
  });

  describe("AND with multiple tag types", () => {
    it("should handle AND on different tag types", () => {
      const event1 = user1.note("Has both tags", {
        tags: [
          ["t", "meme"],
          ["p", user2.pubkey],
        ],
      });
      const event2 = user1.note("Has only t tag", {
        tags: [["t", "meme"]],
      });
      const event3 = user1.note("Has only p tag", {
        tags: [["p", user2.pubkey]],
      });

      [event1, event2, event3].forEach((e) => eventMemory.add(e));

      const results = eventMemory.getByFilters({
        kinds: [kinds.ShortTextNote],
        "&t": ["meme"],
        "&p": [user2.pubkey],
      });

      expect(results).toHaveLength(1);
      expect(results).toContainEqual(event1);
    });

    it("should combine AND and OR on different tag types", () => {
      const event1 = user1.note("Perfect match", {
        tags: [
          ["t", "meme"],
          ["p", user2.pubkey],
          ["e", "event-1"],
        ],
      });
      const event2 = user1.note("Missing AND tag", {
        tags: [
          ["p", user2.pubkey],
          ["e", "event-1"],
        ],
      });
      const event3 = user1.note("Missing OR tag", {
        tags: [
          ["t", "meme"],
          ["p", user2.pubkey],
        ],
      });

      [event1, event2, event3].forEach((e) => eventMemory.add(e));

      const results = eventMemory.getByFilters({
        kinds: [kinds.ShortTextNote],
        "&t": ["meme"],
        "&p": [user2.pubkey],
        "#e": ["event-1", "event-2"], // OR condition
      });

      expect(results).toHaveLength(1);
      expect(results).toContainEqual(event1);
    });
  });

  describe("AND with other filter types", () => {
    it("should combine AND with author filter", () => {
      const event1 = user1.note("User1 with tags", {
        tags: [
          ["t", "meme"],
          ["t", "cat"],
        ],
      });
      const event2 = user2.note("User2 with tags", {
        tags: [
          ["t", "meme"],
          ["t", "cat"],
        ],
      });

      eventMemory.add(event1);
      eventMemory.add(event2);

      const results = eventMemory.getByFilters({
        authors: [user1.pubkey],
        kinds: [kinds.ShortTextNote],
        "&t": ["meme", "cat"],
      });

      expect(results).toHaveLength(1);
      expect(results).toContainEqual(event1);
    });

    it("should combine AND with time filters", () => {
      const event1 = user1.note("Old with tags", {
        created_at: 1000,
        tags: [
          ["t", "meme"],
          ["t", "cat"],
        ],
      });
      const event2 = user1.note("New with tags", {
        created_at: 2000,
        tags: [
          ["t", "meme"],
          ["t", "cat"],
        ],
      });

      eventMemory.add(event1);
      eventMemory.add(event2);

      const results = eventMemory.getByFilters({
        kinds: [kinds.ShortTextNote],
        since: 1500,
        "&t": ["meme", "cat"],
      });

      expect(results).toHaveLength(1);
      expect(results).toContainEqual(event2);
    });
  });

  describe("edge cases", () => {
    it("should handle empty AND array", () => {
      const event1 = user1.note("Test", { tags: [["t", "meme"]] });
      eventMemory.add(event1);

      const results = eventMemory.getByFilters({
        kinds: [kinds.ShortTextNote],
        "&t": [],
      });

      // Empty AND array should not filter anything
      expect(results).toHaveLength(1);
    });

    it("should handle AND on non-existent tag type", () => {
      const event1 = user1.note("Test", { tags: [["t", "meme"]] });
      eventMemory.add(event1);

      const results = eventMemory.getByFilters({
        kinds: [kinds.ShortTextNote],
        "&z": ["nonexistent"],
      });

      expect(results).toHaveLength(0);
    });

    it("should work with multiple filters (OR at filter level)", () => {
      const event1 = user1.note("Has meme and cat", {
        tags: [
          ["t", "meme"],
          ["t", "cat"],
        ],
      });
      const event2 = user2.note("User2 note", { tags: [] });

      eventMemory.add(event1);
      eventMemory.add(event2);

      // Multiple filters = OR at the filter level
      const results = eventMemory.getByFilters([
        {
          kinds: [kinds.ShortTextNote],
          "&t": ["meme", "cat"],
        },
        {
          kinds: [kinds.ShortTextNote],
          authors: [user2.pubkey],
        },
      ]);

      expect(results).toHaveLength(2);
      expect(results).toContainEqual(event1);
      expect(results).toContainEqual(event2);
    });

    it("should handle complex real-world scenario", () => {
      // Create a variety of events
      const events = [
        user1.note("Perfect match", {
          created_at: 2000,
          tags: [
            ["t", "nostr"],
            ["t", "bitcoin"],
            ["t", "meme"],
            ["p", user2.pubkey],
          ],
        }),
        user1.note("Missing bitcoin tag", {
          created_at: 2000,
          tags: [
            ["t", "nostr"],
            ["t", "meme"],
            ["p", user2.pubkey],
          ],
        }),
        user1.note("Wrong time", {
          created_at: 500,
          tags: [
            ["t", "nostr"],
            ["t", "bitcoin"],
            ["t", "meme"],
            ["p", user2.pubkey],
          ],
        }),
        user2.note("Wrong author", {
          created_at: 2000,
          tags: [
            ["t", "nostr"],
            ["t", "bitcoin"],
            ["t", "meme"],
            ["p", user2.pubkey],
          ],
        }),
      ];

      events.forEach((e) => eventMemory.add(e));

      const results = eventMemory.getByFilters({
        authors: [user1.pubkey],
        kinds: [kinds.ShortTextNote],
        since: 1000,
        "&t": ["nostr", "bitcoin"], // Must have both
        "#t": ["meme"], // Must have meme (OR, but only one value)
        "#p": [user2.pubkey], // Must mention user2
      });

      expect(results).toHaveLength(1);
      expect(results).toContainEqual(events[0]);
    });
  });
});
