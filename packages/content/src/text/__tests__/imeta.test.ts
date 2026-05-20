import { describe, expect, it } from "vitest";

import { FakeUser } from "../../__tests__/fake-user.js";
import { getParsedContent } from "../content.js";
import { imetaLinks } from "../imeta.js";
import { links } from "../links.js";

const user = new FakeUser();

describe("imetaLinks", () => {
  it("should hydrate link nodes with metadata from a matching imeta tag", () => {
    const event = user.event({
      content: "Check this out https://example.com/cat.jpg",
      tags: [
        [
          "imeta",
          "url https://example.com/cat.jpg",
          "m image/jpeg",
          "dim 800x600",
          "blurhash LEHV6nWB2yk8pyo0adR*.7kCMdnj",
          "x abc123",
        ],
      ],
    });

    const tree = getParsedContent(event, undefined, [links, imetaLinks]);

    expect(tree.children).toEqual([
      { type: "text", value: "Check this out " },
      {
        type: "link",
        value: "https://example.com/cat.jpg",
        href: "https://example.com/cat.jpg",
        metadata: {
          url: "https://example.com/cat.jpg",
          type: "image/jpeg",
          dimensions: "800x600",
          blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
          sha256: "abc123",
          fallback: undefined,
        },
      },
    ]);
  });

  it("should leave link nodes without a matching imeta tag untouched", () => {
    const event = user.event({
      content: "https://example.com/cat.jpg and https://example.com/dog.jpg",
      tags: [["imeta", "url https://example.com/cat.jpg", "blurhash xxx"]],
    });

    const tree = getParsedContent(event, undefined, [links, imetaLinks]);

    const linkNodes = tree.children.filter((n) => n.type === "link");
    expect(linkNodes).toHaveLength(2);
    expect(linkNodes[0]).toMatchObject({ href: "https://example.com/cat.jpg", metadata: { blurhash: "xxx" } });
    expect(linkNodes[1]).toMatchObject({ href: "https://example.com/dog.jpg" });
    expect((linkNodes[1] as { metadata?: unknown }).metadata).toBeUndefined();
  });

  it("should noop when event is missing", () => {
    const tree = getParsedContent("https://example.com/cat.jpg", undefined, [links, imetaLinks]);
    expect(tree.children).toEqual([
      { type: "link", value: "https://example.com/cat.jpg", href: "https://example.com/cat.jpg" },
    ]);
  });

  it("should noop when event has no imeta tags", () => {
    const event = user.event({ content: "https://example.com/cat.jpg", tags: [] });
    const tree = getParsedContent(event, undefined, [links, imetaLinks]);
    expect(tree.children.find((n) => n.type === "link")).toMatchObject({
      href: "https://example.com/cat.jpg",
    });
    expect((tree.children.find((n) => n.type === "link") as { metadata?: unknown }).metadata).toBeUndefined();
  });
});
