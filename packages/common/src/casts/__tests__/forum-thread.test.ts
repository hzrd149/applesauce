import { EventStore } from "applesauce-core/event-store";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { castEvent } from "../cast.js";
import { ForumThread } from "../forum-thread.js";

describe("forum thread cast", () => {
  it("reads the title and content of a kind 11 thread", () => {
    const user = new FakeUser();
    const store = new EventStore();
    const event = store.add(user.event({ kind: 11, content: "Good morning", tags: [["title", "GM"]] }))!;

    const cast = castEvent(event, ForumThread, store);

    expect(cast.title).toBe("GM");
    expect(cast.content).toBe("Good morning");
  });

  it("rejects invalid events", () => {
    const user = new FakeUser();
    const store = new EventStore();
    const event = store.add(user.event({ kind: 1, content: "hi", tags: [] }))!;

    expect(() => castEvent(event, ForumThread, store)).toThrow();
  });
});
