import { EventFactory, EventStore } from "applesauce-core";
import { kinds } from "applesauce-core/helpers/event";
import { beforeEach, describe, expect, it, vitest } from "vitest";
import { FakeUser } from "../../__tests__/fake-user.js";
import { ActionHub } from "../../action-hub.js";
import { BookmarkEvent, CreateBookmarkList, CreateBookmarkSet, UnbookmarkEvent } from "../bookmarks.js";

const user = new FakeUser();

let events: EventStore;
let factory: EventFactory;
let publish: () => Promise<void>;
let hub: ActionHub;
beforeEach(() => {
  events = new EventStore();
  factory = new EventFactory({ signer: user });
  publish = vitest.fn().mockResolvedValue(undefined);
  hub = new ActionHub(events, factory, publish);
});

describe("CreateBookmarkList", () => {
  it("should publish a kind 10003 bookmark list", async () => {
    await hub.run(CreateBookmarkList);

    expect(publish).toBeCalledWith(expect.objectContaining({ kind: kinds.BookmarkList }));
  });

  it("should publish a bookmark list with initial bookmarks", async () => {
    const testEvent = user.note("Test note");
    await hub.run(CreateBookmarkList, [testEvent]);

    expect(publish).toBeCalledWith(
      expect.objectContaining({
        kind: kinds.BookmarkList,
        tags: expect.arrayContaining([["e", testEvent.id]]),
      }),
    );
  });

  it("should throw if bookmark list already exists", async () => {
    // Create a bookmark list first
    events.add(user.event({ kind: kinds.BookmarkList }));

    await expect(hub.run(CreateBookmarkList)).rejects.toThrow("Bookmark list already exists");
    expect(publish).not.toBeCalled();
  });
});

describe("CreateBookmarkSet", () => {
  it("should publish a kind 10003 bookmark set with title and description", async () => {
    await hub.run(CreateBookmarkSet, "My Favorites", "A list of my favorite articles", {});

    expect(publish).toBeCalledWith(
      expect.objectContaining({
        kind: kinds.BookmarkList,
        tags: expect.arrayContaining([
          ["title", "My Favorites"],
          ["description", "A list of my favorite articles"],
        ]),
      }),
    );
  });

  it("should publish a bookmark set with image", async () => {
    await hub.run(CreateBookmarkSet, "My Favorites", "Description", { image: "https://example.com/image.jpg" });

    expect(publish).toBeCalledWith(
      expect.objectContaining({
        kind: kinds.BookmarkList,
        tags: expect.arrayContaining([
          ["title", "My Favorites"],
          ["description", "Description"],
          ["image", "https://example.com/image.jpg"],
        ]),
      }),
    );
  });

  it("should publish a bookmark set with public bookmarks", async () => {
    const testEvent = user.note("Test note");
    await hub.run(CreateBookmarkSet, "My Favorites", "Description", { public: [testEvent] });

    expect(publish).toBeCalledWith(
      expect.objectContaining({
        kind: kinds.BookmarkList,
        tags: expect.arrayContaining([
          ["title", "My Favorites"],
          ["description", "Description"],
          ["e", testEvent.id],
        ]),
      }),
    );
  });

  it("should publish a bookmark set with hidden bookmarks", async () => {
    const testEvent = user.note("Test note");
    await hub.run(CreateBookmarkSet, "My Favorites", "Description", { hidden: [testEvent] });

    expect(publish).toBeCalledWith(
      expect.objectContaining({
        kind: kinds.BookmarkList,
        tags: expect.arrayContaining([
          ["title", "My Favorites"],
          ["description", "Description"],
        ]),
      }),
    );
  });
});

describe("BookmarkEvent", () => {
  it("should create a new bookmark list when none exists", async () => {
    const testEvent = user.note("Test note");
    await hub.run(BookmarkEvent, testEvent);

    expect(publish).toBeCalledWith(
      expect.objectContaining({
        kind: kinds.BookmarkList,
        tags: expect.arrayContaining([["e", testEvent.id]]),
      }),
    );
  });

  it("should add an event to an existing bookmark list", async () => {
    const bookmarkList = user.event({ kind: kinds.BookmarkList });
    events.add(bookmarkList);

    const testEvent = user.note("Test note");
    await hub.run(BookmarkEvent, testEvent);

    expect(publish).toBeCalledWith(
      expect.objectContaining({
        kind: kinds.BookmarkList,
        tags: expect.arrayContaining([["e", testEvent.id]]),
      }),
    );
  });

  it("should create a new bookmark set when none exists with identifier", async () => {
    const testEvent = user.note("Test note");
    await hub.run(BookmarkEvent, testEvent, "test-set");

    expect(publish).toBeCalledWith(
      expect.objectContaining({
        kind: kinds.Bookmarksets,
        tags: expect.arrayContaining([["e", testEvent.id]]),
      }),
    );
  });

  it("should add an event to an existing bookmark set", async () => {
    const bookmarkSet = user.list([["d", "test-set"]]);
    events.add(bookmarkSet);

    const testEvent = user.note("Test note");
    await hub.run(BookmarkEvent, testEvent, "test-set");

    expect(publish).toBeCalledWith(
      expect.objectContaining({
        kind: kinds.Bookmarksets,
        tags: expect.arrayContaining([["e", testEvent.id]]),
      }),
    );
  });

  it("should add an event to an existing bookmark set by event reference", async () => {
    const bookmarkSet = user.list();
    events.add(bookmarkSet);

    const testEvent = user.note("Test note");
    await hub.run(BookmarkEvent, testEvent, bookmarkSet);

    expect(publish).toBeCalledWith(
      expect.objectContaining({
        kind: kinds.Bookmarksets,
        tags: expect.arrayContaining([["e", testEvent.id]]),
      }),
    );
  });

  it("should throw if provided event is not a bookmark list or set", async () => {
    const testEvent = user.note("Test note");
    const wrongEvent = user.note("Wrong event");

    await expect(hub.run(BookmarkEvent, testEvent, wrongEvent)).rejects.toThrow(
      "Event kind 1 is not a bookmark list or bookmark set",
    );
    expect(publish).not.toBeCalled();
  });
});

describe("UnbookmarkEvent", () => {
  it("should do nothing if bookmark list does not exist", async () => {
    const testEvent = user.note("Test note");
    await hub.run(UnbookmarkEvent, testEvent);

    expect(publish).not.toBeCalled();
  });

  it("should remove an event from an existing bookmark list", async () => {
    const testEvent = user.note("Test note");
    const bookmarkList = user.event({ kind: kinds.BookmarkList, tags: [["e", testEvent.id]] });
    events.add(bookmarkList);

    await hub.run(UnbookmarkEvent, testEvent);

    expect(publish).toBeCalledWith(
      expect.objectContaining({
        kind: kinds.BookmarkList,
        tags: expect.not.arrayContaining([["e", testEvent.id]]),
      }),
    );
  });

  it("should do nothing if bookmark set does not exist", async () => {
    const testEvent = user.note("Test note");
    await hub.run(UnbookmarkEvent, testEvent, "non-existent");

    expect(publish).not.toBeCalled();
  });

  it("should remove an event from an existing bookmark set", async () => {
    const testEvent = user.note("Test note");
    const bookmarkSet = user.list([
      ["d", "test-set"],
      ["e", testEvent.id],
    ]);
    events.add(bookmarkSet);

    await hub.run(UnbookmarkEvent, testEvent, "test-set");

    expect(publish).toBeCalledWith(
      expect.objectContaining({
        kind: kinds.Bookmarksets,
        tags: expect.not.arrayContaining([["e", testEvent.id]]),
      }),
    );
  });

  it("should remove an event from an existing bookmark set by event reference", async () => {
    const testEvent = user.note("Test note");
    const bookmarkSet = user.list([["e", testEvent.id]]);
    events.add(bookmarkSet);

    await hub.run(UnbookmarkEvent, testEvent, bookmarkSet);

    expect(publish).toBeCalledWith(
      expect.objectContaining({
        kind: kinds.Bookmarksets,
        tags: expect.not.arrayContaining([["e", testEvent.id]]),
      }),
    );
  });

  it("should throw if provided event is not a bookmark list or set", async () => {
    const testEvent = user.note("Test note");
    const wrongEvent = user.note("Wrong event");

    await expect(hub.run(UnbookmarkEvent, testEvent, wrongEvent)).rejects.toThrow(
      "Event kind 1 is not a bookmark list or bookmark set",
    );
    expect(publish).not.toBeCalled();
  });
});
