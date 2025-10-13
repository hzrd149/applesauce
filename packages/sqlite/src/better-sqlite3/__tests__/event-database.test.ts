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
