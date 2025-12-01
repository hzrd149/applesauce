import { describe, expect, it } from "vitest";
import { mergeAddressPointers, mergeEventPointers, mergeProfilePointers, normalizeToPubkey } from "../pointers.js";

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
