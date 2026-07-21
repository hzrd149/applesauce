// CORD-02 §4/§5: one clock read decomposes an event's created_at + ms tag
// (TIME-01/D-06/D-07), and rumorMs (ordering) / hasMalformedMs (fold-drop)
// must agree on every ms tag by construction, via one shared parseMs
// predicate (TIME-03/D-09).

import { describe, expect, it } from "vitest";

import type { Rumor } from "applesauce-core/helpers/event";
import { hasMalformedMs, parseMs, rumorMs } from "../stream.js";

const rumor = (created_at: number, msTag?: string): Rumor => ({
  id: "id",
  pubkey: "pk",
  created_at,
  kind: 1,
  content: "",
  tags: msTag !== undefined ? [["ms", msTag]] : [],
});

describe("parseMs", () => {
  // Canonical table: a tag string must fold and order identically under both
  // consumers, since a fuzzed ms tag must not let two honest clients disagree
  // about the Complete Memberlist for the same rumor (T-10-05).
  //
  // " 5" and "0x10" are non-vacuity cases: both PASS the old Number()-only
  // hasMalformedMs (Number(" 5") === 5, Number("0x10") === 16, both in
  // range), yet are correctly malformed under parseMs's String(n) === tag
  // round-trip, which the old parser lacked.
  it.each([
    ["42abc", null],
    ["0x10", null],
    ["007", null],
    [" 5", null],
    ["+1", null],
    ["999", 999],
    ["0", 0],
  ])("parseMs(%j) === %j, and rumorMs/hasMalformedMs agree", (tag, expected) => {
    expect(parseMs(tag)).toBe(expected);

    const r = rumor(1000, tag);
    if (expected === null) {
      // malformed: fold must drop it, ordering falls back to the second boundary
      expect(hasMalformedMs(r)).toBe(true);
      expect(rumorMs(r)).toBe(1000 * 1000);
    } else {
      // valid: fold keeps it, ordering incorporates the exact remainder
      expect(hasMalformedMs(r)).toBe(false);
      expect(rumorMs(r)).toBe(1000 * 1000 + expected);
    }
  });

  it("returns null for undefined", () => {
    expect(parseMs(undefined)).toBeNull();
  });

  it("rumorMs treats an absent ms tag as remainder 0", () => {
    const r = rumor(2000);
    expect(rumorMs(r)).toBe(2000 * 1000);
  });

  it("hasMalformedMs treats an absent ms tag as not malformed", () => {
    const r = rumor(2000);
    expect(hasMalformedMs(r)).toBe(false);
  });

  it("rumorMs is created_at*1000 + parseMs(tag) for a valid tag", () => {
    const r = rumor(1700000000, "700");
    expect(rumorMs(r)).toBe(r.created_at * 1000 + parseMs("700")!);
  });
});
