import { unixNow } from "applesauce-core/helpers";
import {
  getGiftWrapRumor,
  getGiftWrapSeal,
  getRumorGiftWraps,
  getRumorSeals,
  getSealGiftWrap,
} from "../../helpers/gift-wrap.js";
import { describe, expect, it } from "vitest";
import { kinds } from "applesauce-core/helpers/event";
import { FakeUser } from "../../__tests__/fixtures.js";
import { giftWrap, sealRumor, toRumor, wrapSeal } from "../gift-wrap.js";

const user = new FakeUser();
const other = new FakeUser();

describe("toRumor", () => {
  it("should strip signature from rumor", async () => {
    const event = user.event({ kind: kinds.PrivateDirectMessage, content: "test" });
    const rumor = await toRumor()(event);

    expect(rumor).toEqual(
      expect.objectContaining({
        id: event.id,
        kind: event.kind,
        pubkey: user.pubkey,
        content: event.content,
        tags: event.tags,
        created_at: event.created_at,
      }),
    );
  });

  it("should stamp rumor if its missing pubkey", async () => {
    const rumor = await toRumor(user)(user.event({ kind: kinds.PrivateDirectMessage }));

    expect(rumor).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        kind: rumor.kind,
        pubkey: user.pubkey,
        content: rumor.content,
        tags: rumor.tags,
        created_at: rumor.created_at,
      }),
    );
  });

  it("should throw an error if no signer is provided and missing pubkey", async () => {
    await expect(
      toRumor()({ kind: kinds.PrivateDirectMessage, tags: [], created_at: unixNow(), content: "hello" }),
    ).rejects.toThrow("A signer is required to create a rumor");
  });
});

describe("sealRumor", () => {
  it("should wrap the rumor event in a seal", async () => {
    const event = user.event({ kind: kinds.PrivateDirectMessage, content: "test" });
    const seal = await sealRumor(other.pubkey, user)(event);

    expect(seal.kind).toBe(kinds.Seal);
    expect(seal.pubkey).toBe(user.pubkey);
    expect(seal.sig).toBeDefined();
    expect(seal.created_at).toBeLessThan(unixNow() + 1);
    expect(await other.nip44.decrypt(seal.pubkey, seal.content)).toEqual(JSON.stringify(event));
  });

  it("should add the seal refeerence to the rumor", async () => {
    const rumor = user.event({ kind: kinds.PrivateDirectMessage, content: "test" });
    const seal = await sealRumor(other.pubkey, user)(rumor);
    expect(getRumorSeals(rumor)).toContain(seal);
  });

  it("should throw if no signer is provided", async () => {
    const event = user.event({ kind: kinds.PrivateDirectMessage, content: "test" });
    await expect(sealRumor(other.pubkey)(event)).rejects.toThrow("A signer is required to create a seal");
  });
});

describe("wrapSeal", () => {
  it("should wrap seal in a gift wrap event", async () => {
    const seal = user.event({ kind: kinds.Seal, content: "test" });
    const giftWrap = await wrapSeal(other.pubkey)(seal);

    expect(giftWrap.kind).toBe(kinds.GiftWrap);
    expect(giftWrap.created_at).toBeLessThan(unixNow() + 1);
    expect(giftWrap.tags).toContainEqual(["p", other.pubkey]);

    const content = await other.nip44.decrypt(giftWrap.pubkey, giftWrap.content);
    expect(JSON.parse(content)).toEqual({
      id: seal.id,
      kind: seal.kind,
      pubkey: seal.pubkey,
      content: seal.content,
      tags: seal.tags,
      sig: seal.sig,
      created_at: seal.created_at,
    });
  });

  it("should set the upstream reference on the seal", async () => {
    const seal = user.event({ kind: kinds.Seal, content: "test" });
    const giftWrap = await wrapSeal(other.pubkey)(seal);
    expect(getSealGiftWrap(seal)).toBe(giftWrap);
  });

  it("should sign with a random key", async () => {
    const seal = user.event({ kind: kinds.Seal, content: "test" });
    const giftWrap = await wrapSeal(other.pubkey)(seal);

    expect(giftWrap.pubkey).not.toBe(user.pubkey);
    expect(giftWrap.pubkey).not.toBe(other.pubkey);
  });
});

describe("giftWrap", () => {
  it("should preserve upstream and downstream references", async () => {
    const event = user.event({ kind: kinds.PrivateDirectMessage, content: "test" });

    const gift = await giftWrap(other.pubkey, user)(event);
    const seal = getGiftWrapSeal(gift);
    const rumor = getGiftWrapRumor(gift);

    expect(seal).toBeDefined();
    expect(rumor).toBeDefined();
    expect(getRumorSeals(rumor!)).toContain(seal!);
    expect(getSealGiftWrap(seal!)).toBe(gift);
    expect(getRumorGiftWraps(rumor!)).toContain(gift);
  });
});
