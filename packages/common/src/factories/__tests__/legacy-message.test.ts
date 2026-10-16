import { kinds } from "applesauce-core/helpers/event";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { LegacyMessageFactory } from "../legacy-message.js";

const sender = new FakeUser();
const recipient = new FakeUser();

describe("LegacyMessageFactory", () => {
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
