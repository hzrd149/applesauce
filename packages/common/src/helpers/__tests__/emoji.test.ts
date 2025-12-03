import { describe, expect, it } from "vitest";
import { getEmojiTag, getReactionEmoji } from "../emoji.js";
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
