import { describe, expect, it } from "vitest";
import { areBlossomServersEqual, blossomServers, encodeBlossomURI, parseBlossomURI } from "../blossom.js";

const HASH = "b1674191a88ec5cdd733e4240a81803105dc412d6c6708d53ab94fc248f4f553";
const PUBKEY_A = "ec4425ff5e9446080d2f70440188e3ca5d6da8713db7bdeef73d0ed54d9093f0";
const PUBKEY_B = "781208004e09102d7da3b7345e64fd193cd1bc3fce8fdae6008d77f9cabcd036";

describe("areBlossomServersEqual", () => {
  it("should ignore path", () => {
    expect(areBlossomServersEqual("https://cdn.server.com/pathname", "https://cdn.server.com")).toBe(true);
  });

  it("should not ignore protocol", () => {
    expect(areBlossomServersEqual("http://cdn.server.com", "https://cdn.server.com")).toBe(false);
  });

  it("should not ignore port", () => {
    expect(areBlossomServersEqual("http://cdn.server.com:4658", "https://cdn.server.com")).toBe(false);
  });
});

describe("blossomServers", () => {
  it("returns an empty array when no servers are provided", () => {
    expect(blossomServers()).toEqual([]);
  });

  it("ignores null and undefined values", () => {
    expect(blossomServers(null, undefined, "https://cdn.example.com")).toEqual(["https://cdn.example.com/"]);
  });

  it("strips paths from string servers", () => {
    expect(blossomServers("https://cdn.example.com/path")).toEqual(["https://cdn.example.com/"]);
  });

  it("strips paths from URL servers", () => {
    expect(blossomServers(new URL("https://cdn.example.com/path"))).toEqual([new URL("https://cdn.example.com/")]);
  });

  it("preserves string type for string inputs", () => {
    const result = blossomServers("https://cdn.example.com");
    expect(typeof result[0]).toBe("string");
  });

  it("preserves URL type for URL inputs", () => {
    const result = blossomServers(new URL("https://cdn.example.com"));
    expect(result[0]).toBeInstanceOf(URL);
  });

  it("merges scalar values and arrays into one flat list", () => {
    const result = blossomServers<string | URL>(
      "https://cdn1.example.com",
      ["https://cdn2.example.com"],
      new URL("https://cdn3.example.com"),
    );
    expect(result).toEqual([
      "https://cdn1.example.com/",
      "https://cdn2.example.com/",
      new URL("https://cdn3.example.com/"),
    ]);
  });

  it("de-duplicates servers by origin", () => {
    expect(
      blossomServers<string | URL>(
        "https://cdn.example.com/path",
        new URL("https://cdn.example.com/other"),
        "https://cdn.example.com",
      ),
    ).toEqual(["https://cdn.example.com/"]);
  });

  it("adds https to string servers when the protocol is missing", () => {
    expect(blossomServers("cdn.example.com", "cdn2.example.com/path")).toEqual([
      "https://cdn.example.com/",
      "https://cdn2.example.com/",
    ]);
  });

  it("treats different protocols as distinct servers", () => {
    expect(blossomServers("https://cdn.example.com", "http://cdn.example.com")).toEqual([
      "https://cdn.example.com/",
      "http://cdn.example.com/",
    ]);
  });

  it("treats different ports as distinct servers", () => {
    expect(blossomServers("https://cdn.example.com", "https://cdn.example.com:8443")).toEqual([
      "https://cdn.example.com/",
      "https://cdn.example.com:8443/",
    ]);
  });
});

describe("parseBlossomURI", () => {
  it("parses a minimal URI", () => {
    expect(parseBlossomURI(`blossom:${HASH}.pdf`)).toEqual({
      sha256: HASH,
      ext: "pdf",
      size: undefined,
      servers: [],
      authors: [],
    });
  });

  it("parses a .bin URI", () => {
    expect(parseBlossomURI(`blossom:${HASH}.bin`)).toMatchObject({ ext: "bin" });
  });

  it("parses a single xs server hint", () => {
    expect(parseBlossomURI(`blossom:${HASH}.pdf?xs=cdn.example.com`)).toMatchObject({
      servers: ["cdn.example.com"],
    });
  });

  it("parses multiple xs server hints", () => {
    expect(parseBlossomURI(`blossom:${HASH}.pdf?xs=cdn.satellite.earth&xs=blossom.primal.net`)).toMatchObject({
      servers: ["cdn.satellite.earth", "blossom.primal.net"],
    });
  });

  it("parses xs with protocol scheme", () => {
    expect(parseBlossomURI(`blossom:${HASH}.pdf?xs=https://cdn.satellite.earth`)).toMatchObject({
      servers: ["https://cdn.satellite.earth"],
    });
  });

  it("parses a single as author", () => {
    expect(parseBlossomURI(`blossom:${HASH}.pdf?as=${PUBKEY_A}`)).toMatchObject({
      authors: [PUBKEY_A],
    });
  });

  it("parses multiple as authors", () => {
    expect(parseBlossomURI(`blossom:${HASH}.pdf?as=${PUBKEY_A}&as=${PUBKEY_B}`)).toMatchObject({
      authors: [PUBKEY_A, PUBKEY_B],
    });
  });

  it("parses sz size", () => {
    expect(parseBlossomURI(`blossom:${HASH}.pdf?sz=184292`)).toMatchObject({ size: 184292 });
  });

  it("parses a fully-featured URI", () => {
    expect(
      parseBlossomURI(`blossom:${HASH}.pdf?xs=cdn.satellite.earth&xs=blossom.primal.net&as=${PUBKEY_A}&sz=184292`),
    ).toEqual({
      sha256: HASH,
      ext: "pdf",
      size: 184292,
      servers: ["cdn.satellite.earth", "blossom.primal.net"],
      authors: [PUBKEY_A],
    });
  });

  it("returns null when the scheme is missing", () => {
    expect(parseBlossomURI(`${HASH}.pdf`)).toBeNull();
  });

  it("returns null when the hash is not 64 hex chars", () => {
    expect(parseBlossomURI(`blossom:abc.pdf`)).toBeNull();
  });

  it("returns null for uppercase hash", () => {
    expect(parseBlossomURI(`blossom:${HASH.toUpperCase()}.pdf`)).toBeNull();
  });

  it("returns null when the extension is missing", () => {
    expect(parseBlossomURI(`blossom:${HASH}`)).toBeNull();
  });

  it("ignores invalid sz values", () => {
    expect(parseBlossomURI(`blossom:${HASH}.pdf?sz=notanumber`)).toMatchObject({ size: undefined });
    expect(parseBlossomURI(`blossom:${HASH}.pdf?sz=-5`)).toMatchObject({ size: undefined });
    expect(parseBlossomURI(`blossom:${HASH}.pdf?sz=0`)).toMatchObject({ size: undefined });
    expect(parseBlossomURI(`blossom:${HASH}.pdf?sz=1.5`)).toMatchObject({ size: undefined });
  });
});

describe("encodeBlossomURI", () => {
  it("encodes a minimal URI", () => {
    expect(encodeBlossomURI({ sha256: HASH, ext: "pdf", servers: [], authors: [] })).toBe(`blossom:${HASH}.pdf`);
  });

  it("defaults ext to bin when empty", () => {
    expect(encodeBlossomURI({ sha256: HASH, ext: "", servers: [], authors: [] })).toBe(`blossom:${HASH}.bin`);
  });

  it("encodes all parameters", () => {
    expect(
      encodeBlossomURI({
        sha256: HASH,
        ext: "pdf",
        size: 184292,
        servers: ["cdn.satellite.earth", "blossom.primal.net"],
        authors: [PUBKEY_A],
      }),
    ).toBe(`blossom:${HASH}.pdf?xs=cdn.satellite.earth&xs=blossom.primal.net&as=${PUBKEY_A}&sz=184292`);
  });

  it("round-trips through parse", () => {
    const original: Parameters<typeof encodeBlossomURI>[0] = {
      sha256: HASH,
      ext: "png",
      size: 2547831,
      servers: ["cdn.example.com", "media.nostr.build"],
      authors: [PUBKEY_A, PUBKEY_B],
    };
    const encoded = encodeBlossomURI(original);
    expect(parseBlossomURI(encoded)).toEqual({ ...original });
  });
});
