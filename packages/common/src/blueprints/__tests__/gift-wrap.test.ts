import { EventFactory } from "applesauce-core/event-factory";
import { NostrEvent } from "applesauce-core/helpers/event";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { GiftWrapBlueprint } from "../gift-wrap.js";
import { getGiftWrapRumor, getGiftWrapSeal, isGiftWrapUnlocked } from "../../helpers/gift-wrap.js";
import { NoteBlueprint } from "../note.js";
import { WrappedMessageBlueprint } from "../wrapped-message.js";

const bob = new FakeUser();
const alice = new FakeUser();
const factory = new EventFactory({ signer: bob });

describe("GiftWrapBlueprint", () => {
  it("should create a gift wrap event", async () => {
    const giftwrap = await factory.create(GiftWrapBlueprint, alice.pubkey, NoteBlueprint("hello world"));

    expect(giftwrap.pubkey).not.toBe(bob.pubkey);
    const seal = JSON.parse(await alice.nip44.decrypt(giftwrap.pubkey, giftwrap.content)) as NostrEvent;

    expect(seal.pubkey).toBe(bob.pubkey);
    const rumor = JSON.parse(await alice.nip44.decrypt(seal.pubkey, seal.content)) as NostrEvent;

    expect(rumor).toEqual({
      id: expect.any(String),
      kind: 1,
      content: "hello world",
      pubkey: bob.pubkey,
      tags: [],
      created_at: expect.any(Number),
    });
  });

  it("should include single p tag for address", async () => {
    const event = await factory.create(GiftWrapBlueprint, alice.pubkey, NoteBlueprint("hello world"));

    expect(event.tags).toEqual([["p", alice.pubkey]]);
  });

  it("should preserve the unencrypted content", async () => {
    const event = await factory.create(
      GiftWrapBlueprint,
      alice.pubkey,
      WrappedMessageBlueprint(alice.pubkey, "hello world"),
    );

    expect(isGiftWrapUnlocked(event)).toBe(true);
    expect(getGiftWrapSeal(event)).toBeDefined();
    expect(getGiftWrapRumor(event)).toBeDefined();
    expect(getGiftWrapRumor(event)?.content).toBe("hello world");
  });
});
