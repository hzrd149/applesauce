import { describe, expect, it } from "vitest";
import {
  mergeAddressPointers,
  mergeEventPointers,
  mergeProfilePointers,
  normalizeToPubkey,
  parseReplaceableAddress,
} from "../pointers.js";

describe("normalizeToPubkey", () => {
  it("should get pubkey from npub", () => {
    expect(normalizeToPubkey("npub1ye5ptcxfyyxl5vjvdjar2ua3f0hynkjzpx552mu5snj3qmx5pzjscpknpr")).toEqual(
      "266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5",
    );
  });

  it("should get pubkey from nprofile", () => {
    expect(
      normalizeToPubkey(
        "nprofile1qyw8wumn8ghj7umpw3jkcmrfw3jju6r6wfjrzdpe9e3k7mf0qyf8wumn8ghj7mn0wd68yat99e3k7mf0qqszv6q4uryjzr06xfxxew34wwc5hmjfmfpqn229d72gfegsdn2q3fg5g7lja",
      ),
    ).toEqual("266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5");
  });

  it("should return hex pubkey", () => {
    expect(normalizeToPubkey("266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5")).toEqual(
      "266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5",
    );
  });

  it("should throw on invalid hex pubkey", () => {
    expect(() => {
      normalizeToPubkey("5028372");
    }).toThrow();
  });

  it("should throw on invalid string", () => {
    expect(() => {
      normalizeToPubkey("testing");
    }).toThrow();
  });
});

describe("mergeEventPointers", () => {
  it("should merge event pointers with same id", () => {
    const a = { id: "abc", kind: 1, relays: ["wss://1.com/"] };
    const b = { id: "abc", kind: 2, relays: ["wss://2.com/"] };

    expect(mergeEventPointers(a, b)).toEqual({
      id: "abc",
      kind: 1,
      relays: ["wss://1.com/", "wss://2.com/"],
    });
  });

  it("should use kind from second pointer if first is undefined", () => {
    const a = { id: "abc", relays: ["wss://1.com/"] };
    const b = { id: "abc", kind: 2, relays: ["wss://2.com/"] };

    expect(mergeEventPointers(a, b)).toEqual({
      id: "abc",
      kind: 2,
      relays: ["wss://1.com/", "wss://2.com/"],
    });
  });

  it("should merge author field", () => {
    const a = { id: "abc", author: "123", relays: ["wss://1.com/"] };
    const b = { id: "abc", relays: ["wss://2.com/"] };

    expect(mergeEventPointers(a, b)).toEqual({
      id: "abc",
      author: "123",
      relays: ["wss://1.com/", "wss://2.com/"],
    });
  });

  it("should throw if ids are different", () => {
    const a = { id: "abc", relays: ["wss://1.com/"] };
    const b = { id: "def", relays: ["wss://2.com/"] };

    expect(() => mergeEventPointers(a, b)).toThrow("Cant merge event pointers with different ids");
  });
});

describe("mergeAddressPointers", () => {
  it("should merge address pointers with same values", () => {
    const a = { kind: 1, pubkey: "123", identifier: "test", relays: ["wss://1.com/"] };
    const b = { kind: 1, pubkey: "123", identifier: "test", relays: ["wss://2.com/"] };

    expect(mergeAddressPointers(a, b)).toEqual({
      kind: 1,
      pubkey: "123",
      identifier: "test",
      relays: ["wss://1.com/", "wss://2.com/"],
    });
  });

  it("should throw if kinds are different", () => {
    const a = { kind: 1, pubkey: "123", identifier: "test", relays: [] };
    const b = { kind: 2, pubkey: "123", identifier: "test", relays: [] };

    expect(() => mergeAddressPointers(a, b)).toThrow(
      "Cant merge address pointers with different kinds, pubkeys, or identifiers",
    );
  });

  it("should throw if pubkeys are different", () => {
    const a = { kind: 1, pubkey: "123", identifier: "test", relays: [] };
    const b = { kind: 1, pubkey: "456", identifier: "test", relays: [] };

    expect(() => mergeAddressPointers(a, b)).toThrow(
      "Cant merge address pointers with different kinds, pubkeys, or identifiers",
    );
  });

  it("should throw if identifiers are different", () => {
    const a = { kind: 1, pubkey: "123", identifier: "test1", relays: [] };
    const b = { kind: 1, pubkey: "123", identifier: "test2", relays: [] };

    expect(() => mergeAddressPointers(a, b)).toThrow(
      "Cant merge address pointers with different kinds, pubkeys, or identifiers",
    );
  });
});

describe("mergeProfilePointers", () => {
  it("should merge profile pointers with same pubkey", () => {
    const a = { pubkey: "123", relays: ["wss://1.com/"] };
    const b = { pubkey: "123", relays: ["wss://2.com/"] };

    expect(mergeProfilePointers(a, b)).toEqual({
      pubkey: "123",
      relays: ["wss://1.com/", "wss://2.com/"],
    });
  });

  it("should throw if pubkeys are different", () => {
    const a = { pubkey: "123", relays: [] };
    const b = { pubkey: "456", relays: [] };

    expect(() => mergeProfilePointers(a, b)).toThrow("Cant merge profile pointers with different pubkeys");
  });
});

describe("parseReplaceableAddress", () => {
  const validPubkey = "266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5";

  it("should parse valid coordinate with all parts", () => {
    const result = parseReplaceableAddress(`30023:${validPubkey}:test-identifier`);
    expect(result).toEqual({
      kind: 30023,
      pubkey: validPubkey,
      identifier: "test-identifier",
    });
  });

  it("should parse coordinate with empty identifier when requireIdentifier is false", () => {
    const result = parseReplaceableAddress(`30023:${validPubkey}:`, false);
    expect(result).toEqual({
      kind: 30023,
      pubkey: validPubkey,
      identifier: "",
    });
  });

  it("should parse coordinate without identifier part when requireIdentifier is false", () => {
    const result = parseReplaceableAddress(`30023:${validPubkey}`, false);
    expect(result).toEqual({
      kind: 30023,
      pubkey: validPubkey,
      identifier: "",
    });
  });

  it("should return null when requireIdentifier is true and identifier is empty", () => {
    const result = parseReplaceableAddress(`30023:${validPubkey}:`, true);
    expect(result).toBeNull();
  });

  it("should return null when requireIdentifier is true and identifier is missing", () => {
    const result = parseReplaceableAddress(`30023:${validPubkey}`, true);
    expect(result).toBeNull();
  });

  it("should parse coordinate with requireIdentifier true when identifier is present", () => {
    const result = parseReplaceableAddress(`30023:${validPubkey}:my-identifier`, true);
    expect(result).toEqual({
      kind: 30023,
      pubkey: validPubkey,
      identifier: "my-identifier",
    });
  });

  it("should return null when kind is missing", () => {
    const result = parseReplaceableAddress(`:${validPubkey}:identifier`);
    expect(result).toBeNull();
  });

  it("should return null when kind is empty string", () => {
    const result = parseReplaceableAddress(`:${validPubkey}:identifier`);
    expect(result).toBeNull();
  });

  it("should parse valid numeric kind", () => {
    const result = parseReplaceableAddress(`1:${validPubkey}:identifier`);
    expect(result).toEqual({
      kind: 1,
      pubkey: validPubkey,
      identifier: "identifier",
    });
  });

  it("should return object with NaN kind when kind is not a number", () => {
    // Note: parseInt("not-a-number") returns NaN, but the function only checks for undefined
    const result = parseReplaceableAddress(`not-a-number:${validPubkey}:identifier`);
    expect(result).toEqual({
      kind: NaN,
      pubkey: validPubkey,
      identifier: "identifier",
    });
  });

  it("should return null when pubkey is missing", () => {
    const result = parseReplaceableAddress(`30023::identifier`);
    expect(result).toBeNull();
  });

  it("should return null when pubkey is empty string", () => {
    const result = parseReplaceableAddress(`30023::identifier`);
    expect(result).toBeNull();
  });

  it("should return null when pubkey is undefined", () => {
    const result = parseReplaceableAddress(`30023:`);
    expect(result).toBeNull();
  });

  it("should return null when pubkey is not a valid hex key (too short)", () => {
    const result = parseReplaceableAddress(`30023:abc123:identifier`);
    expect(result).toBeNull();
  });

  it("should return null when pubkey is not a valid hex key (too long)", () => {
    const longPubkey = validPubkey + "123";
    const result = parseReplaceableAddress(`30023:${longPubkey}:identifier`);
    expect(result).toBeNull();
  });

  it("should return null when pubkey contains invalid characters", () => {
    const invalidPubkey = "g".repeat(64);
    const result = parseReplaceableAddress(`30023:${invalidPubkey}:identifier`);
    expect(result).toBeNull();
  });

  it("should handle pubkey with uppercase hex characters", () => {
    const upperPubkey = validPubkey.toUpperCase();
    const result = parseReplaceableAddress(`30023:${upperPubkey}:identifier`);
    expect(result).toEqual({
      kind: 30023,
      pubkey: upperPubkey,
      identifier: "identifier",
    });
  });

  it("should handle identifier with special characters", () => {
    const result = parseReplaceableAddress(`30023:${validPubkey}:test_identifier-123`);
    expect(result).toEqual({
      kind: 30023,
      pubkey: validPubkey,
      identifier: "test_identifier-123",
    });
  });

  it("should only take all identifier when identifier contains colons", () => {
    // Note: split(":") splits on all colons, so parts[2] only gets the first part after the second colon
    const result = parseReplaceableAddress(`30023:${validPubkey}:part1:part2:part3`);
    expect(result).toEqual({
      kind: 30023,
      pubkey: validPubkey,
      identifier: "part1:part2:part3",
    });
  });

  it("should handle zero kind", () => {
    const result = parseReplaceableAddress(`0:${validPubkey}:identifier`);
    expect(result).toEqual({
      kind: 0,
      pubkey: validPubkey,
      identifier: "identifier",
    });
  });

  it("should handle negative kind (parsed as negative number)", () => {
    const result = parseReplaceableAddress(`-1:${validPubkey}:identifier`);
    expect(result).toEqual({
      kind: -1,
      pubkey: validPubkey,
      identifier: "identifier",
    });
  });

  it("should handle large kind numbers", () => {
    const result = parseReplaceableAddress(`99999:${validPubkey}:identifier`);
    expect(result).toEqual({
      kind: 99999,
      pubkey: validPubkey,
      identifier: "identifier",
    });
  });
});
