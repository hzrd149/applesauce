import { User } from "applesauce-common/casts";
import { EventStore } from "applesauce-core";
import { kinds, NostrEvent } from "applesauce-core/helpers/event";
import { getHiddenTags, unlockHiddenTags } from "applesauce-core/helpers/hidden-tags";
import { beforeEach, describe, expect, it, vitest } from "vitest";
import { FakeUser } from "../../__tests__/fake-user.js";
import { ActionRunner } from "../../action-runner.js";
import {
  AddTrustedProvider,
  MoveTrustedProvider,
  RemoveTrustedProvider,
  RemoveTrustedService,
  SetTrustedProvider,
} from "../trusted-providers.js";

const user = new FakeUser();
const A = "a".repeat(64);
const B = "b".repeat(64);
const rank = { kind: 30382, tag: "rank", servicePubkey: A };

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

describe("AddTrustedProvider", () => {
  it("creates a new list and publishes to the outboxes", async () => {
    await hub.run(AddTrustedProvider, { ...rank, relay: "wss://wot.example.com" });

    expect(publish).toBeCalledWith(
      expect.objectContaining({ kind: 10040, tags: [["30382:rank", A, "wss://wot.example.com"]] }),
      ["wss://relay.example.com/"],
    );
  });

  it("adds a private provider", async () => {
    await hub.run(AddTrustedProvider, rank, true);

    const event = lastPublished();
    expect(event.tags).toEqual([]);
    await unlockHiddenTags(event, user);
    expect(getHiddenTags(event)).toEqual([["30382:rank", A]]);
  });
});

describe("RemoveTrustedProvider", () => {
  it("removes a provider from the list", async () => {
    await hub.run(AddTrustedProvider, [rank, { ...rank, tag: "followers" }]);
    await hub.run(RemoveTrustedProvider, rank);

    expect(lastPublished().tags).toEqual([["30382:followers", A]]);
  });
});

describe("SetTrustedProvider", () => {
  it("replaces the providers in a slot", async () => {
    await hub.run(AddTrustedProvider, rank);
    await hub.run(SetTrustedProvider, { ...rank, servicePubkey: B });

    expect(lastPublished().tags).toEqual([["30382:rank", B]]);
  });
});

describe("RemoveTrustedService", () => {
  it("removes a service from public and private slots", async () => {
    await hub.run(AddTrustedProvider, [rank, { ...rank, servicePubkey: B, tag: "followers" }]);
    await hub.run(AddTrustedProvider, { ...rank, kind: 30383 }, true);
    await hub.run(RemoveTrustedService, A);

    const event = lastPublished();
    expect(event.tags).toEqual([["30382:followers", B]]);
    await unlockHiddenTags(event, user);
    expect(getHiddenTags(event)).toEqual([]);
  });
});

describe("MoveTrustedProvider", () => {
  it("moves a public provider into the private tags", async () => {
    await hub.run(AddTrustedProvider, rank);
    await hub.run(MoveTrustedProvider, rank, true);

    const event = lastPublished();
    expect(event.tags).toEqual([]);
    await unlockHiddenTags(event, user);
    expect(getHiddenTags(event)).toEqual([["30382:rank", A]]);
  });
});
