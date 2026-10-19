import { Tokens } from "applesauce-core/helpers/regexp";
import { describe, expect, it, vi } from "vitest";
import { getMediaAttachmentURLsFromContent } from "../media.js";

const hash = "a".repeat(64);

describe("media attachment URL extraction", () => {
  it("preserves serialization, order and duplicates while skipping non-media and invalid URLs", () => {
    const urls = [
      `https://EXAMPLE.com:443/a//${hash}.jpg`,
      `https://bücher.example/${hash}.jpg`,
      `https://example.com/${hash}/../no-hash.jpg`,
      `https://example.com/photo.jpg?hash=${hash}`,
      `https://example.com:99999/${hash}.jpg`,
      `https://EXAMPLE.com:443/a//${hash}.jpg`,
    ];
    const content = urls.join(" ");
    const expected = [...content.matchAll(Tokens.link)].flatMap(([input]) => {
      try {
        const url = new URL(input);
        const matches = [...url.pathname.matchAll(/[0-9a-f]{64}/gi)];
        const sha256 = matches.at(-1)?.[0];
        return sha256 ? [{ url: url.href, sha256 }] : [];
      } catch {
        return [];
      }
    });
    expect(getMediaAttachmentURLsFromContent(content)).toEqual(expected);
  });

  it("extracts ordinary media URLs without constructing native URL objects", () => {
    const NativeURL = globalThis.URL;
    const constructor = vi.fn(function (input: string | URL) {
      return new NativeURL(input);
    });
    vi.stubGlobal("URL", constructor);
    try {
      const input = `https://media-no-constructor.example/a//${hash}.jpg`;
      expect(getMediaAttachmentURLsFromContent(input)).toEqual([{ url: input, sha256: hash }]);
      expect(constructor).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
