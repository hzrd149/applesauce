import { kinds } from "applesauce-core/helpers";
import { beforeEach, describe, expect, it } from "vitest";

import { SqliteEventDatabase } from "../sqlite-event-database.js";
import { FakeUser } from "./fake-user.js";

let database: SqliteEventDatabase;
let user: FakeUser;

beforeEach(() => {
  database = new SqliteEventDatabase(":memory:");
  user = new FakeUser();
});

const profile = () => user.profile({ name: "test user" });
const note = () => user.note("Hello World");

describe("add", () => {
  it("should store and retrieve a single event", () => {
    const event = profile();
    const result = database.add(event);

    expect(result).toBe(event);
    expect(database.getEvent(event.id)).toBe(event);
    expect(database.hasEvent(event.id)).toBe(true);
  });

  it("should return the same instance for duplicate events", () => {
    const originalEvent = profile();
    const duplicateEvent = { ...originalEvent };

    const first = database.add(originalEvent);
    const second = database.add(duplicateEvent);

    expect(first).toBe(originalEvent);
    expect(second).toBe(originalEvent);
    expect(first).toBe(second);
  });

  it("should handle multiple different events", () => {
    const event1 = profile();
    const event2 = note();

    const result1 = database.add(event1);
    const result2 = database.add(event2);

    expect(result1).toBe(event1);
    expect(result2).toBe(event2);
    expect(database.getEvent(event1.id)).toBe(event1);
    expect(database.getEvent(event2.id)).toBe(event2);
  });

  it("should store events without validation (validation is done at EventStore level)", () => {
    const invalidEvent = {
      ...profile(),
      sig: "invalid_signature",
    };

    // SqliteEventDatabase is a raw database layer - it doesn't validate signatures
    const result = database.add(invalidEvent);
    expect(result).toBe(invalidEvent);
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
    expect(retrieved).toBe(event);
    expect(database.hasReplaceable(event.kind, event.pubkey)).toBe(true);
  });

  it("should replace older events with newer ones", () => {
    const oldEvent = user.profile({ name: "old name" }, { created_at: 1000 });
    const newEvent = user.profile({ name: "new name" }, { created_at: 2000 });

    database.add(oldEvent);
    database.add(newEvent);

    const retrieved = database.getReplaceable(oldEvent.kind, oldEvent.pubkey);
    expect(retrieved).toBe(newEvent);
    expect(retrieved?.content).toContain("new name");
  });

  it("should not replace newer events with older ones", () => {
    const newEvent = user.profile({ name: "new name" }, { created_at: 2000 });
    const oldEvent = user.profile({ name: "old name" }, { created_at: 1000 });

    database.add(newEvent);
    database.add(oldEvent);

    const retrieved = database.getReplaceable(newEvent.kind, newEvent.pubkey);
    expect(retrieved).toBe(newEvent);
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

    expect(database.getReplaceable(30000, user.pubkey, "identifier1")).toBe(event1);
    expect(database.getReplaceable(30000, user.pubkey, "identifier2")).toBe(event2);
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
    expect(history).toContain(event1);
    expect(history).toContain(event2);
    expect(history).toContain(event3);
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

    expect(profiles.has(profileEvent)).toBe(true);
    expect(profiles.has(noteEvent)).toBe(false);
    expect(notes.has(noteEvent)).toBe(true);
    expect(notes.has(profileEvent)).toBe(false);
  });

  it("should return events matching author filter", () => {
    const user2 = new FakeUser();
    const event1 = profile();
    const event2 = user2.profile({ name: "user2" });

    database.add(event1);
    database.add(event2);

    const user1Events = database.getByFilters({ authors: [user.pubkey] });
    const user2Events = database.getByFilters({ authors: [user2.pubkey] });

    expect(user1Events.has(event1)).toBe(true);
    expect(user1Events.has(event2)).toBe(false);
    expect(user2Events.has(event2)).toBe(true);
    expect(user2Events.has(event1)).toBe(false);
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

    expect(results.has(profileEvent)).toBe(true);
    expect(results.has(noteEvent)).toBe(true);
  });

  it("should handle empty results gracefully", () => {
    const results = database.getByFilters({ kinds: [999] });
    expect(results.size).toBe(0);
  });

  it("should return same event instances from memory", () => {
    const event = profile();
    database.add(event);

    const results = database.getByFilters({ kinds: [event.kind] });
    const retrievedEvent = Array.from(results)[0];

    expect(retrievedEvent).toBe(event);
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
    expect(timeline[0]).toBe(event3); // Most recent first
    expect(timeline[1]).toBe(event2);
    expect(timeline[2]).toBe(event1);
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

  it("should work with persistent database file", () => {
    // Create a temporary database file
    const tempDb = new SqliteEventDatabase("test.db");
    const event = profile();

    tempDb.add(event);
    expect(tempDb.hasEvent(event.id)).toBe(true);

    tempDb.close();

    // Reopen the same database file
    const reopenedDb = new SqliteEventDatabase("test.db");
    expect(reopenedDb.hasEvent(event.id)).toBe(true);
    expect(reopenedDb.getEvent(event.id)?.id).toBe(event.id);

    reopenedDb.close();
  });
});

describe("error handling", () => {
  it("should handle database errors gracefully in getByFilters", () => {
    database.close(); // Close database to simulate error

    const results = database.getByFilters({ kinds: [1] });
    expect(results.size).toBe(0);
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

describe("memory consistency", () => {
  it("should always return same event instance from memory", () => {
    const event = profile();

    // Add event
    const addResult = database.add(event);
    expect(addResult).toBe(event);

    // Get by ID
    const getResult = database.getEvent(event.id);
    expect(getResult).toBe(event);

    // Get by replaceable
    const replaceableResult = database.getReplaceable(event.kind, event.pubkey);
    expect(replaceableResult).toBe(event);

    // Get by filters
    const filterResults = database.getByFilters({ ids: [event.id] });
    const filterResult = Array.from(filterResults)[0];
    expect(filterResult).toBe(event);

    // Get timeline
    const timelineResults = database.getTimeline({ ids: [event.id] });
    expect(timelineResults[0]).toBe(event);

    // All should be the exact same instance
    expect(addResult).toBe(getResult);
    expect(getResult).toBe(replaceableResult);
    expect(replaceableResult).toBe(filterResult);
    expect(filterResult).toBe(timelineResults[0]);
  });

  it("should maintain instance consistency across different query methods", () => {
    const events = [profile(), note(), user.event({ kind: 30000, tags: [["d", "test"]] })];

    // Add all events
    const addedEvents = events.map((e) => database.add(e));

    // Verify all different access methods return same instances
    events.forEach((originalEvent, index) => {
      const addedEvent = addedEvents[index];
      const getEventResult = database.getEvent(originalEvent.id);
      const filterResult = Array.from(database.getByFilters({ ids: [originalEvent.id] }))[0];

      expect(addedEvent).toBe(originalEvent);
      expect(getEventResult).toBe(originalEvent);
      expect(filterResult).toBe(originalEvent);
    });
  });
});
