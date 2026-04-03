import { EventStore } from "applesauce-core/event-store";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { castEvent } from "../cast.js";
import { FileMetadata } from "../file-metadata.js";

describe("file metadata cast", () => {
  it("reads kind 1063 metadata", () => {
    const user = new FakeUser();
    const store = new EventStore();
    const event = store.add(
      user.event({
        kind: 1063,
        tags: [
          ["url", "https://example.com/file.png"],
          ["m", "image/png"],
          ["x", "a".repeat(64)],
          ["size", "1234"],
          ["alt", "Example image"],
          ["fallback", "https://cdn.example.com/file.png"],
        ],
      }),
    )!;

    const cast = castEvent(event, FileMetadata, store);

    expect(cast.metadata).toEqual({
      url: "https://example.com/file.png",
      type: "image/png",
      sha256: "a".repeat(64),
      size: 1234,
      alt: "Example image",
      fallback: ["https://cdn.example.com/file.png"],
    });
    expect(cast.url).toBe("https://example.com/file.png");
    expect(cast.type).toBe("image/png");
    expect(cast.sha256).toBe("a".repeat(64));
    expect(cast.size).toBe(1234);
    expect(cast.alt).toBe("Example image");
    expect(cast.fallback).toEqual(["https://cdn.example.com/file.png"]);
  });

  it("rejects invalid events", () => {
    const user = new FakeUser();
    const store = new EventStore();
    const event = store.add(user.event({ kind: 1063, tags: [] }))!;

    expect(() => castEvent(event, FileMetadata, store)).toThrow("Invalid file metadata event");
  });
});
