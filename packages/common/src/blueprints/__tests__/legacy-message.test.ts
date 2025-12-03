import { EventFactory } from "applesauce-core/event-factory";
import { kinds } from "applesauce-core/helpers/event";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { LegacyMessageBlueprint, LegacyMessageReplyBlueprint } from "../legacy-message.js";

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

describe("LegacyMessageBlueprint", () => {
  it("should create an encrypted direct message", async () => {
    const message = "Hello Bob!";
    const event = await factory.create(LegacyMessageBlueprint, bob.pubkey, message);

    expect(event).toEqual(
      expect.objectContaining({
        kind: kinds.EncryptedDirectMessage,
        tags: expect.arrayContaining([["p", bob.pubkey]]),
      }),
    );

    // Content should be encrypted, not plaintext
    expect(event.content).not.toBe(message);
    expect(event.content).toBeTruthy();
    expect(event.content.length).toBeGreaterThan(0);
  });

  it("should include recipient in p tag", async () => {
    const message = "Test message";
    const event = await factory.create(LegacyMessageBlueprint, bob.pubkey, message);

    const pTags = event.tags.filter(([name]) => name === "p");
    expect(pTags).toHaveLength(1);
    expect(pTags[0][1]).toBe(bob.pubkey);
  });

  it("should create a legacy message with protected flag", async () => {
    const message = "Protected message";
    const event = await factory.create(LegacyMessageBlueprint, bob.pubkey, message, { protected: true });

    expect(event).toEqual(
      expect.objectContaining({
        kind: kinds.EncryptedDirectMessage,
        tags: expect.arrayContaining([["p", bob.pubkey], ["-"]]),
      }),
    );
  });

  it("should create a legacy message with expiration", async () => {
    const message = "Expiring message";
    const expiration = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    const event = await factory.create(LegacyMessageBlueprint, bob.pubkey, message, { expiration });

    expect(event).toEqual(
      expect.objectContaining({
        kind: kinds.EncryptedDirectMessage,
        tags: expect.arrayContaining([
          ["p", bob.pubkey],
          ["expiration", expiration.toString()],
        ]),
      }),
    );
  });

  it("should create a legacy message with multiple meta tags", async () => {
    const message = "Complex message";
    const expiration = Math.floor(Date.now() / 1000) + 3600;
    const event = await factory.create(LegacyMessageBlueprint, bob.pubkey, message, {
      protected: true,
      expiration,
    });

    expect(event).toEqual(
      expect.objectContaining({
        kind: kinds.EncryptedDirectMessage,
        tags: expect.arrayContaining([["p", bob.pubkey], ["-"], ["expiration", expiration.toString()]]),
      }),
    );
  });

  it("should throw error when no signer is provided", async () => {
    const factoryWithoutSigner = new EventFactory();

    await expect(factoryWithoutSigner.create(LegacyMessageBlueprint, bob.pubkey, "test message")).rejects.toThrow(
      "Signer required for encrypted content",
    );
  });
});

describe("LegacyMessageReplyBlueprint", () => {
  let parentMessage: any;

  beforeEach(async () => {
    // Create a parent message from Bob to Alice and sign it
    const bobFactory = new EventFactory({ signer: bob });
    const template = await bobFactory.create(LegacyMessageBlueprint, alice.pubkey, "Original message");
    parentMessage = await bobFactory.sign(template);
  });

  it("should create a reply to a legacy message", async () => {
    const replyMessage = "Thanks for your message!";
    const reply = await factory.create(LegacyMessageReplyBlueprint, parentMessage, replyMessage);

    expect(reply).toEqual(
      expect.objectContaining({
        kind: kinds.EncryptedDirectMessage,
        tags: expect.arrayContaining([
          ["p", bob.pubkey],
          ["e", parentMessage.id],
        ]),
      }),
    );

    // Content should be encrypted
    expect(reply.content).not.toBe(replyMessage);
    expect(reply.content).toBeTruthy();
  });

  it("should create a reply with protected flag", async () => {
    const replyMessage = "Protected reply";
    const reply = await factory.create(LegacyMessageReplyBlueprint, parentMessage, replyMessage, { protected: true });

    expect(reply).toEqual(
      expect.objectContaining({
        kind: kinds.EncryptedDirectMessage,
        tags: expect.arrayContaining([["p", bob.pubkey], ["e", parentMessage.id], ["-"]]),
      }),
    );
  });

  it("should create a reply with expiration", async () => {
    const replyMessage = "Expiring reply";
    const expiration = Math.floor(Date.now() / 1000) + 1800; // 30 minutes from now
    const reply = await factory.create(LegacyMessageReplyBlueprint, parentMessage, replyMessage, { expiration });

    expect(reply).toEqual(
      expect.objectContaining({
        kind: kinds.EncryptedDirectMessage,
        tags: expect.arrayContaining([
          ["p", bob.pubkey],
          ["e", parentMessage.id],
          ["expiration", expiration.toString()],
        ]),
      }),
    );
  });

  it("should include both parent reference and recipient", async () => {
    const replyMessage = "Reply with both tags";
    const reply = await factory.create(LegacyMessageReplyBlueprint, parentMessage, replyMessage);

    const pTags = reply.tags.filter(([name]) => name === "p");
    const eTags = reply.tags.filter(([name]) => name === "e");

    expect(pTags).toHaveLength(1);
    expect(eTags).toHaveLength(1);
    expect(pTags[0][1]).toBe(bob.pubkey);
    expect(eTags[0][1]).toBe(parentMessage.id);
  });

  it("should encrypt content to parent message author", async () => {
    const replyMessage = "Encrypted to parent author";
    const reply = await factory.create(LegacyMessageReplyBlueprint, parentMessage, replyMessage);

    // The recipient should be the parent message author (bob)
    expect(reply.tags.find(([name, value]) => name === "p" && value === bob.pubkey)).toBeDefined();

    // Content should be encrypted
    expect(reply.content).not.toBe(replyMessage);
    expect(reply.content).toBeTruthy();
  });

  it("should throw error when no signer is provided", async () => {
    const factoryWithoutSigner = new EventFactory();

    await expect(
      factoryWithoutSigner.create(LegacyMessageReplyBlueprint, parentMessage, "test message"),
    ).rejects.toThrow("Signer required for encrypted content");
  });

  it("should throw when replying to non-legacy message", async () => {
    const event = bob.note("hello world");
    await expect(() => factory.create(LegacyMessageReplyBlueprint, event, "yes")).rejects.toThrow(
      "Parent message must be a legacy message (kind 4)",
    );
  });
});
