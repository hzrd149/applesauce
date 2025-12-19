import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { getGiftWrapRumor, getGiftWrapSeal, isGiftWrapUnlocked } from "applesauce-common/helpers/gift-wrap";
import { EventFactory, EventStore } from "applesauce-core";
import { kinds } from "applesauce-core/helpers/event";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fake-user.js";
import { ActionHub } from "../../action-hub.js";
import { SendWrappedMessage } from "../wrapped-messages.js";

const bob = new FakeUser();
const alice = new FakeUser();
const carol = new FakeUser();
let factory: EventFactory;
let hub: ActionHub;
let events: EventStore;

beforeEach(() => {
  events = new EventStore();
  factory = new EventFactory({ signer: bob });
  hub = new ActionHub(events, factory);

  events.add(bob.event({ kind: kinds.DirectMessageRelaysList, tags: [["r", "wss://relay.example.com/"]] }));
  events.add(alice.event({ kind: kinds.DirectMessageRelaysList, tags: [["r", "wss://relay.example.com/"]] }));
  events.add(carol.event({ kind: kinds.DirectMessageRelaysList, tags: [["r", "wss://relay.example.com/"]] }));
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
    const hub = new ActionHub(events, factory);

    const spy = subscribeSpyTo(hub.exec(SendWrappedMessage, alice.pubkey, "hello world"), { expectErrors: true });
    await spy.onError();

    expect(spy.receivedError()).toBeTruthy();
  });
});
