import { describe, expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha2";

import {
  buildNameIndexScript,
  DEFAULT_ELECTRUMX_SERVERS,
  electrumScriptHash,
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
    const identity = getIdentityFromNamecoinValue(
      addr,
      { nostr: { names: { alice: PK1 } } },
      123,
    );
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
