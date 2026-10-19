import { describe, expect, it } from "vitest";
import { decodeGroupPointer, encodeGroupPointer } from "../groups.js";
import { parseExternalPointer } from "../external-id.js";
import { getSha256FromURL } from "../file-metadata.js";

function nativeDecode(input: string) {
  const separator = input.indexOf("'");
  let relay = separator === -1 ? input : input.slice(0, separator);
  const id = separator === -1 ? "" : input.slice(separator + 1);
  if (!relay) return null;
  if (!/^wss?:/.test(relay)) relay = "wss://" + relay;
  try {
    const url = new URL(relay);
    if (url.hash) return null;
    const normalized = new URL(url);
    normalized.pathname = normalized.pathname.replace(/\/{2,}/g, "/");
    return { relay: normalized.href, id: id || "_" };
  } catch {
    return null;
  }
}

function nativeEncode(pointer: { relay: string; id: string }) {
  const normalized = nativeDecode(`${pointer.relay}'_`)?.relay;
  if (!normalized) return `${pointer.relay}'${pointer.id}`;
  let relay = normalized;
  if (normalized.startsWith("wss://")) {
    const url = new URL(normalized);
    relay = url.pathname === "/" && !url.search ? url.host : normalized.slice(6);
  }
  return `${relay}'${pointer.id}`;
}

describe("URL conversion compatibility", () => {
  it("preserves group pointer encoding, including empty delimiters and credentials", () => {
    for (const host of ["EXAMPLE.com", "[::1]", "bücher.example", "user:pass@example.com", "foo.0x"])
      for (const scheme of ["", "wss://", "ws://", "WSS://", "https://"])
        for (const path of ["", "/", "/?", "/#", "/?#", "/?x=1#", "/a//b?q=1", "/a/../b", "/#fragment"])
          for (const id of ["", "room", "room'with'apostrophes"]) {
            const relay = `${scheme}${host}${path}`;
            expect(decodeGroupPointer(`${relay}'${id}`), relay).toEqual(nativeDecode(`${relay}'${id}`));
            expect(encodeGroupPointer({ relay, id }), relay).toBe(nativeEncode({ relay, id }));
          }
  });

  it("removes external identifier fragments without changing path serialization", () => {
    for (const input of [
      "https://EXAMPLE.com:443/a//b?q=//#fragment",
      "https:example.com/a//b#fragment",
      "https://bücher.example/a//b#fragment",
      "ftp://example.com/a//b#fragment",
      "mailto:user@example.com #fragment",
      "data:text/plain,a  #fragment",
      "custom:a  ?q=1#fragment",
    ]) {
      const url = new URL(input);
      url.hash = "";
      expect(parseExternalPointer(input)).toEqual({ kind: "web", identifier: url.href });
    }
  });

  it("extracts only the last hash in the serialized pathname", () => {
    const first = "a".repeat(64),
      last = "B".repeat(64);
    for (const input of [
      `https://example.com/${first}//${last}.jpg?q=${first}#${first}`,
      `https://example.com/${first}/../${last}.jpg`,
      `https://example.com/a%2Fb/${last}.jpg`,
      `https://bücher.example/${last}.jpg`,
      `https://example.com/?hash=${first}`,
    ]) {
      const matches = [...new URL(input).pathname.matchAll(/[0-9a-f]{64}/gi)];
      const expected = matches.at(-1)?.[0];
      expect(getSha256FromURL(input)).toBe(expected);
      expect(getSha256FromURL(new URL(input))).toBe(expected);
    }
  });
});
