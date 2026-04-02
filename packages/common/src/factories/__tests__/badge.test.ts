import { kinds, type NostrEvent } from "applesauce-core/helpers/event";
import { describe, expect, it } from "vitest";
import { BadgeFactory } from "../badge.js";

const HEX = (char: string, length = 64) => char.repeat(length);

describe("BadgeFactory", () => {
  it("builds a badge definition event", async () => {
    const event = await BadgeFactory.create()
      .name("Alpha")
      .description("Alpha badge")
      .image("https://example.com/hero.png", { width: 640, height: 480 })
      .thumbnail("https://example.com/thumb.png", { width: 320 })
      .thumbnail("https://example.com/thumb-2.png")
      .content("Badge metadata");

    expect(event.kind).toBe(kinds.BadgeDefinition);
    expect(event.tags).toEqual([
      ["d", expect.any(String)],
      ["name", "Alpha"],
      ["description", "Alpha badge"],
      ["image", "https://example.com/hero.png", "640x480"],
      ["thumb", "https://example.com/thumb.png", "320"],
      ["thumb", "https://example.com/thumb-2.png"],
    ]);
    expect(event.content).toBe("Badge metadata");
  });

  it("modifies an existing badge event", async () => {
    const existing: NostrEvent = {
      kind: kinds.BadgeDefinition,
      id: HEX("1"),
      pubkey: HEX("2"),
      sig: HEX("a", 128),
      created_at: 1,
      content: "",
      tags: [
        ["d", "alpha"],
        ["name", "Alpha"],
        ["image", "https://example.com/hero.png"],
        ["thumb", "https://example.com/thumb.png"],
      ],
    };

    const draft = await BadgeFactory.modify(existing).name(null).clearImage().clearThumbnails();

    expect(draft.tags).toEqual([["d", "alpha"]]);
  });
});
