import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { WrappedMessageBlueprint } from "applesauce-common/blueprints";
import { getGiftWrapRumor, getGiftWrapSeal, isGiftWrapUnlocked } from "applesauce-common/helpers/gift-wrap";
import { EventFactory, EventStore } from "applesauce-core";
import { getTagValue, kinds } from "applesauce-core/helpers/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeUser } from "../../__tests__/fake-user.js";
import { ActionRunner } from "../../action-runner.js";
import { GiftWrapMessageToParticipants, SendWrappedMessage } from "../wrapped-messages.js";

const bob = new FakeUser();
const alice = new FakeUser();
const carol = new FakeUser();
let factory: EventFactory;
let hub: ActionRunner;
let events: EventStore;

// Setup: Create two users with different relay lists
const aliceRelays = ["wss://alice-relay1.com/", "wss://alice-relay2.com/"];
const carolRelays = ["wss://carol-relay1.com/", "wss://carol-relay2.com/"];
const bobRelays = ["wss://bob-relay1.com/"];

beforeEach(() => {
  events = new EventStore();
  factory = new EventFactory({ signer: bob });
  hub = new ActionRunner(events, factory);

  // Setup profiles
  events.add(bob.profile({ name: "Bob" }));
  events.add(alice.profile({ name: "Alice" }));
  events.add(carol.profile({ name: "Carol" }));

  // Setup relay lists
  events.add(bob.event({ kind: kinds.DirectMessageRelaysList, tags: bobRelays.map((r) => ["relay", r]) }));
  events.add(alice.event({ kind: kinds.DirectMessageRelaysList, tags: aliceRelays.map((r) => ["relay", r]) }));
  events.add(carol.event({ kind: kinds.DirectMessageRelaysList, tags: carolRelays.map((r) => ["relay", r]) }));
});

describe("SendWrappedMessage", () => {
  it("should create a gift wrap for each participant", async () => {
    const spy = subscribeSpyTo(hub.exec(SendWrappedMessage, alice.pubkey, "hello world"), { expectErrors: false });
    await spy.onComplete();

    expect(spy.getValuesLength()).toBe(2);
    expect(spy.getValues()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: kinds.GiftWrap, tags: expect.arrayContaining([["p", bob.pubkey]]) }),
        expect.objectContaining({ kind: kinds.GiftWrap, tags: expect.arrayContaining([["p", alice.pubkey]]) }),
      ]),
    );
  });

  it("should create a gift wrap for each participant in a group conversation", async () => {
    const spy = subscribeSpyTo(hub.exec(SendWrappedMessage, [alice.pubkey, bob.pubkey, carol.pubkey], "hello world"), {
      expectErrors: false,
    });
    await spy.onComplete();

    expect(spy.getValuesLength()).toBe(3);
    expect(spy.getValues()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: kinds.GiftWrap, tags: expect.arrayContaining([["p", alice.pubkey]]) }),
        expect.objectContaining({ kind: kinds.GiftWrap, tags: expect.arrayContaining([["p", bob.pubkey]]) }),
        expect.objectContaining({ kind: kinds.GiftWrap, tags: expect.arrayContaining([["p", carol.pubkey]]) }),
      ]),
    );
  });

  it("should preserve the unencrypted content", async () => {
    const spy = subscribeSpyTo(hub.exec(SendWrappedMessage, alice.pubkey, "hello world"), { expectErrors: false });
    await spy.onComplete();

    for (const gift of spy.getValues()) {
      expect(isGiftWrapUnlocked(gift)).toBe(true);
      expect(getGiftWrapSeal(gift)).toBeDefined();
      expect(getGiftWrapRumor(gift)).toBeDefined();
    }
  });

  it("should throw error when no signer is provided", async () => {
    const factory = new EventFactory();
    const hub = new ActionRunner(events, factory);

    const spy = subscribeSpyTo(hub.exec(SendWrappedMessage, alice.pubkey, "hello world"), { expectErrors: true });
    await spy.onError();

    expect(spy.receivedError()).toBeTruthy();
  });
});

describe("GiftWrapMessageToParticipants", () => {
  it("should publish gift wraps to each user's kind 10050 relay lists", async () => {
    // Mock the publish function to track which events are published to which relays
    const publishMock = vi.fn().mockResolvedValue(undefined);
    const hubWithPublish = new ActionRunner(events, factory, publishMock);

    // Create a rumor message to alice and carol
    const rumor = await factory.create(WrappedMessageBlueprint, [alice.pubkey, carol.pubkey], "hello world");

    // Execute the action
    await hubWithPublish.run(GiftWrapMessageToParticipants, rumor);

    // Verify publish was called 3 times (for bob, alice, and carol)
    expect(publishMock).toHaveBeenCalledTimes(3);

    // Track which pubkeys were sent to which relays
    const publishedEvents = publishMock.mock.calls.map((call) => ({
      event: call[0],
      relays: call[1],
    }));

    // Verify each participant received a gift wrap
    const bobGiftWrap = publishedEvents.find((p) => getTagValue(p.event, "p") === bob.pubkey);
    const aliceGiftWrap = publishedEvents.find((p) => getTagValue(p.event, "p") === alice.pubkey);
    const carolGiftWrap = publishedEvents.find((p) => getTagValue(p.event, "p") === carol.pubkey);

    expect(bobGiftWrap).toBeDefined();
    expect(aliceGiftWrap).toBeDefined();
    expect(carolGiftWrap).toBeDefined();

    // Verify each gift wrap was published to the correct relay list
    expect(bobGiftWrap?.relays).toEqual(bobRelays);
    expect(aliceGiftWrap?.relays).toEqual(aliceRelays);
    expect(carolGiftWrap?.relays).toEqual(carolRelays);

    // Verify all gift wraps are kind 1059
    expect(bobGiftWrap?.event.kind).toBe(kinds.GiftWrap);
    expect(aliceGiftWrap?.event.kind).toBe(kinds.GiftWrap);
    expect(carolGiftWrap?.event.kind).toBe(kinds.GiftWrap);
  });
});
