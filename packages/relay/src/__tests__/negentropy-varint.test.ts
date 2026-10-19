// The varint codec is the only place relay-controlled negentropy bytes are turned into numbers.
// These pin the safety bounds: no 32-bit wrap, no silent truncation, and hard rejection of
// values a peer has no legitimate reason to send.
import { describe, expect, it } from "vitest";

import { decodeVarInt, encodeVarInt } from "../lib/negentropy.js";

/** Minimal duck-typed WrappedBuffer over a byte array */
function buf(bytes: number[]): any {
  const queue = [...bytes];
  return {
    get length() {
      return queue.length;
    },
    shift() {
      return queue.shift()!;
    },
  };
}

describe("encodeVarInt", () => {
  it("round-trips representative values", () => {
    for (const value of [0, 1, 127, 128, 16383, 16384, 2 ** 31 - 1, 2 ** 31, 2 ** 53 - 1]) {
      const encoded = encodeVarInt(value);
      const decoded = decodeVarInt(buf(Array.from(encoded._raw)));
      expect(decoded).toBe(value);
    }
  });

  it("uses the full byte for values above 127", () => {
    // 128 encodes as two big-endian base-128 bytes: [0x81 continuation][0x00 payload]
    expect(Array.from(encodeVarInt(128)._raw)).toEqual([0x81, 0x00]);
  });

  it("rejects values that cannot be represented exactly", () => {
    expect(() => encodeVarInt(-1)).toThrow();
    expect(() => encodeVarInt(2 ** 53)).toThrow();
    expect(() => encodeVarInt(1.5)).toThrow();
    expect(() => encodeVarInt(NaN)).toThrow();
    expect(() => encodeVarInt(Infinity)).toThrow();
  });
});

describe("decodeVarInt", () => {
  it("decodes multi-byte varints exactly", () => {
    // 2^31 - 1 needs five big-endian base-128 bytes and used to wrap under a 32-bit shift
    expect(decodeVarInt(buf([0x87, 0xff, 0xff, 0xff, 0x7f]))).toBe(2 ** 31 - 1);
    expect(decodeVarInt(buf([0xff, 0xff, 0xff, 0xff, 0x7f]))).toBe(2 ** 35 - 1);
  });

  it("rejects varints long enough to exceed a safe integer", () => {
    // Eight continuation bytes is more payload bits than a safe integer holds
    expect(() => decodeVarInt(buf(Array(9).fill(0xff)))).toThrow();
  });

  it("rejects overlong zero padding", () => {
    expect(() => decodeVarInt(buf([...Array(8).fill(0x80), 0]))).toThrow("varint too long");
  });

  it("rejects truncated input", () => {
    expect(() => decodeVarInt(buf([0x80]))).toThrow("parse ends prematurely");
  });

  it("still decodes values a peer legitimately sends", () => {
    // Fingerprint/list-size fields are far below 2^31
    expect(decodeVarInt(buf([0x02]))).toBe(2);
    expect(decodeVarInt(buf([0x82, 0x00]))).toBe(256);
  });
});
