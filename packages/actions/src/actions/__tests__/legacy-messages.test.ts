import { EventStore } from "applesauce-core";
import { kinds, NostrEvent } from "applesauce-core/helpers/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeUser } from "../../__tests__/fake-user.js";
import { ActionRunner } from "../../action-runner.js";
import { ReplyToLegacyMessage } from "../legacy-messages.js";

const bob = new FakeUser();
const alice = new FakeUser();
const bobRelays = ["wss://bob-relay.com/"];
const aliceRelays = ["wss://alice-relay.com/"];

let events: EventStore;
let publish: ReturnType<typeof vi.fn<(event: NostrEvent, relays?: string[]) => Promise<void>>>;
let hub: ActionRunner;

beforeEach(() => {
  events = new EventStore();
  publish = vi.fn(async () => {});
  hub = new ActionRunner(events, bob, publish);

  events.add(bob.event({ kind: kinds.DirectMessageRelaysList, tags: bobRelays.map((r) => ["relay", r]) }));
  events.add(alice.event({ kind: kinds.DirectMessageRelaysList, tags: aliceRelays.map((r) => ["relay", r]) }));
});

describe("ReplyToLegacyMessage", () => {
  it("should publish a reply to a received message to the sender's inboxes", async () => {
    const parent = alice.event({ kind: kinds.EncryptedDirectMessage, tags: [["p", bob.pubkey]] });
    await hub.run(ReplyToLegacyMessage, parent, "hi");

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ tags: expect.arrayContaining([["p", alice.pubkey]]) }),
      aliceRelays,
    );
  });

  it("should publish a reply to our own message to the recipient's inboxes", async () => {
    const parent = bob.event({ kind: kinds.EncryptedDirectMessage, tags: [["p", alice.pubkey]] });
    await hub.run(ReplyToLegacyMessage, parent, "following up");

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ tags: expect.arrayContaining([["p", alice.pubkey]]) }),
      aliceRelays,
    );
  });
});
