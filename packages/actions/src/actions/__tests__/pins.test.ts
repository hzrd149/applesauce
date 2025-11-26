import { beforeEach, describe, expect, it, vitest } from "vitest";
import { EventStore } from "applesauce-core";
import { EventFactory } from "applesauce-core";
import { kinds } from "nostr-tools";

import { FakeUser } from "../../__tests__/fake-user.js";
import { ActionHub } from "../../action-hub.js";
import { PinNote, UnpinNote, CreatePinList, ALLOWED_PIN_KINDS } from "../pins.js";
import { getReplaceableAddress } from "applesauce-core/helpers";

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

describe("CreatePinList", () => {
  it("should publish a kind 10001 pin list", async () => {
    await hub.run(CreatePinList);

    expect(publish).toBeCalledWith(expect.objectContaining({ kind: kinds.Pinlist }));
  });

  it("should publish a pin list with initial pins", async () => {
    const testEvent = user.note("Test note");
    await hub.run(CreatePinList, [testEvent]);

    expect(publish).toBeCalledWith(
      expect.objectContaining({
        kind: kinds.Pinlist,
        tags: expect.arrayContaining([["e", testEvent.id]]),
      }),
    );
  });

  it("should throw if pin list already exists", async () => {
    // Create a pin list first
    events.add(user.event({ kind: kinds.Pinlist }));

    await expect(hub.run(CreatePinList)).rejects.toThrow("Pin list already exists");
    expect(publish).not.toBeCalled();
  });
});

describe("PinNote", () => {
  it("should create a new pin list when none exists", async () => {
    const testEvent = user.note("Test note");
    await hub.run(PinNote, testEvent);

    expect(publish).toBeCalledWith(
      expect.objectContaining({
        kind: kinds.Pinlist,
        tags: expect.arrayContaining([["e", testEvent.id]]),
      }),
    );
  });

  it("should add an event to an existing pin list", async () => {
    const pinList = user.event({ kind: kinds.Pinlist });
    events.add(pinList);

    const testEvent = user.note("Test note");
    await hub.run(PinNote, testEvent);

    expect(publish).toBeCalledWith(
      expect.objectContaining({
        kind: kinds.Pinlist,
        tags: expect.arrayContaining([["e", testEvent.id]]),
      }),
    );
  });

  it("should pin a long-form article", async () => {
    const pinList = user.event({ kind: kinds.Pinlist });
    events.add(pinList);

    const testEvent = user.event({
      kind: kinds.LongFormArticle,
      content: "Test article",
      tags: [["d", "test-article"]],
    });
    await hub.run(PinNote, testEvent);

    expect(publish).toBeCalledWith(
      expect.objectContaining({
        kind: kinds.Pinlist,
        tags: expect.arrayContaining([["a", getReplaceableAddress(testEvent)]]),
      }),
    );
  });

  it("should throw for disallowed event kinds", async () => {
    const testEvent = user.event({ kind: kinds.Metadata, content: "Test metadata" });

    await expect(hub.run(PinNote, testEvent)).rejects.toThrow("Event kind 0 can not be pinned");
    expect(publish).not.toBeCalled();
  });
});

describe("UnpinNote", () => {
  it("should do nothing if pin list does not exist", async () => {
    const testEvent = user.note("Test note");
    await hub.run(UnpinNote, testEvent);

    expect(publish).not.toBeCalled();
  });

  it("should remove a replaceable event from an existing pin list", async () => {
    const testEvent = user.event({
      kind: kinds.LongFormArticle,
      content: "Test article",
      tags: [["d", "test-article"]],
    });
    const pinList = user.event({ kind: kinds.Pinlist, tags: [["a", getReplaceableAddress(testEvent)]] });
    events.add(pinList);

    await hub.run(UnpinNote, testEvent);

    expect(publish).toBeCalledWith(
      expect.objectContaining({
        kind: kinds.Pinlist,
        tags: expect.not.arrayContaining([["e", testEvent.id]]),
      }),
    );
  });
});
