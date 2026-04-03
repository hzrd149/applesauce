import { EventTemplate, unixNow } from "applesauce-core/helpers";
import { describe, expect, it } from "vitest";
import {
  addFallbackURL,
  clearFallbackURLs,
  removeFallbackURL,
  setFallbackURLs,
  setFileAlt,
  setFileBlurhash,
  setFileDimensions,
  setFileImage,
  setFileInfohash,
  setFileMagnet,
  setFileMetadata,
  setFileSHA256,
  setFileSize,
  setFileSummary,
  setFileThumbnail,
  setFileType,
  setFileURL,
  setOriginalFileSHA256,
} from "../file-metadata.js";

const baseEvent = (): EventTemplate => ({
  kind: 1063,
  content: "",
  tags: [],
  created_at: unixNow(),
});

describe("file metadata operations", () => {
  it.each([
    ["url", setFileURL("https://example.com/file.png"), [["url", "https://example.com/file.png"]]],
    ["type", setFileType("image/png"), [["m", "image/png"]]],
    ["sha256", setFileSHA256("a".repeat(64)), [["x", "a".repeat(64)]]],
    ["original sha256", setOriginalFileSHA256("b".repeat(64)), [["ox", "b".repeat(64)]]],
    ["size", setFileSize(1234), [["size", "1234"]]],
    ["dimensions", setFileDimensions("640x480"), [["dim", "640x480"]]],
    ["magnet", setFileMagnet("magnet:?xt=urn:btih:test"), [["magnet", "magnet:?xt=urn:btih:test"]]],
    ["infohash", setFileInfohash("infohash"), [["i", "infohash"]]],
    ["thumbnail", setFileThumbnail("https://example.com/thumb.png"), [["thumb", "https://example.com/thumb.png"]]],
    ["image", setFileImage("https://example.com/preview.png"), [["image", "https://example.com/preview.png"]]],
    ["summary", setFileSummary("Example summary"), [["summary", "Example summary"]]],
    ["alt", setFileAlt("Accessible description"), [["alt", "Accessible description"]]],
    ["blurhash", setFileBlurhash("LEHV6nWB2yk8pyo0adR*.7kCMdnj"), [["blurhash", "LEHV6nWB2yk8pyo0adR*.7kCMdnj"]]],
  ])("sets %s", async (_label, operation, expectedTags) => {
    const result = await operation(baseEvent());
    expect(result.tags).toEqual(expectedTags);
  });

  it.each([
    ["url", setFileURL(null), ["url", "https://example.com/file.png"]],
    ["type", setFileType(null), ["m", "image/png"]],
    ["sha256", setFileSHA256(null), ["x", "a".repeat(64)]],
    ["original sha256", setOriginalFileSHA256(null), ["ox", "b".repeat(64)]],
    ["size", setFileSize(null), ["size", "1234"]],
    ["dimensions", setFileDimensions(null), ["dim", "640x480"]],
    ["magnet", setFileMagnet(null), ["magnet", "magnet:?xt=urn:btih:test"]],
    ["infohash", setFileInfohash(null), ["i", "infohash"]],
    ["thumbnail", setFileThumbnail(null), ["thumb", "https://example.com/thumb.png"]],
    ["image", setFileImage(null), ["image", "https://example.com/preview.png"]],
    ["summary", setFileSummary(null), ["summary", "Example summary"]],
    ["alt", setFileAlt(null), ["alt", "Accessible description"]],
    ["blurhash", setFileBlurhash(null), ["blurhash", "LEHV6nWB2yk8pyo0adR*.7kCMdnj"]],
  ])("clears %s", async (_label, operation, tag) => {
    const result = await operation({ ...baseEvent(), tags: [tag as [string, string]] });
    expect(result.tags).toEqual([]);
  });

  it("adds, removes, and clears fallback URLs", async () => {
    const added = await addFallbackURL("https://cdn.example.com/file.png")(baseEvent());
    expect(added.tags).toEqual([["fallback", "https://cdn.example.com/file.png"]]);

    const duplicate = await addFallbackURL("https://cdn.example.com/file.png")(added);
    expect(duplicate.tags).toEqual([["fallback", "https://cdn.example.com/file.png"]]);

    const expanded = await addFallbackURL("https://backup.example.com/file.png", false)(duplicate);
    expect(expanded.tags).toEqual([
      ["fallback", "https://cdn.example.com/file.png"],
      ["fallback", "https://backup.example.com/file.png"],
    ]);

    const removed = await removeFallbackURL("https://cdn.example.com/file.png")(expanded);
    expect(removed.tags).toEqual([["fallback", "https://backup.example.com/file.png"]]);

    const cleared = await clearFallbackURLs()(removed);
    expect(cleared.tags).toEqual([]);
  });

  it("replaces all fallback URLs", async () => {
    const result = await setFallbackURLs(["https://a.example.com/file.png", "https://b.example.com/file.png"])({
      ...baseEvent(),
      tags: [["fallback", "https://old.example.com/file.png"]],
    });

    expect(result.tags).toEqual([
      ["fallback", "https://a.example.com/file.png"],
      ["fallback", "https://b.example.com/file.png"],
    ]);
  });

  it("sets file metadata fields in bulk", async () => {
    const result = await setFileMetadata({
      url: "https://example.com/file.png",
      type: "image/png",
      sha256: "a".repeat(64),
      size: 1234,
      summary: "Example summary",
      fallback: ["https://cdn.example.com/file.png"],
    })({
      ...baseEvent(),
      tags: [
        ["summary", "Old summary"],
        ["fallback", "https://old.example.com/file.png"],
      ],
    });

    expect(result.tags).toEqual([
      ["summary", "Example summary"],
      ["url", "https://example.com/file.png"],
      ["m", "image/png"],
      ["x", "a".repeat(64)],
      ["size", "1234"],
      ["fallback", "https://cdn.example.com/file.png"],
    ]);
  });
});
