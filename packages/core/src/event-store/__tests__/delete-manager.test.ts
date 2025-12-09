import { describe, expect, it, beforeEach } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { kinds, NostrEvent } from "../../helpers/event.js";
import { DeleteManager } from "../delete-manager.js";

let deleteManager: DeleteManager;
let userA: FakeUser;
let userB: FakeUser;

beforeEach(() => {
  deleteManager = new DeleteManager();
  userA = new FakeUser();
  userB = new FakeUser();
});

describe("normal events", () => {
  it("should allow user to delete their own event by ID", () => {
    const note = userA.note();

    const deleteEvent: NostrEvent = {
      id: "delete-event-id",
      kind: kinds.EventDeletion,
      created_at: note.created_at + 100,
      pubkey: userA.pubkey,
      tags: [["e", note.id]],
      sig: "sig",
      content: "",
    };

    deleteManager.add(deleteEvent);

    // Should be deleted because same author
    expect(deleteManager.check(note)).toBe(true);
  });

  it("should NOT allow user to delete another user's event by ID", () => {
    const noteByA = userA.note();

    // User B tries to delete User A's note
    const deleteEventByB: NostrEvent = {
      id: "delete-event-id",
      kind: kinds.EventDeletion,
      created_at: noteByA.created_at + 100,
      pubkey: userB.pubkey, // Different user!
      tags: [["e", noteByA.id]],
      sig: "sig",
      content: "",
    };

    deleteManager.add(deleteEventByB);

    // Should NOT be deleted because different author
    expect(deleteManager.check(noteByA)).toBe(false);
  });

  it("should handle multiple event IDs in a single delete event", () => {
    const note1 = userA.note();
    const note2 = userA.note();
    const note3 = userA.note();

    const deleteEvent: NostrEvent = {
      id: "delete-event-id",
      kind: kinds.EventDeletion,
      created_at: note1.created_at + 100,
      pubkey: userA.pubkey,
      tags: [
        ["e", note1.id],
        ["e", note2.id],
        ["e", note3.id],
      ],
      sig: "sig",
      content: "",
    };

    deleteManager.add(deleteEvent);

    expect(deleteManager.check(note1)).toBe(true);
    expect(deleteManager.check(note2)).toBe(true);
    expect(deleteManager.check(note3)).toBe(true);
  });
});

describe("replaceable events", () => {
  it("should allow user to delete their own replaceable event by coordinate", () => {
    const profile = userA.profile({ name: "User A" });

    const deleteEvent: NostrEvent = {
      id: "delete-event-id",
      kind: kinds.EventDeletion,
      created_at: profile.created_at + 100,
      pubkey: userA.pubkey,
      tags: [["a", `${profile.kind}:${profile.pubkey}:`]],
      sig: "sig",
      content: "",
    };

    deleteManager.add(deleteEvent);

    // Should be deleted because same author and older than delete
    expect(deleteManager.check(profile)).toBe(true);
  });

  it("should NOT allow user to delete another user's replaceable event by coordinate", () => {
    const profileByA = userA.profile({ name: "User A" });

    // User B tries to delete User A's profile
    const deleteEventByB: NostrEvent = {
      id: "delete-event-id",
      kind: kinds.EventDeletion,
      created_at: profileByA.created_at + 100,
      pubkey: userB.pubkey, // Different user!
      tags: [["a", `${profileByA.kind}:${profileByA.pubkey}:`]],
      sig: "sig",
      content: "",
    };

    deleteManager.add(deleteEventByB);

    // Should NOT be deleted because different author
    expect(deleteManager.check(profileByA)).toBe(false);
  });

  it("should delete older versions but not newer versions of addressable events", () => {
    const oldEvent = userA.event({
      content: "old",
      kind: 30000,
      tags: [["d", "test"]],
    });

    const deleteEvent: NostrEvent = {
      id: "delete-event-id",
      kind: kinds.EventDeletion,
      created_at: oldEvent.created_at + 100,
      pubkey: userA.pubkey,
      tags: [["a", `${oldEvent.kind}:${oldEvent.pubkey}:test`]],
      sig: "sig",
      content: "",
    };

    const newEvent = userA.event({
      content: "new",
      kind: 30000,
      tags: [["d", "test"]],
      created_at: deleteEvent.created_at + 100, // Newer than delete
    });

    deleteManager.add(deleteEvent);

    // Old event should be deleted
    expect(deleteManager.check(oldEvent)).toBe(true);

    // New event should NOT be deleted (created after delete event)
    expect(deleteManager.check(newEvent)).toBe(false);
  });

  it("should handle addressable events without d tag (empty identifier)", () => {
    const event = userA.event({
      content: "test",
      kind: 30000,
      tags: [], // No d tag
    });

    const deleteEvent: NostrEvent = {
      id: "delete-event-id",
      kind: kinds.EventDeletion,
      created_at: event.created_at + 100,
      pubkey: userA.pubkey,
      tags: [["a", `${event.kind}:${event.pubkey}:`]], // Empty identifier
      sig: "sig",
      content: "",
    };

    deleteManager.add(deleteEvent);

    expect(deleteManager.check(event)).toBe(true);
  });

  it("should update to most recent delete timestamp for coordinates", () => {
    const event = userA.profile({ name: "User A" });

    // First delete event
    const deleteEvent1: NostrEvent = {
      id: "delete-event-1",
      kind: kinds.EventDeletion,
      created_at: event.created_at + 50,
      pubkey: userA.pubkey,
      tags: [["a", `${event.kind}:${event.pubkey}:`]],
      sig: "sig",
      content: "",
    };

    // Second, newer delete event
    const deleteEvent2: NostrEvent = {
      id: "delete-event-2",
      kind: kinds.EventDeletion,
      created_at: event.created_at + 200,
      pubkey: userA.pubkey,
      tags: [["a", `${event.kind}:${event.pubkey}:`]],
      sig: "sig",
      content: "",
    };

    deleteManager.add(deleteEvent1);
    deleteManager.add(deleteEvent2);

    // Event should be deleted (older than both deletes)
    expect(deleteManager.check(event)).toBe(true);

    // A newer profile should also be deleted if older than the latest delete
    const newerProfile = userA.profile(
      { name: "Updated" },
      { created_at: deleteEvent1.created_at + 50 }, // Between the two deletes
    );
    expect(deleteManager.check(newerProfile)).toBe(true);

    // But a profile newer than the latest delete should not be deleted
    const newestProfile = userA.profile({ name: "Newest" }, { created_at: deleteEvent2.created_at + 50 });
    expect(deleteManager.check(newestProfile)).toBe(false);
  });
});

describe("filter", () => {
  it("should filter out deleted events", () => {
    const note1 = userA.note("1");
    const note2 = userA.note("2");
    const note3 = userB.note("3");

    const deleteEvent: NostrEvent = {
      id: "delete-event-id",
      kind: kinds.EventDeletion,
      created_at: note1.created_at + 100,
      pubkey: userA.pubkey,
      tags: [["e", note1.id]],
      sig: "sig",
      content: "",
    };

    deleteManager.add(deleteEvent);

    const events = [note1, note2, note3];
    const filtered = deleteManager.filter(events);

    // note1 should be filtered out (deleted)
    expect(filtered).toHaveLength(2);
    expect(filtered).not.toContain(note1);
    expect(filtered).toContain(note2);
    expect(filtered).toContain(note3);
  });

  it("should filter out deleted replaceable events", () => {
    const profile1 = userA.profile({ name: "User A" });
    const profile2 = userB.profile({ name: "User B" });

    const deleteEvent: NostrEvent = {
      id: "delete-event-id",
      kind: kinds.EventDeletion,
      created_at: profile1.created_at + 100,
      pubkey: userA.pubkey,
      tags: [["a", `${profile1.kind}:${profile1.pubkey}`]],
      sig: "sig",
      content: "",
    };

    deleteManager.add(deleteEvent);

    const events = [profile1, profile2];
    const filtered = deleteManager.filter(events);

    // profile1 should be filtered out (deleted)
    expect(filtered).toHaveLength(1);
    expect(filtered).not.toContain(profile1);
    expect(filtered).toContain(profile2);
  });
});

describe("edge cases", () => {
  it("should handle delete event with no tags", () => {
    const deleteEvent: NostrEvent = {
      id: "delete-event",
      kind: kinds.EventDeletion,
      created_at: Date.now(),
      pubkey: userA.pubkey,
      tags: [],
      sig: "sig",
      content: "",
    };

    // Should not throw and return empty array
    const result = deleteManager.add(deleteEvent);
    expect(result).toEqual([]);
  });

  it("should handle checking deletion of non-addressable event", () => {
    const note = userA.note(); // Kind 1 is not addressable

    const deleteEvent: NostrEvent = {
      id: "delete-event",
      kind: kinds.EventDeletion,
      created_at: note.created_at + 100,
      pubkey: userA.pubkey,
      tags: [["e", note.id]],
      sig: "sig",
      content: "",
    };

    deleteManager.add(deleteEvent);

    // Should be deleted by ID
    expect(deleteManager.check(note)).toBe(true);
  });

  it("should return false for events that were never deleted", () => {
    const note = userA.note();

    expect(deleteManager.check(note)).toBe(false);
  });

  it("should handle non-delete events", () => {
    const note = userA.note();

    const nonDeleteEvent: NostrEvent = {
      id: "not-a-delete",
      kind: kinds.ShortTextNote,
      created_at: note.created_at + 100,
      pubkey: userA.pubkey,
      tags: [["e", note.id]],
      sig: "sig",
      content: "not a delete",
    };

    const result = deleteManager.add(nonDeleteEvent);
    expect(result).toEqual([]);
    expect(deleteManager.check(note)).toBe(false);
  });
});
