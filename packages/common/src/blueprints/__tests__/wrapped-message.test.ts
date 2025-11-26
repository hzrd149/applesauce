import { getConversationParticipants, Rumor } from "applesauce-core/helpers";
import { kinds } from "nostr-tools";
import { beforeEach, describe, expect, it } from "vitest";

import { FakeUser } from "../../__tests__/fake-user.js";
import { EventFactory } from "../../event-factory.js";
import { WrappedMessageBlueprint, WrappedMessageReplyBlueprint } from "../wrapped-messages.js";

let alice: FakeUser;
let bob: FakeUser;
let carol: FakeUser;
let factory: EventFactory;

beforeEach(() => {
  alice = new FakeUser();
  bob = new FakeUser();
  carol = new FakeUser();
  factory = new EventFactory({ signer: alice });
});

describe("WrappedMessageBlueprint", () => {
  it("should create a wrapped message to a single participant", async () => {
    const message = "Hello Bob!";
    const rumor = await factory.create(WrappedMessageBlueprint, bob.pubkey, message);

    expect(rumor).toEqual(
      expect.objectContaining({
        kind: kinds.PrivateDirectMessage,
        content: message,
        pubkey: alice.pubkey,
        tags: expect.arrayContaining([["p", bob.pubkey]]),
      }),
    );

    // Should not include sender's pubkey in p tags
    expect(rumor.tags.filter(([name]) => name === "p")).toHaveLength(1);
    expect(rumor.tags.find(([name, value]) => name === "p" && value === alice.pubkey)).toBeUndefined();
  });

  it("should create a wrapped message to multiple participants", async () => {
    const message = "Hello everyone!";
    const participants = [bob.pubkey, carol.pubkey];
    const rumor = await factory.create(WrappedMessageBlueprint, participants, message);

    expect(rumor).toEqual(
      expect.objectContaining({
        kind: kinds.PrivateDirectMessage,
        content: message,
        pubkey: alice.pubkey,
        tags: expect.arrayContaining([
          ["p", bob.pubkey],
          ["p", carol.pubkey],
        ]),
      }),
    );

    // Should not include sender's pubkey in p tags
    expect(rumor.tags.filter(([name]) => name === "p")).toHaveLength(2);
    expect(rumor.tags.find(([name, value]) => name === "p" && value === alice.pubkey)).toBeUndefined();
  });

  it("should create a wrapped message with a subject", async () => {
    const message = "Meeting tomorrow";
    const subject = "Team Meeting";
    const rumor = await factory.create(WrappedMessageBlueprint, bob.pubkey, message, { subject });

    expect(rumor).toEqual(
      expect.objectContaining({
        kind: kinds.PrivateDirectMessage,
        content: message,
        pubkey: alice.pubkey,
        tags: expect.arrayContaining([
          ["p", bob.pubkey],
          ["subject", subject],
        ]),
      }),
    );
  });

  it("should handle conversation identifier format", async () => {
    const message = "Group message";
    const conversationId = `${alice.pubkey}:${bob.pubkey}:${carol.pubkey}`;
    const rumor = await factory.create(WrappedMessageBlueprint, conversationId, message);

    const participants = getConversationParticipants(rumor);
    expect(participants).toContain(alice.pubkey);
    expect(participants).toContain(bob.pubkey);
    expect(participants).toContain(carol.pubkey);

    // Should not include sender's pubkey in p tags
    expect(rumor.tags.filter(([name]) => name === "p")).toHaveLength(2);
    expect(rumor.tags.find(([name, value]) => name === "p" && value === alice.pubkey)).toBeUndefined();
  });

  it("should create a rumor (unsigned event)", async () => {
    const message = "Test message";
    const rumor = await factory.create(WrappedMessageBlueprint, bob.pubkey, message);

    // Rumor should not have a signature
    expect(Reflect.get(rumor, "sig")).toBeUndefined();
    expect(rumor.id).toBeDefined();
  });

  it('should not include "p" tags for mentioned pubkeys', async () => {
    const message = "Hello @npub1qz4fuw033m6hnwfl0gjq5awalx8v46zc94fx52jry59x6yp4yu0s4c59cf!";
    const rumor = await factory.create(WrappedMessageBlueprint, bob.pubkey, message);

    expect(
      rumor.tags.some(
        (t) => t[0] === "p" && t[1] === "00aa9e39f18ef579b93f7a240a75ddf98ecae8582d526a2a43250a6d1035271f",
      ),
    ).toBe(false);
  });

  it("should throw error when no signer is provided", async () => {
    const factoryWithoutSigner = new EventFactory();

    await expect(factoryWithoutSigner.create(WrappedMessageBlueprint, bob.pubkey, "test message")).rejects.toThrow(
      "Missing signer",
    );
  });
});

describe("WrappedMessageReplyBlueprint", () => {
  let parentRumor: Rumor;

  beforeEach(async () => {
    // Create a parent message from Bob to Alice
    const bobFactory = new EventFactory({ signer: bob });
    parentRumor = await bobFactory.create(WrappedMessageBlueprint, alice.pubkey, "Original message");
  });

  it("should create a reply to a wrapped message", async () => {
    const replyMessage = "Thanks for your message!";
    const reply = await factory.create(WrappedMessageReplyBlueprint, parentRumor, replyMessage);

    expect(reply).toEqual(
      expect.objectContaining({
        kind: kinds.PrivateDirectMessage,
        content: replyMessage,
        pubkey: alice.pubkey,
        tags: expect.arrayContaining([
          ["p", bob.pubkey],
          ["e", parentRumor.id],
        ]),
      }),
    );
  });

  it("should create a reply with a subject", async () => {
    const replyMessage = "Re: your question";
    const subject = "Re: Important topic";
    const reply = await factory.create(WrappedMessageReplyBlueprint, parentRumor, replyMessage, { subject });

    expect(reply).toEqual(
      expect.objectContaining({
        kind: kinds.PrivateDirectMessage,
        content: replyMessage,
        pubkey: alice.pubkey,
        tags: expect.arrayContaining([
          ["p", bob.pubkey],
          ["e", parentRumor.id],
          ["subject", subject],
        ]),
      }),
    );
  });

  it("should preserve conversation participants in reply", async () => {
    // Create a group message from Bob to Alice and Carol
    const bobFactory = new EventFactory({ signer: bob });
    const groupParent = await bobFactory.create(WrappedMessageBlueprint, [alice.pubkey, carol.pubkey], "Group message");

    const replyMessage = "Reply to group";
    const reply = await factory.create(WrappedMessageReplyBlueprint, groupParent, replyMessage);

    const replyParticipants = getConversationParticipants(reply);
    const parentParticipants = getConversationParticipants(groupParent);

    expect(replyParticipants).toEqual(expect.arrayContaining(parentParticipants));
    expect(reply.tags).toEqual(
      expect.arrayContaining([
        ["p", carol.pubkey], // Other participants (excluding sender)
        ["e", groupParent.id],
      ]),
    );
  });

  it("should throw error when replying to non-private message", async () => {
    const invalidParent = alice.note("Not a private message");

    await expect(factory.create(WrappedMessageReplyBlueprint, invalidParent as any, "reply")).rejects.toThrow(
      "Parent must be a wrapped message event (kind 14)",
    );
  });
});
