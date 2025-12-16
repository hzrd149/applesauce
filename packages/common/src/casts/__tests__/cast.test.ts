import { EventStore } from "applesauce-core/event-store";
import { isObservable, Observable } from "rxjs";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { castEvent } from "../cast.js";
import { Note } from "../note.js";

let user = new FakeUser();
let store = new EventStore();

beforeEach(() => {
  user = new FakeUser();
  store = new EventStore();
});

describe("cast", () => {
  it("should cast an event to a specific class", () => {
    const event = user.note();
    const casted = castEvent(event, Note);
    expect(casted).toBeInstanceOf(Note);
  });

  it("should create multiple instances of the same cast", () => {
    const event = user.note();
    const casted = castEvent(event, Note);
    const casted2 = castEvent(event, Note);
    expect(casted).toBe(casted2);
  });

  describe("references", () => {
    it("should throw an error if not attached to an event store", () => {
      const event = user.note();
      expect(() => castEvent(event, Note).replies$).toThrow();
    });

    it("should return an observable", () => {
      const event = user.note();
      store.add(event);
      const note = castEvent(event, Note);
      expect(note.replies$).toBeInstanceOf(Observable);
      expect(isObservable(note.replies$)).toBe(true);
    });

    it("should allow chaining", () => {
      const event = store.add(user.note())!;
      const note = castEvent(event, Note);
      const inboxes = note.author.mailboxes$.inboxes;
      expect(inboxes).toBeInstanceOf(Observable);
      expect(isObservable(inboxes)).toBe(true);
    });

    it("should return the same observable", () => {
      const event = store.add(user.note())!;
      const note = castEvent(event, Note);
      expect(note.replies$).toBe(note.replies$);
      expect(note.author.inboxes$).toBe(note.author.inboxes$);
    });
  });
});
