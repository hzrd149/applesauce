import { User } from "applesauce-common/casts";
import { NappletHandlersFactory } from "applesauce-common/factories";
import { EventStore } from "applesauce-core";
import { kinds, NostrEvent } from "applesauce-core/helpers/event";
import { getHiddenTags, lockHiddenTags, unlockHiddenTags } from "applesauce-core/helpers/hidden-tags";
import { beforeEach, describe, expect, it, vitest } from "vitest";
import { FakeUser } from "../../__tests__/fake-user.js";
import { ActionRunner } from "../../action-runner.js";
import {
  AddNappletHandler,
  AddNappletIntentHandler,
  ClearNappletHandlers,
  RemoveNappletHandler,
  RemoveNappletIntentHandler,
  SetNappletHandler,
  SetNappletIntentHandler,
} from "../napplet-handlers.js";

const user = new FakeUser();
const dev = "d".repeat(64);
const EDITOR = `35129:${dev}:editor`;
const VIEWER = `35129:${dev}:viewer`;
const EDIT = "napplet:profile/edit";

let events: EventStore;
let publish: ReturnType<typeof vitest.fn>;
let hub: ActionRunner;
beforeEach(async () => {
  events = new EventStore();
  publish = vitest.fn().mockImplementation(async (event: NostrEvent) => {
    events.add(event);
  });
  hub = new ActionRunner(events, user, publish);
  User.cache.clear();

  events.add(user.event({ kind: kinds.RelayList, tags: [["r", "wss://relay.example.com/"]] }));
});

function lastPublished(): NostrEvent {
  return publish.mock.calls[publish.mock.calls.length - 1][0];
}

/** Adds existing preferences to the store with the private entries locked */
async function existing(factory: NappletHandlersFactory) {
  const event = await factory.sign(user);
  lockHiddenTags(event);
  events.add(event);
}

async function hiddenTags(event: NostrEvent) {
  await unlockHiddenTags(event, user);
  return getHiddenTags(event);
}

describe("AddNappletHandler", () => {
  it("creates preferences and publishes to the outboxes", async () => {
    await hub.run(AddNappletHandler, "profile", VIEWER);

    expect(publish).toBeCalledWith(
      expect.objectContaining({
        kind: 31129,
        tags: [
          ["d", "profile"],
          ["a", VIEWER],
        ],
      }),
      ["wss://relay.example.com/"],
    );
  });

  it("appends a fallback to existing preferences", async () => {
    await existing(NappletHandlersFactory.create("profile").handler(VIEWER));
    await hub.run(AddNappletHandler, "profile", EDITOR);

    expect(lastPublished().tags).toEqual([
      ["d", "profile"],
      ["a", VIEWER],
      ["a", EDITOR],
    ]);
  });
});

describe("SetNappletHandler", () => {
  it("prefers a handler and removes it from the private entries", async () => {
    await existing(NappletHandlersFactory.create("profile").handler(VIEWER).handler(EDITOR, true));
    await hub.run(SetNappletHandler, "profile", EDITOR);

    const event = lastPublished();
    expect(event.tags).toEqual([
      ["d", "profile"],
      ["a", EDITOR],
      ["a", VIEWER],
    ]);
    expect(await hiddenTags(event)).toEqual([]);
  });

  it("prefers a private handler and removes it from the public entries", async () => {
    await existing(NappletHandlersFactory.create("profile").handler(VIEWER));
    await hub.run(SetNappletHandler, "profile", VIEWER, true);

    const event = lastPublished();
    expect(event.tags).toEqual([["d", "profile"]]);
    expect(await hiddenTags(event)).toEqual([["a", VIEWER]]);
  });
});

describe("RemoveNappletHandler", () => {
  it("removes a handler from the public and private entries", async () => {
    await existing(NappletHandlersFactory.create("profile").handler(VIEWER).handler(VIEWER, true).handler(EDITOR));
    await hub.run(RemoveNappletHandler, "profile", VIEWER);

    const event = lastPublished();
    expect(event.tags).toEqual([
      ["d", "profile"],
      ["a", EDITOR],
    ]);
    expect(await hiddenTags(event)).toEqual([]);
  });

  it("does not add private content when there is none", async () => {
    await existing(NappletHandlersFactory.create("profile").handler(VIEWER));
    await hub.run(RemoveNappletHandler, "profile", VIEWER);

    expect(lastPublished().content).toBe("");
  });
});

describe("intent handler actions", () => {
  it("overrides one intent on top of the archetype default", async () => {
    await hub.run(SetNappletHandler, "profile", VIEWER);
    await hub.run(SetNappletIntentHandler, EDIT, EDITOR);

    expect(lastPublished().tags).toEqual([
      ["d", "profile"],
      ["a", VIEWER],
      ["i", EDIT, EDITOR],
    ]);
  });

  it("adds a fallback and keeps a private override private", async () => {
    await hub.run(AddNappletIntentHandler, EDIT, VIEWER);
    await hub.run(SetNappletIntentHandler, EDIT, EDITOR, true);

    const event = lastPublished();
    expect(event.tags).toEqual([
      ["d", "profile"],
      ["i", EDIT, VIEWER],
    ]);
    expect(await hiddenTags(event)).toEqual([["i", EDIT, EDITOR]]);
  });

  it("removes every handler for an intent from both groups", async () => {
    await existing(
      NappletHandlersFactory.create("profile")
        .handler(VIEWER)
        .intentHandler(EDIT, VIEWER)
        .intentHandler(EDIT, EDITOR, true),
    );
    await hub.run(RemoveNappletIntentHandler, EDIT);

    const event = lastPublished();
    expect(event.tags).toEqual([
      ["d", "profile"],
      ["a", VIEWER],
    ]);
    expect(await hiddenTags(event)).toEqual([]);
  });

  it("throws on an invalid identity", () => {
    expect(() => SetNappletIntentHandler("profile/edit", EDITOR)).toThrow();
  });
});

describe("ClearNappletHandlers", () => {
  it("publishes empty preferences", async () => {
    await existing(NappletHandlersFactory.create("profile").handler(VIEWER).handler(EDITOR, true));
    await hub.run(ClearNappletHandlers, "profile");

    const event = lastPublished();
    expect(event.tags).toEqual([["d", "profile"]]);
    expect(event.content).toBe("");
  });

  it("does nothing without existing preferences", async () => {
    await hub.run(ClearNappletHandlers, "profile");
    expect(publish).not.toHaveBeenCalled();
  });
});
