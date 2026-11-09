import { kinds } from "applesauce-core/helpers/event";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { LegacyMessageFactory } from "../legacy-message.js";

const sender = new FakeUser();
const recipient = new FakeUser();

describe("LegacyMessageFactory", () => {
  it.each([false, true])("tags plaintext emojis before encrypting (reply: %s)", async (reply) => {
    const emoji = { shortcode: "wave", url: "https://example.com/wave.png" };
    const content = `:wave: :unknown: nostr:${"3".repeat(64)}`;
    const options = { emojis: [emoji, { shortcode: "unused", url: "https://example.com/unused.png" }] };
    const parent = await LegacyMessageFactory.create(sender.pubkey, "hi").sign(recipient);
    const factory = reply
      ? LegacyMessageFactory.reply(parent, recipient.pubkey, content, options)
      : LegacyMessageFactory.create(recipient.pubkey, content, options);
    const event = await factory.sign(sender);

    expect(event.content).not.toBe(content);
    expect(await recipient.nip04!.decrypt(sender.pubkey, event.content)).toBe(content);
    expect(event.tags.filter((tag) => tag[0] === "emoji")).toEqual([["emoji", emoji.shortcode, emoji.url]]);
    expect(event.tags.filter((tag) => tag[0] === "p")).toEqual([["p", recipient.pubkey]]);
    if (reply) expect(event.tags).toContainEqual(["e", parent.id]);
  });

  it("addresses a new message to the recipient", async () => {
    const event = await LegacyMessageFactory.create(recipient.pubkey, "hello").sign(sender);

    expect(event.kind).toBe(kinds.EncryptedDirectMessage);
    expect(event.tags).toEqual([["p", recipient.pubkey]]);
    expect(await recipient.nip04!.decrypt(sender.pubkey, event.content)).toBe("hello");
  });

  it("addresses a reply to the recipient and references the parent", async () => {
    const parent = await LegacyMessageFactory.create(sender.pubkey, "hi").sign(recipient);
    const event = await LegacyMessageFactory.reply(parent, recipient.pubkey, "hello").sign(sender);

    expect(event.tags).toEqual([
      ["p", recipient.pubkey],
      ["e", parent.id],
    ]);
  });
});
