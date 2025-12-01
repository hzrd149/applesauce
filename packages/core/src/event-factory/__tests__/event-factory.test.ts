import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { EncryptedContentSymbol, getHiddenTags, kinds, unlockHiddenTags } from "../../helpers";
import { nip04 } from "../../helpers/encryption.js";
import { finalizeEvent } from "../../helpers/event.js";
import { setEncryptedContent } from "../../operations/encrypted-content.js";
import { includeAltTag, modifyPublicTags, setContent } from "../../operations/index.js";
import { addEventPointerTag, removeEventPointerTag, setSingletonTag } from "../../operations/tag/common.js";
import { EventFactory } from "../event-factory.js";
import { modifyEvent } from "../methods";

let factory = new EventFactory();
let user = new FakeUser();

beforeEach(() => {
  factory = new EventFactory();
  user = new FakeUser();

  // create signer for factory
  factory.context.signer = {
    getPublicKey: () => user.pubkey,
    signEvent: (draft) => finalizeEvent(draft, user.key),
    nip04: {
      encrypt: (pubkey, text) => nip04.encrypt(user.key, pubkey, text),
      decrypt: (pubkey, data) => nip04.decrypt(user.key, pubkey, data),
    },
  };
});

describe("modify", () => {
  it('should ensure addressable events have "d" tags', async () => {
    expect(
      await modifyEvent(
        { kind: kinds.Bookmarksets, tags: [], content: "", created_at: 0 },
        {},
        modifyPublicTags(setSingletonTag(["title", "testing"])),
      ),
    ).toEqual({
      content: "",
      tags: [
        ["d", expect.any(String)],
        ["title", "testing"],
      ],
      created_at: expect.any(Number),
      kind: kinds.Bookmarksets,
    });
  });

  it("should override created_at", async () => {
    expect(await modifyEvent({ kind: kinds.BookmarkList, created_at: 0, content: "", tags: [] }, {})).not.toEqual({
      kind: kinds.BookmarkList,
      created_at: 0,
    });
  });

  it("should remove id and sig", async () => {
    const event = await modifyEvent(user.profile({ name: "testing" }), {});

    expect(Reflect.has(event, "id")).toBe(false);
    expect(Reflect.has(event, "sig")).toBe(false);
  });

  it("should not carry over generic symbols", async () => {
    const symbol = Symbol("test");
    const event = user.profile({ name: "name" });
    Reflect.set(event, symbol, "testing");

    const draft = await modifyEvent(event, { signer: user }, includeAltTag("profile"));
    expect(Reflect.has(draft, symbol)).toBe(false);
  });
});

describe("modifyTags", () => {
  it("should apply tag operations to public tags by default", async () => {
    expect(await factory.modifyTags(user.list([["e", "event-id"]]), removeEventPointerTag("event-id"))).not.toEqual(
      expect.objectContaining({ tags: expect.arrayContaining(["e", "event-id"]) }),
    );
  });

  it("should apply public operations", async () => {
    expect(
      await factory.modifyTags(user.list([["e", "event-id"]]), { public: removeEventPointerTag("event-id") }),
    ).not.toEqual(expect.objectContaining({ tags: expect.arrayContaining(["e", "event-id"]) }));
  });

  it("should throw error when modifing hidden tags without signer", async () => {
    factory = new EventFactory();

    await expect(async () => {
      await factory.modifyTags(user.list(), { hidden: removeEventPointerTag("event-id") });
    }).rejects.toThrowError("Missing signer");
  });

  it("should apply hidden operations", async () => {
    const draft = await factory.modifyTags(user.list(), { hidden: addEventPointerTag("event-id") });

    // convert draft to full event
    const signed = await factory.context.signer!.signEvent(draft);

    // unlock hidden tags
    await unlockHiddenTags(signed, factory.context.signer!);

    expect(getHiddenTags(draft)).toEqual(expect.arrayContaining([["e", "event-id"]]));
  });

  it("should unlock hidden tags before modifying", async () => {
    const signer = factory.context.signer!;
    const encryptedList = user.list([], {
      content: await signer.nip04!.encrypt(await signer.getPublicKey(), JSON.stringify([["e", "event-id"]])),
    });

    // modify the hidden tags
    const draft = await factory.modifyTags(encryptedList, { hidden: addEventPointerTag("second-event-id") });

    // convert draft to full event
    const signed = await factory.context.signer!.signEvent(draft);

    await unlockHiddenTags(signed, factory.context.signer!);
    expect(getHiddenTags(draft)).toEqual(
      expect.arrayContaining([
        ["e", "event-id"],
        ["e", "second-event-id"],
      ]),
    );
  });

  it("should not unlock hidden tags if already unlocked before modifying", async () => {
    const signer = factory.context.signer!;
    const encryptedList = user.list([], {
      content: await signer.nip04!.encrypt(await signer.getPublicKey(), JSON.stringify([["e", "event-id"]])),
    });

    await unlockHiddenTags(encryptedList, signer);
    vi.spyOn(signer.nip04!, "decrypt");

    // modify the hidden tags
    await factory.modifyTags(encryptedList, { hidden: addEventPointerTag("second-event-id") });

    expect(signer.nip04!.decrypt).not.toHaveBeenCalled();
  });
});

describe("sign", () => {
  it("should throw if no signer is present", async () => {
    const factory = new EventFactory();

    await expect(async () => factory.sign(await factory.build({ kind: 1 }, setContent("testing")))).rejects.toThrow();
  });

  it("should preserve plaintext hidden content", async () => {
    const user = new FakeUser();
    const factory = new EventFactory({ signer: user });
    const draft = await factory.build({ kind: 4 }, setEncryptedContent(user.pubkey, "testing", "nip04"));
    const signed = await factory.sign(draft);

    expect(Reflect.get(signed, EncryptedContentSymbol)).toBe("testing");
  });
});
