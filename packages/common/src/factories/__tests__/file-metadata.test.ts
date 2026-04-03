import { describe, expect, it, vi } from "vitest";
import { FileMetadataFactory } from "../file-metadata.js";

describe("FileMetadataFactory", () => {
  it("builds a kind 1063 event", async () => {
    const event = await FileMetadataFactory.create()
      .url("https://example.com/file.png")
      .type("image/png")
      .sha256("a".repeat(64))
      .size(1234)
      .summary("Example summary")
      .addFallbackURL("https://cdn.example.com/file.png");

    expect(event.kind).toBe(1063);
    expect(event.tags).toEqual([
      ["url", "https://example.com/file.png"],
      ["m", "image/png"],
      ["x", "a".repeat(64)],
      ["size", "1234"],
      ["summary", "Example summary"],
      ["fallback", "https://cdn.example.com/file.png"],
    ]);
  });

  it("applies metadata fields in bulk", async () => {
    const event = await FileMetadataFactory.create({
      url: "https://example.com/file.png",
      type: "image/png",
      sha256: "a".repeat(64),
      fallback: ["https://cdn.example.com/file.png"],
    });

    expect(event.tags).toEqual([
      ["url", "https://example.com/file.png"],
      ["m", "image/png"],
      ["x", "a".repeat(64)],
      ["fallback", "https://cdn.example.com/file.png"],
    ]);
  });

  it("supports updating fallback URLs fluently", async () => {
    const event = await FileMetadataFactory.create()
      .addFallbackURL("https://a.example.com/file.png")
      .addFallbackURL("https://b.example.com/file.png", false)
      .removeFallbackURL("https://a.example.com/file.png")
      .fallbackURLs(["https://c.example.com/file.png"]);

    expect(event.tags).toEqual([["fallback", "https://c.example.com/file.png"]]);
  });

  it("creates a template from an uploaded file", async () => {
    const file = new File(["hello world"], "hello.txt", { type: "text/plain" });
    const uploader = vi.fn(async (input: File) => ({
      url: `https://example.com/${input.name}`,
      sha256: "b".repeat(64),
    }));

    const event = await FileMetadataFactory.fromUpload(file, uploader);

    expect(uploader).toHaveBeenCalledWith(file);
    expect(event.tags).toEqual([
      ["url", "https://example.com/hello.txt"],
      ["m", "text/plain"],
      ["x", "b".repeat(64)],
      ["size", String(file.size)],
    ]);
  });

  it("prefers uploader size and type when provided", async () => {
    const file = new File(["hello world"], "hello.txt", { type: "text/plain" });
    const event = await FileMetadataFactory.fromUpload(file, async () => ({
      url: "https://example.com/custom.bin",
      sha256: "c".repeat(64),
      size: 999,
      type: "application/octet-stream",
    }));

    expect(event.tags).toEqual([
      ["url", "https://example.com/custom.bin"],
      ["m", "application/octet-stream"],
      ["x", "c".repeat(64)],
      ["size", "999"],
    ]);
  });
});
