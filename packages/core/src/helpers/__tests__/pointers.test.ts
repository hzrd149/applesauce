import { describe, expect, it } from "vitest";
import { naddrEncode, neventEncode, noteEncode, nprofileEncode, npubEncode } from "nostr-tools/nip19";
import {
  mergeAddressPointers,
  mergeEventPointers,
  mergeProfilePointers,
  normalizeToAddressPointer,
  normalizeToEventPointer,
  normalizeToProfilePointer,
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

  it("should return null on invalid hex pubkey", () => {
    expect(normalizeToPubkey("5028372")).toBeNull();
  });

  it("should return null on invalid string", () => {
    expect(normalizeToPubkey("testing")).toBeNull();
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

describe("normalizeToProfilePointer", () => {
  const testPubkey = "266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5";
  const testRelays = ["wss://relay1.example.com", "wss://relay2.example.com"];

  it("should return ProfilePointer from hex pubkey", () => {
    const result = normalizeToProfilePointer(testPubkey);
    expect(result).toEqual({
      pubkey: testPubkey.toLowerCase(),
    });
  });

  it("should return ProfilePointer from hex pubkey with uppercase", () => {
    const upperPubkey = testPubkey.toUpperCase();
    const result = normalizeToProfilePointer(upperPubkey);
    expect(result).toEqual({
      pubkey: testPubkey.toLowerCase(),
    });
  });

  it("should return ProfilePointer from npub", () => {
    const npub = npubEncode(testPubkey);
    const result = normalizeToProfilePointer(npub);
    expect(result).toEqual({
      pubkey: testPubkey,
    });
  });

  it("should return ProfilePointer from nprofile without relays", () => {
    const nprofile = nprofileEncode({
      pubkey: testPubkey,
    });
    const result = normalizeToProfilePointer(nprofile);
    expect(result).toMatchObject({
      pubkey: testPubkey,
    });
    // nprofileEncode may include empty relays array
    if (result?.relays) {
      expect(result.relays).toEqual([]);
    }
  });

  it("should return ProfilePointer from nprofile with relays", () => {
    const nprofile = nprofileEncode({
      pubkey: testPubkey,
      relays: testRelays,
    });
    const result = normalizeToProfilePointer(nprofile);
    expect(result).toEqual({
      pubkey: testPubkey,
      relays: testRelays,
    });
  });

  it("should extract pubkey from naddr and return ProfilePointer", () => {
    const naddr = naddrEncode({
      kind: 30023,
      pubkey: testPubkey,
      identifier: "test-identifier",
      relays: testRelays,
    });
    const result = normalizeToProfilePointer(naddr);
    expect(result).toEqual({
      pubkey: testPubkey,
      relays: testRelays,
    });
  });

  it("should extract pubkey from naddr without relays", () => {
    const naddr = naddrEncode({
      kind: 30023,
      pubkey: testPubkey,
      identifier: "test-identifier",
    });
    const result = normalizeToProfilePointer(naddr);
    expect(result).toMatchObject({
      pubkey: testPubkey,
    });
    // naddrEncode may include empty relays array
    if (result?.relays) {
      expect(result.relays).toEqual([]);
    }
  });

  it("should return null for invalid string", () => {
    const result = normalizeToProfilePointer("invalid-string");
    expect(result).toBeNull();
  });

  it("should return null for empty string", () => {
    const result = normalizeToProfilePointer("");
    expect(result).toBeNull();
  });

  it("should return null for note encoded string", () => {
    const note = noteEncode("abc123def4567890123456789012345678901234567890123456789012345678");
    const result = normalizeToProfilePointer(note);
    expect(result).toBeNull();
  });

  it("should return null for nevent encoded string without author", () => {
    const nevent = neventEncode({
      id: "abc123def4567890123456789012345678901234567890123456789012345678",
    });
    const result = normalizeToProfilePointer(nevent);
    expect(result).toBeNull();
  });
});

describe("normalizeToAddressPointer", () => {
  const testPubkey = "266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5";
  const testRelays = ["wss://relay1.example.com", "wss://relay2.example.com"];

  it("should parse address format (kind:pubkey:identifier)", () => {
    const address = `30023:${testPubkey}:test-identifier`;
    const result = normalizeToAddressPointer(address);
    expect(result).toEqual({
      kind: 30023,
      pubkey: testPubkey,
      identifier: "test-identifier",
    });
  });

  it("should parse address format with empty identifier", () => {
    const address = `30023:${testPubkey}:`;
    const result = normalizeToAddressPointer(address);
    expect(result).toEqual({
      kind: 30023,
      pubkey: testPubkey,
      identifier: "",
    });
  });

  it("should parse address format without identifier", () => {
    const address = `30023:${testPubkey}`;
    const result = normalizeToAddressPointer(address);
    expect(result).toEqual({
      kind: 30023,
      pubkey: testPubkey,
      identifier: "",
    });
  });

  it("should return AddressPointer from naddr", () => {
    const naddr = naddrEncode({
      kind: 30023,
      pubkey: testPubkey,
      identifier: "test-identifier",
      relays: testRelays,
    });
    const result = normalizeToAddressPointer(naddr);
    expect(result).toEqual({
      kind: 30023,
      pubkey: testPubkey,
      identifier: "test-identifier",
      relays: testRelays,
    });
  });

  it("should return AddressPointer from naddr without relays", () => {
    const naddr = naddrEncode({
      kind: 30023,
      pubkey: testPubkey,
      identifier: "test-identifier",
    });
    const result = normalizeToAddressPointer(naddr);
    expect(result).toMatchObject({
      kind: 30023,
      pubkey: testPubkey,
      identifier: "test-identifier",
    });
    // naddrEncode may include empty relays array
    if (result?.relays) {
      expect(result.relays).toEqual([]);
    }
  });

  it("should return null for npub", () => {
    const npub = npubEncode(testPubkey);
    const result = normalizeToAddressPointer(npub);
    expect(result).toBeNull();
  });

  it("should return null for nprofile", () => {
    const nprofile = nprofileEncode({
      pubkey: testPubkey,
    });
    const result = normalizeToAddressPointer(nprofile);
    expect(result).toBeNull();
  });

  it("should return null for note", () => {
    const note = noteEncode("abc123def4567890123456789012345678901234567890123456789012345678");
    const result = normalizeToAddressPointer(note);
    expect(result).toBeNull();
  });

  it("should return null for nevent", () => {
    const nevent = neventEncode({
      id: "abc123def4567890123456789012345678901234567890123456789012345678",
    });
    const result = normalizeToAddressPointer(nevent);
    expect(result).toBeNull();
  });

  it("should return null for invalid string", () => {
    const result = normalizeToAddressPointer("invalid-string");
    expect(result).toBeNull();
  });

  it("should return null for empty string", () => {
    const result = normalizeToAddressPointer("");
    expect(result).toBeNull();
  });

  it("should return null for hex pubkey without colons", () => {
    const result = normalizeToAddressPointer(testPubkey);
    expect(result).toBeNull();
  });

  it("should handle address format with identifier containing colons", () => {
    const address = `30023:${testPubkey}:part1:part2:part3`;
    const result = normalizeToAddressPointer(address);
    expect(result).toEqual({
      kind: 30023,
      pubkey: testPubkey,
      identifier: "part1:part2:part3",
    });
  });
});

describe("normalizeToEventPointer", () => {
  const testEventId = "abc123def4567890123456789012345678901234567890123456789012345678";
  const testPubkey = "266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5";
  const testRelays = ["wss://relay1.example.com", "wss://relay2.example.com"];

  it("should return EventPointer from hex event id", () => {
    const result = normalizeToEventPointer(testEventId);
    expect(result).toEqual({
      id: testEventId.toLowerCase(),
    });
  });

  it("should return EventPointer from hex event id with uppercase", () => {
    const upperEventId = testEventId.toUpperCase();
    const result = normalizeToEventPointer(upperEventId);
    expect(result).toEqual({
      id: testEventId.toLowerCase(),
    });
  });

  it("should return EventPointer from note", () => {
    const note = noteEncode(testEventId);
    const result = normalizeToEventPointer(note);
    expect(result).toEqual({
      id: testEventId,
    });
  });

  it("should return EventPointer from nevent without optional fields", () => {
    const nevent = neventEncode({
      id: testEventId,
    });
    const result = normalizeToEventPointer(nevent);
    expect(result).toMatchObject({
      id: testEventId,
    });
    // neventEncode may include undefined/empty optional fields
    expect(result?.id).toBe(testEventId);
  });

  it("should return EventPointer from nevent with relays", () => {
    const nevent = neventEncode({
      id: testEventId,
      relays: testRelays,
    });
    const result = normalizeToEventPointer(nevent);
    expect(result).toEqual({
      id: testEventId,
      relays: testRelays,
    });
  });

  it("should return EventPointer from nevent with kind", () => {
    const nevent = neventEncode({
      id: testEventId,
      kind: 1,
    });
    const result = normalizeToEventPointer(nevent);
    expect(result).toMatchObject({
      id: testEventId,
      kind: 1,
    });
    // neventEncode may include undefined/empty optional fields
    expect(result?.id).toBe(testEventId);
    expect(result?.kind).toBe(1);
  });

  it("should return EventPointer from nevent with author", () => {
    const nevent = neventEncode({
      id: testEventId,
      author: testPubkey,
    });
    const result = normalizeToEventPointer(nevent);
    expect(result).toMatchObject({
      id: testEventId,
      author: testPubkey,
    });
    // neventEncode may include undefined/empty optional fields
    expect(result?.id).toBe(testEventId);
    expect(result?.author).toBe(testPubkey);
  });

  it("should return EventPointer from nevent with all fields", () => {
    const nevent = neventEncode({
      id: testEventId,
      kind: 1,
      author: testPubkey,
      relays: testRelays,
    });
    const result = normalizeToEventPointer(nevent);
    expect(result).toEqual({
      id: testEventId,
      kind: 1,
      author: testPubkey,
      relays: testRelays,
    });
  });

  it("should return null for npub", () => {
    const npub = npubEncode(testPubkey);
    const result = normalizeToEventPointer(npub);
    expect(result).toBeNull();
  });

  it("should return null for nprofile", () => {
    const nprofile = nprofileEncode({
      pubkey: testPubkey,
    });
    const result = normalizeToEventPointer(nprofile);
    expect(result).toBeNull();
  });

  it("should return null for naddr", () => {
    const naddr = naddrEncode({
      kind: 30023,
      pubkey: testPubkey,
      identifier: "test-identifier",
    });
    const result = normalizeToEventPointer(naddr);
    expect(result).toBeNull();
  });

  it("should return null for invalid string", () => {
    const result = normalizeToEventPointer("invalid-string");
    expect(result).toBeNull();
  });

  it("should return null for empty string", () => {
    const result = normalizeToEventPointer("");
    expect(result).toBeNull();
  });

  it("should return null for address format string", () => {
    const address = `30023:${testPubkey}:identifier`;
    const result = normalizeToEventPointer(address);
    expect(result).toBeNull();
  });

  it("should return null for invalid hex key (too short)", () => {
    const result = normalizeToEventPointer("abc123");
    expect(result).toBeNull();
  });
});
