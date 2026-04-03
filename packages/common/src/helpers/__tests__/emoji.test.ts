import { describe, expect, it } from "vitest";
import { getEmojiFromTags, getEmojiTag, getReactionEmoji } from "../emoji.js";
import {
  getEmojiPackEmojis,
  getEmojiPackName,
  getFavoriteEmojiPackPointers,
  getFavoriteEmojis,
  getHiddenFavoriteEmojiPackPointers,
  getHiddenFavoriteEmojis,
  isValidEmojiPack,
  isValidFavoriteEmojiPacks,
  unlockHiddenFavoriteEmojiPacks,
} from "../emoji-pack.js";
import { FakeUser } from "../../__tests__/fixtures.js";

const user = new FakeUser();

describe("getEmojiTag", () => {
  it("Should find emoji tag", () => {
    expect(
      getEmojiTag(
        user.note("hello :custom:", { tags: [["emoji", "custom", "https://cdn.example.com/reaction1.png"]] }),
        "custom",
      ),
    ).toEqual(["emoji", "custom", "https://cdn.example.com/reaction1.png"]);
  });

  it("Should custom leading and trailing :", () => {
    expect(
      getEmojiTag(
        user.note("hello :custom:", { tags: [["emoji", "custom", "https://cdn.example.com/reaction1.png"]] }),
        ":custom:",
      ),
    ).toEqual(["emoji", "custom", "https://cdn.example.com/reaction1.png"]);
  });

  it("Should convert to lowercase", () => {
    expect(
      getEmojiTag(
        user.note("hello :custom:", { tags: [["emoji", "custom", "https://cdn.example.com/reaction1.png"]] }),
        "CustoM",
      ),
    ).toEqual(["emoji", "custom", "https://cdn.example.com/reaction1.png"]);
  });
});

describe("getEmojiFromTags", () => {
  it("returns emoji without address when tag has no address", () => {
    const tags = [["emoji", "custom", "https://cdn.example.com/custom.png"]];
    expect(getEmojiFromTags(tags, "custom")).toEqual({
      shortcode: "custom",
      url: "https://cdn.example.com/custom.png",
    });
  });

  it("returns emoji with address when tag includes address", () => {
    const tags = [["emoji", "custom", "https://cdn.example.com/custom.png", `30030:${user.pubkey}:pack-id`]];
    expect(getEmojiFromTags(tags, "custom")).toEqual({
      shortcode: "custom",
      url: "https://cdn.example.com/custom.png",
      address: { kind: 30030, pubkey: user.pubkey, identifier: "pack-id" },
    });
  });
});

describe("getEmojis", () => {
  it("returns emojis without address when tags have no address", () => {
    const pack = user.event({
      kind: 30030,
      tags: [
        ["emoji", "heart", "https://cdn.example.com/heart.png"],
        ["emoji", "star", "https://cdn.example.com/star.png"],
      ],
      content: "",
    });
    expect(getEmojiPackEmojis(pack)).toEqual([
      { shortcode: "heart", url: "https://cdn.example.com/heart.png" },
      { shortcode: "star", url: "https://cdn.example.com/star.png" },
    ]);
  });

  it("returns emojis with address when tags include address", () => {
    const pack = user.event({
      kind: 30030,
      tags: [
        ["emoji", "heart", "https://cdn.example.com/heart.png", `30030:${user.pubkey}:my-pack`],
        ["emoji", "star", "https://cdn.example.com/star.png"],
      ],
      content: "",
    });
    expect(getEmojiPackEmojis(pack)).toEqual([
      {
        shortcode: "heart",
        url: "https://cdn.example.com/heart.png",
        address: { kind: 30030, pubkey: user.pubkey, identifier: "my-pack" },
      },
      { shortcode: "star", url: "https://cdn.example.com/star.png" },
    ]);
  });
});

describe("emoji packs", () => {
  it("returns the title as the pack name", () => {
    const pack = user.event({
      kind: 30030,
      tags: [
        ["d", "my-pack"],
        ["title", "My Pack"],
      ],
    });
    expect(getEmojiPackName(pack)).toBe("My Pack");
  });

  it("falls back to the d tag for pack name", () => {
    const pack = user.event({ kind: 30030, tags: [["d", "my-pack"]] });
    expect(getEmojiPackName(pack)).toBe("my-pack");
  });

  it("validates emoji packs require a d tag", () => {
    expect(isValidEmojiPack(user.event({ kind: 30030, tags: [["d", "pack"]] }))).toBe(true);
    expect(isValidEmojiPack(user.event({ kind: 30030, tags: [] }))).toBe(false);
  });

  it("validates favorite emoji pack lists by kind", () => {
    expect(isValidFavoriteEmojiPacks(user.event({ kind: 10030 }))).toBe(true);
    expect(isValidFavoriteEmojiPacks(user.event({ kind: 10003 }))).toBe(false);
  });

  it("reads public favorite emojis and pack pointers", () => {
    const list = user.event({
      kind: 10030,
      tags: [
        ["emoji", "heart", "https://cdn.example.com/heart.png", `30030:${user.pubkey}:animals`],
        ["emoji", "star", "https://cdn.example.com/star.png"],
        ["a", `30030:${user.pubkey}:animals`],
        ["a", `30002:${user.pubkey}:relays`],
      ],
    });

    expect(getFavoriteEmojis(list)).toEqual([
      {
        shortcode: "heart",
        url: "https://cdn.example.com/heart.png",
        address: { kind: 30030, pubkey: user.pubkey, identifier: "animals" },
      },
      { shortcode: "star", url: "https://cdn.example.com/star.png" },
    ]);
    expect(getFavoriteEmojiPackPointers(list)).toEqual([
      expect.objectContaining({ kind: 30030, pubkey: user.pubkey, identifier: "animals" }),
    ]);
  });

  it("unlocks hidden favorite emojis and pack pointers", async () => {
    const hiddenTags = [
      ["emoji", "wave", "https://cdn.example.com/wave.png", `30030:${user.pubkey}:greetings`],
      ["a", `30030:${user.pubkey}:greetings`],
    ];
    const list = user.event({
      kind: 10030,
      tags: [],
      content: await user.nip44.encrypt(user.pubkey, JSON.stringify(hiddenTags)),
    });

    const unlocked = await unlockHiddenFavoriteEmojiPacks(list, user);

    expect(unlocked).toEqual({
      emojis: [
        {
          shortcode: "wave",
          url: "https://cdn.example.com/wave.png",
          address: { kind: 30030, pubkey: user.pubkey, identifier: "greetings" },
        },
      ],
      packPointers: [expect.objectContaining({ kind: 30030, pubkey: user.pubkey, identifier: "greetings" })],
    });
    expect(getHiddenFavoriteEmojis(list)).toEqual(unlocked.emojis);
    expect(getHiddenFavoriteEmojiPackPointers(list)).toEqual(unlocked.packPointers);
  });
});

describe("getReactionEmoji", () => {
  it("returns emoji object when content matches emoji tag", () => {
    const event = user.event({
      kind: 7,
      tags: [["emoji", "heart", "https://cdn.example.com/heart.png"]],
      content: ":heart:",
    });

    const result = getReactionEmoji(event);
    expect(result).toEqual({
      shortcode: "heart",
      url: "https://cdn.example.com/heart.png",
    });
  });

  it("should return undefined when content is invalid shortcode", () => {
    const event = user.event({
      kind: 7,
      tags: [["emoji", "smile", "https://cdn.example.com/smile.png"]],
      content: ":smile",
    });

    const result = getReactionEmoji(event);
    expect(result).toBeUndefined();
  });

  it("handles double colon issue", () => {
    const event = user.event({
      kind: 7,
      tags: [["emoji", "smile", "https://cdn.example.com/smile.png"]],
      content: "::smile::",
    });

    const result = getReactionEmoji(event);
    expect(result).toEqual({
      shortcode: "smile",
      url: "https://cdn.example.com/smile.png",
    });
  });

  it("trims whitespace from content", () => {
    const event = user.event({
      kind: 7,
      tags: [["emoji", "thumbsup", "https://cdn.example.com/thumbsup.png"]],
      content: "  :thumbsup:  ",
    });

    const result = getReactionEmoji(event);
    expect(result).toEqual({
      shortcode: "thumbsup",
      url: "https://cdn.example.com/thumbsup.png",
    });
  });

  it("returns undefined when emoji tag is missing", () => {
    const event = user.event({
      kind: 7,
      tags: [["p", "pub1"]],
      content: ":missing:",
    });

    const result = getReactionEmoji(event);
    expect(result).toBeUndefined();
  });

  it("returns undefined when content is empty", () => {
    const event = user.event({
      kind: 7,
      tags: [["emoji", "star", "https://cdn.example.com/star.png"]],
      content: "",
    });

    const result = getReactionEmoji(event);
    expect(result).toBeUndefined();
  });

  it("returns undefined when content is just colons", () => {
    const event = user.event({
      kind: 7,
      tags: [["emoji", "fire", "https://cdn.example.com/fire.png"]],
      content: "::",
    });

    const result = getReactionEmoji(event);
    expect(result).toBeUndefined();
  });

  it("returns undefined when emoji tag is invalid (missing url)", () => {
    const event = user.event({
      kind: 7,
      tags: [["emoji", "invalid"]],
      content: ":invalid:",
    });

    const result = getReactionEmoji(event);
    expect(result).toBeUndefined();
  });

  it("handles capital letters", () => {
    const event = user.event({
      kind: 7,
      tags: [["emoji", "heart", "https://cdn.example.com/heart.png"]],
      content: ":HEART:",
    });

    const result = getReactionEmoji(event);
    expect(result).toEqual({
      shortcode: "heart",
      url: "https://cdn.example.com/heart.png",
    });
  });
});
