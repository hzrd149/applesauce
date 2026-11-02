import { describe, expect, it, vi } from "vitest";
import { sha256 } from "@noble/hashes/sha2";

import {
  buildNameIndexScript,
  DEFAULT_ELECTRUMX_SERVERS,
  electrumScriptHash,
  expandImports,
  extractNostrFromValue,
  formatNamecoinAddress,
  getIdentityFromNamecoinValue,
  isDotBit,
  isNamecoinIdentifier,
  parseNameUpdateScript,
  parseNamecoinAddress,
} from "../namecoin-identity.js";
import { IdentityStatus } from "../dns-identity.js";

const PK1 = "460c25e682fda7832b52d1f22d3d22b3176d972f60dcdc3212ed8c92ef85065c";

const OP_NAME_UPDATE = 0x53;
const OP_2DROP = 0x6d;
const OP_DROP = 0x75;
const OP_RETURN = 0x6a;
const OP_PUSHDATA1 = 0x4c;

describe("isNamecoinIdentifier", () => {
  it("accepts the canonical Namecoin shapes", () => {
    expect(isNamecoinIdentifier("example.bit")).toBe(true);
    expect(isNamecoinIdentifier("alice@example.bit")).toBe(true);
    expect(isNamecoinIdentifier("d/example")).toBe(true);
    expect(isNamecoinIdentifier("id/alice")).toBe(true);
    expect(isNamecoinIdentifier("nostr:alice@example.bit")).toBe(true);
    expect(isNamecoinIdentifier("  EXAMPLE.BIT  ")).toBe(true);
    expect(isDotBit("example.bit")).toBe(true);
  });

  it("rejects DNS identifiers, empty input, and non-strings", () => {
    expect(isNamecoinIdentifier("")).toBe(false);
    expect(isNamecoinIdentifier("alice@example.com")).toBe(false);
    expect(isNamecoinIdentifier("example.com")).toBe(false);
    // @ts-expect-error testing runtime safety
    expect(isNamecoinIdentifier(undefined)).toBe(false);
  });
});

describe("parseNamecoinAddress", () => {
  it("parses user@domain.bit", () => {
    expect(parseNamecoinAddress("alice@example.bit")).toEqual({
      namecoinName: "d/example",
      localPart: "alice",
      isDomain: true,
    });
  });

  it("parses bare .bit domains", () => {
    expect(parseNamecoinAddress("example.bit")).toEqual({
      namecoinName: "d/example",
      localPart: "_",
      isDomain: true,
    });
  });

  it("parses d/<name> and id/<name>", () => {
    expect(parseNamecoinAddress("d/example")).toEqual({
      namecoinName: "d/example",
      localPart: "_",
      isDomain: true,
    });
    expect(parseNamecoinAddress("id/alice")).toEqual({
      namecoinName: "id/alice",
      localPart: "_",
      isDomain: false,
    });
  });

  it("strips a leading nostr: prefix and lowercases", () => {
    expect(parseNamecoinAddress("nostr:Alice@Example.BIT")).toEqual({
      namecoinName: "d/example",
      localPart: "alice",
      isDomain: true,
    });
    expect(parseNamecoinAddress("NOSTR:D/Example")).toEqual({
      namecoinName: "d/example",
      localPart: "_",
      isDomain: true,
    });
  });

  it("rejects invalid identifiers", () => {
    expect(parseNamecoinAddress("alice@example.com")).toBeNull();
    expect(parseNamecoinAddress("")).toBeNull();
    expect(parseNamecoinAddress(".bit")).toBeNull();
    expect(parseNamecoinAddress("d/")).toBeNull();
    expect(parseNamecoinAddress("id/")).toBeNull();
  });

  it("treats an empty local-part as the root entry", () => {
    expect(parseNamecoinAddress("@example.bit")).toEqual({
      namecoinName: "d/example",
      localPart: "_",
      isDomain: true,
    });
  });
});

describe("formatNamecoinAddress", () => {
  it("round-trips through parse + format", () => {
    expect(formatNamecoinAddress(parseNamecoinAddress("alice@example.bit")!)).toBe("alice@example.bit");
    expect(formatNamecoinAddress(parseNamecoinAddress("example.bit")!)).toBe("example.bit");
    expect(formatNamecoinAddress(parseNamecoinAddress("id/alice")!)).toBe("id/alice");
  });
});

describe("extractNostrFromValue", () => {
  it("extracts the simple string form on the root entry", () => {
    const addr = parseNamecoinAddress("example.bit")!;
    expect(extractNostrFromValue(addr, { nostr: PK1 })).toEqual({ pubkey: PK1 });
  });

  it("rejects the simple form when a local-part is requested", () => {
    const addr = parseNamecoinAddress("alice@example.bit")!;
    expect(extractNostrFromValue(addr, { nostr: PK1 })).toBeNull();
  });

  it("extracts the extended form by exact local-part match", () => {
    const addr = parseNamecoinAddress("alice@example.bit")!;
    const value = {
      nostr: {
        names: { _: PK1, alice: PK1 },
        relays: { [PK1]: ["wss://relay.example.com"] },
        nip46: { [PK1]: ["wss://signer.example.com"] },
      },
    };
    expect(extractNostrFromValue(addr, value)).toEqual({
      pubkey: PK1,
      relays: ["wss://relay.example.com"],
      nip46: ["wss://signer.example.com"],
    });
  });

  it("falls back to the `_` entry when the local-part is missing", () => {
    const addr = parseNamecoinAddress("ghost@example.bit")!;
    expect(extractNostrFromValue(addr, { nostr: { names: { _: PK1 } } })).toEqual({ pubkey: PK1 });
  });

  it("extracts pubkey from the id/ namespace via `pubkey` field", () => {
    const addr = parseNamecoinAddress("id/alice")!;
    const value = { nostr: { pubkey: PK1, relays: ["wss://relay.example.com"] } };
    expect(extractNostrFromValue(addr, value)).toEqual({
      pubkey: PK1,
      relays: ["wss://relay.example.com"],
    });
  });

  it("extracts pubkey from the id/ namespace via `names._` fallback", () => {
    const addr = parseNamecoinAddress("id/alice")!;
    expect(extractNostrFromValue(addr, { nostr: { names: { _: PK1 } } })).toEqual({ pubkey: PK1 });
  });

  it("returns null when the nostr field is missing or invalid", () => {
    const addr = parseNamecoinAddress("example.bit")!;
    expect(extractNostrFromValue(addr, { ip: "1.2.3.4" })).toBeNull();
    expect(extractNostrFromValue(addr, { nostr: "not-a-hex-pubkey" })).toBeNull();
    expect(extractNostrFromValue(addr, null)).toBeNull();
  });
});

describe("getIdentityFromNamecoinValue", () => {
  it("returns a KnownIdentity for a valid value", () => {
    const addr = parseNamecoinAddress("alice@example.bit")!;
    const identity = getIdentityFromNamecoinValue(addr, { nostr: { names: { alice: PK1 } } }, 123);
    expect(identity).toEqual({
      name: "alice",
      domain: "d/example",
      checked: 123,
      status: IdentityStatus.Found,
      pubkey: PK1,
      relays: undefined,
      hasNip46: false,
      nip46Relays: undefined,
    });
  });

  it("returns a MissingIdentity when nothing matches", () => {
    const addr = parseNamecoinAddress("alice@example.bit")!;
    const identity = getIdentityFromNamecoinValue(addr, { ip: "1.2.3.4" }, 456);
    expect(identity).toEqual({
      name: "alice",
      domain: "d/example",
      checked: 456,
      status: IdentityStatus.Missing,
    });
  });
});

describe("buildNameIndexScript", () => {
  it("emits OP_NAME_UPDATE <push(name)> <push(empty)> OP_2DROP OP_DROP OP_RETURN", () => {
    const script = buildNameIndexScript(new TextEncoder().encode("d/example"));
    expect(script[0]).toBe(OP_NAME_UPDATE);
    expect(script[1]).toBe(9);
    expect(new TextDecoder().decode(script.slice(2, 11))).toBe("d/example");
    expect(script[11]).toBe(0x00);
    expect(script[12]).toBe(OP_2DROP);
    expect(script[13]).toBe(OP_DROP);
    expect(script[14]).toBe(OP_RETURN);
  });
});

describe("electrumScriptHash", () => {
  it("is lowercase hex of length 64 and reversing it recovers SHA-256", () => {
    const script = buildNameIndexScript(new TextEncoder().encode("d/example"));
    const h = electrumScriptHash(script);
    expect(h).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(h)).toBe(true);

    const forward = sha256(script);
    const rebuilt = new Uint8Array(32);
    for (let i = 0; i < 32; i++) rebuilt[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
    rebuilt.reverse();
    expect(rebuilt).toEqual(forward);
  });
});

describe("parseNameUpdateScript", () => {
  it("decodes a direct-push value", () => {
    const script = new Uint8Array([
      OP_NAME_UPDATE,
      9,
      ...new TextEncoder().encode("d/example"),
      2,
      ...new TextEncoder().encode("{}"),
      OP_2DROP,
      OP_DROP,
      0x76,
      0xa9,
      0x14,
      0xde,
      0xad,
      0xbe,
      0xef,
    ]);
    const parsed = parseNameUpdateScript(script);
    expect(parsed).not.toBeNull();
    expect(new TextDecoder().decode(parsed!.name)).toBe("d/example");
    expect(new TextDecoder().decode(parsed!.value)).toBe("{}");
  });

  it("decodes an OP_PUSHDATA1-framed value", () => {
    const value = new Uint8Array(200).fill(0x61);
    const script = new Uint8Array([
      OP_NAME_UPDATE,
      9,
      ...new TextEncoder().encode("d/example"),
      OP_PUSHDATA1,
      200,
      ...value,
      OP_2DROP,
      OP_DROP,
    ]);
    const parsed = parseNameUpdateScript(script);
    expect(parsed).not.toBeNull();
    expect(new TextDecoder().decode(parsed!.name)).toBe("d/example");
    expect(parsed!.value).toEqual(value);
  });

  it("rejects non-NAME_UPDATE scripts", () => {
    expect(parseNameUpdateScript(new Uint8Array([0x76, 0xa9]))).toBeNull();
    expect(parseNameUpdateScript(new Uint8Array([]))).toBeNull();
  });
});

describe("DEFAULT_ELECTRUMX_SERVERS", () => {
  it("ships a non-empty, well-formed list", () => {
    expect(DEFAULT_ELECTRUMX_SERVERS.length).toBeGreaterThan(0);
    for (const s of DEFAULT_ELECTRUMX_SERVERS) {
      expect(s.host).toBeTruthy();
      expect(s.portTcpTls).toBeGreaterThan(0);
      expect(s.portWss).toBeGreaterThan(0);
    }
  });
});

// -----------------------------------------------------------------------------
// expandImports: ifa-0001 §"import" chain resolution.
// -----------------------------------------------------------------------------

describe("expandImports", () => {
  it("returns the object unchanged and performs no lookups when no `import` key is present", async () => {
    const obj = { ip: "1.2.3.4" } as Record<string, unknown>;
    const lookup = vi.fn(async () => {
      throw new Error("must not be called");
    });
    const expanded = await expandImports(obj, lookup);
    expect(expanded).toBe(obj);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("accepts the bare-string shorthand and merges imported items", async () => {
    const lookup = vi.fn(async (name: string) =>
      name === "d/lib" ? JSON.stringify({ ip: "9.9.9.9", nostr: { names: { _: "abc" } } }) : null,
    );
    const expanded = await expandImports({ import: "d/lib", ip: "1.1.1.1" }, lookup);
    // importer wins on `ip`
    expect(expanded.ip).toBe("1.1.1.1");
    expect(expanded.nostr).toEqual({ names: { _: "abc" } });
    expect("import" in expanded).toBe(false);
  });

  it("accepts the single-element array shorthand", async () => {
    const lookup = vi.fn(async (name: string) => (name === "d/lib" ? JSON.stringify({ tag: "from-lib" }) : null));
    const expanded = await expandImports({ import: ["d/lib"] }, lookup);
    expect(expanded.tag).toBe("from-lib");
  });

  it("accepts the pair-array shorthand with a subdomain selector", async () => {
    const lookup = vi.fn(async (name: string) =>
      name === "d/lib" ? JSON.stringify({ ip: "1.1.1.1", map: { relay: { ip: "7.7.7.7", tag: "selected" } } }) : null,
    );
    const expanded = await expandImports({ import: ["d/lib", "relay"] }, lookup);
    // Descended into map.relay, so the importer sees ip=7.7.7.7, not 1.1.1.1.
    expect(expanded.ip).toBe("7.7.7.7");
    expect(expanded.tag).toBe("selected");
  });

  it("accepts the canonical array-of-arrays form and merges left-to-right", async () => {
    const lookup = vi.fn(async (name: string) => {
      if (name === "d/a") return JSON.stringify({ ip: "10.0.0.1", tag: "from-a" });
      if (name === "d/b") return JSON.stringify({ ip: "10.0.0.2", extra: "from-b" });
      return null;
    });
    const expanded = await expandImports({ import: [["d/a"], ["d/b"]] }, lookup);
    // d/b processed AFTER d/a; importer has no `ip`, so d/b's wins.
    expect(expanded.ip).toBe("10.0.0.2");
    expect(expanded.tag).toBe("from-a");
    expect(expanded.extra).toBe("from-b");
  });

  it("lets the importing object override imported keys", async () => {
    const lookup = vi.fn(async () => JSON.stringify({ ip: "9.9.9.9", extra: "remote", "only-imported": "yes" }));
    const expanded = await expandImports({ import: "d/lib", ip: "1.1.1.1", extra: "local" }, lookup);
    expect(expanded.ip).toBe("1.1.1.1");
    expect(expanded.extra).toBe("local");
    expect(expanded["only-imported"]).toBe("yes");
  });

  it("treats a `null` value in the importer as semantic suppression", async () => {
    const lookup = vi.fn(async () => JSON.stringify({ ip: "9.9.9.9", other: "keep" }));
    const expanded = await expandImports({ import: "d/lib", ip: null }, lookup);
    // `ip` survives as JSON null (downstream extractors treat null as absent).
    expect("ip" in expanded).toBe(true);
    expect(expanded.ip).toBeNull();
    expect(expanded.other).toBe("keep");
  });

  it("supports the spec-mandated depth-4 happy path", async () => {
    const lookup = vi.fn(async (name: string) => {
      if (name === "d/a") return JSON.stringify({ import: "d/b", layer: "a" });
      if (name === "d/b") return JSON.stringify({ import: "d/c", layer: "b" });
      if (name === "d/c") return JSON.stringify({ import: "d/d", layer: "c" });
      if (name === "d/d") return JSON.stringify({ layer: "d", deep: "reached" });
      return null;
    });
    const expanded = await expandImports({ import: "d/a" }, lookup);
    // Each layer overrides `layer`; the top-most "a" wins.
    expect(expanded.layer).toBe("a");
    expect(expanded.deep).toBe("reached");
  });

  it("silently truncates chains beyond the depth budget while keeping the importer's own fields", async () => {
    const lookup = vi.fn(async (name: string) => {
      if (name === "d/a") return JSON.stringify({ import: "d/b", tag: "from-a" });
      if (name === "d/b") return JSON.stringify({ tag: "from-b", leaf: "wont-show" });
      return null;
    });
    const expanded = await expandImports({ import: "d/a", local: "keep" }, lookup, 1);
    expect(expanded.tag).toBe("from-a");
    expect(expanded.local).toBe("keep");
    expect("leaf" in expanded).toBe(false);
  });

  it("treats a lookup returning null as the empty object", async () => {
    const lookup = vi.fn(async () => null);
    const expanded = await expandImports({ import: "d/missing", local: "survives" }, lookup);
    expect(expanded.local).toBe("survives");
    expect("import" in expanded).toBe(false);
  });

  it("treats a lookup that throws as the empty object", async () => {
    const lookup = vi.fn(async () => {
      throw new Error("electrumx down");
    });
    const expanded = await expandImports({ import: "d/missing", local: "survives" }, lookup);
    expect(expanded.local).toBe("survives");
  });

  it("treats malformed imported JSON as the empty object", async () => {
    const lookup = vi.fn(async () => "not valid json {{{");
    const expanded = await expandImports({ import: "d/broken", local: "keep" }, lookup);
    expect(expanded.local).toBe("keep");
  });

  it("ignores malformed `import` values and still drops the key", async () => {
    const lookup = vi.fn(async () => {
      throw new Error("must not be called");
    });
    const expanded = await expandImports({ import: 42, local: "keep" } as unknown as Record<string, unknown>, lookup);
    expect(expanded.local).toBe("keep");
    expect("import" in expanded).toBe(false);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("breaks A -> B -> A cycles without infinite recursion", async () => {
    const lookup = vi.fn(async (name: string) => {
      if (name === "d/a") return JSON.stringify({ import: "d/b", fromA: "yes" });
      if (name === "d/b") return JSON.stringify({ import: "d/a", fromB: "yes" });
      return null;
    });
    const expanded = await expandImports({ import: "d/a", local: "top" }, lookup);
    expect(expanded.local).toBe("top");
    expect("fromA" in expanded || "fromB" in expanded).toBe(true);
  });

  it("descends multi-label selectors in DNS order", async () => {
    const lookup = vi.fn(async (name: string) =>
      name === "d/lib" ? JSON.stringify({ map: { b: { map: { a: { value: "deep" } } } } }) : null,
    );
    const expanded = await expandImports({ import: [["d/lib", "a.b"]] }, lookup);
    expect(expanded.value).toBe("deep");
  });

  it("falls back to the `*` wildcard when an exact label is missing", async () => {
    const lookup = vi.fn(async (name: string) =>
      name === "d/lib" ? JSON.stringify({ map: { "*": { value: "wildcard" } } }) : null,
    );
    const expanded = await expandImports({ import: ["d/lib", "ghost"] }, lookup);
    expect(expanded.value).toBe("wildcard");
  });
});
