import { describe, expect, it } from "vitest";
import { estimateHllCardinality, mergeHllRegisters, parseRelayCountResponse, RelayCountResponseError } from "../nip45.js";

const sketch = (values: number[]) => values.map((value) => value.toString(16).padStart(2, "0")).join("");

describe("NIP-45", () => {
  it("validates and safely copies COUNT responses", () => {
    const source = JSON.parse(`{"count":0,"approximate":false,"hll":"${"AA".repeat(256)}","__proto__":{"polluted":true},"future":1}`);
    const result = parseRelayCountResponse(source);
    expect(result).toMatchObject({ count: 0, approximate: false, hll: "aa".repeat(256), future: 1 });
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    expect((result as any).polluted).toBeUndefined();
  });

  it.each([null, [], {}, { count: -1 }, { count: 1.5 }, { count: "1" }, { count: Number.MAX_SAFE_INTEGER + 1 }, { count: 1, approximate: 1 }, { count: 1, hll: "00" }])("rejects malformed response %j", (value) => {
    expect(() => parseRelayCountResponse(value)).toThrow(RelayCountResponseError);
  });

  it("merges registers by maximum without mutating inputs", () => {
    const a = sketch([1, 0, 3, ...Array(253).fill(0)]);
    const b = sketch([0, 2, 3, ...Array(253).fill(0)]).toUpperCase();
    const inputs = Object.freeze([a, b]);
    expect(mergeHllRegisters(inputs)).toBe(sketch([1, 2, 3, ...Array(253).fill(0)]));
    expect(inputs).toEqual([a, b]);
    expect(() => mergeHllRegisters([])).toThrow(RelayCountResponseError);
  });

  it("estimates independently locked register fixtures", () => {
    expect(estimateHllCardinality("00".repeat(256))).toBe(0);
    expect(estimateHllCardinality(sketch([1, ...Array(255).fill(0)]))).toBeCloseTo(1.0019582262108966, 10);
    expect(estimateHllCardinality("01".repeat(128) + "00".repeat(128))).toBeCloseTo(177.445678223346, 10);
    expect(estimateHllCardinality("01".repeat(256))).toBeCloseTo(367.7555677437675, 10);
    expect(estimateHllCardinality("02".repeat(256))).toBeCloseTo(735.511135487535, 10);
  });
});
