import { EventTemplate, unixNow } from "applesauce-core/helpers";
import { kinds } from "applesauce-core/helpers/event";
import { describe, expect, it } from "vitest";
import {
  addThumbnail,
  clearHeroImage,
  clearThumbnails,
  removeThumbnail,
  setDescription,
  setHeroImage,
  setIdentifier,
  setName,
} from "../../operations/badge";

function createBadgeDraft(tags: string[][] = []): EventTemplate {
  return {
    kind: kinds.BadgeDefinition,
    content: "",
    tags,
    created_at: unixNow(),
  };
}

describe("badge operations", () => {
  it("sets identifier", async () => {
    const draft = createBadgeDraft();
    const result = await setIdentifier("alpha")(draft);
    expect(result.tags).toEqual([["d", "alpha"]]);
  });

  it("sets and removes name", async () => {
    const withName = await setName("Builder")(createBadgeDraft());
    expect(withName.tags).toContainEqual(["name", "Builder"]);

    const cleared = await setName(null)(withName);
    expect(cleared.tags.find((tag) => tag[0] === "name")).toBeUndefined();
  });

  it("sets and clears description", async () => {
    const set = await setDescription("Badge description")(createBadgeDraft());
    expect(set.tags).toContainEqual(["description", "Badge description"]);

    const cleared = await setDescription(null)(set);
    expect(cleared.tags.find((tag) => tag[0] === "description")).toBeUndefined();
  });

  it("sets hero image with dimensions", async () => {
    const draft = createBadgeDraft();
    const result = await setHeroImage("https://example.com/hero.png", { width: 640, height: 480 })(draft);
    expect(result.tags).toContainEqual(["image", "https://example.com/hero.png", "640x480"]);
  });

  it("clears hero image", async () => {
    const draft = createBadgeDraft([["image", "https://example.com/image.png"]]);
    const cleared = await clearHeroImage()(draft);
    expect(cleared.tags.find((tag) => tag[0] === "image")).toBeUndefined();
  });

  it("adds and replaces thumbnails", async () => {
    const first = await addThumbnail("https://example.com/thumb.png", { width: 128 })(createBadgeDraft());
    expect(first.tags).toContainEqual(["thumb", "https://example.com/thumb.png", "128"]);

    const updated = await addThumbnail("https://example.com/thumb.png", { height: 64 })(first);
    expect(updated.tags).toContainEqual(["thumb", "https://example.com/thumb.png", "x64"]);
    expect(updated.tags.filter((tag) => tag[0] === "thumb")).toHaveLength(1);
  });

  it("removes thumbnails individually and collectively", async () => {
    const draft = createBadgeDraft([
      ["thumb", "https://example.com/a.png"],
      ["thumb", "https://example.com/b.png"],
    ]);

    const withoutA = await removeThumbnail("https://example.com/a.png")(draft);
    expect(withoutA.tags).toEqual([["thumb", "https://example.com/b.png"]]);

    const cleared = await clearThumbnails()(withoutA);
    expect(cleared.tags).toHaveLength(0);
  });
});
