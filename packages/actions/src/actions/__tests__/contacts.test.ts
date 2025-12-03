import { describe, it, expect, beforeEach, vitest } from "vitest";
import { FakeUser } from "../../__tests__/fake-user.js";
import { EventFactory } from "applesauce-core";
import { EventStore } from "applesauce-core";
import { ActionHub } from "../../action-hub.js";
import { FollowUser, NewContacts, UnfollowUser } from "../contacts.js";

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

describe("FollowUser", () => {
  it("should create a new contacts event if one does not exist", async () => {
    // don't add any events to the store
    await hub.run(FollowUser, user.pubkey);

    expect(publish).toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ kind: 3, tags: [["p", user.pubkey]] }));
  });

  it('should publish an event with a new "p" tag', async () => {
    events.add(user.contacts());

    await hub.run(FollowUser, user.pubkey);

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ tags: expect.arrayContaining([["p", user.pubkey]]) }),
    );
  });
});

describe("UnfollowUser", () => {
  it("should yield nothing if contacts does not exist", async () => {
    // don't add any events to the store
    await hub.run(UnfollowUser, user.pubkey);

    expect(publish).not.toBeCalled();
  });

  it('should publish an event with a new "p" tag', async () => {
    events.add(user.contacts([user.pubkey]));

    await hub.run(UnfollowUser, user.pubkey);

    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ kind: 3, tags: [] }));
  });
});

describe("NewContacts", () => {
  it("should throw if contact list already exists", async () => {
    events.add(user.contacts([user.pubkey]));
    await expect(hub.run(NewContacts, [])).rejects.toThrow();
    expect(publish).not.toBeCalled();
  });

  it("should publish a new contact event with pubkeys", async () => {
    await hub.run(NewContacts, [user.pubkey]);

    expect(publish).toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 3, tags: expect.arrayContaining([["p", user.pubkey]]) }),
    );
  });
});
