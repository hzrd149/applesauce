// Proves the vendored CORD wire fixtures' helpers are non-vacuous: an
// unbound placeholder throws (T-11-02), and tag-set comparison is
// order-independent so downstream WIRE-02/03/04/05 assertions are not
// pinned to our own composition order (T-11-01 caveat). Also proves the
// TEST-01/D-21 anchoring contract: the cap literals match the numbers
// parsed back out of their own verbatim source sentences (T-12-04), and
// exercises the citation scanner's own classification rules directly
// (T-12-05). The scanner's non-vacuity against real, live source is now
// proven by `__tests__/cord-citations.test.ts`'s package-wide guard (D-16),
// not by this file — see the note at the end of the `citationsOutsideRegistry`
// describe block below.

import { describe, expect, it } from "vitest";

import {
  citationsOutsideRegistry,
  CORD_COMMUNITY_LIST_CAP_SENTENCE,
  CORD_COMMUNITY_LIST_MEMBERSHIP_CAP,
  CORD_EXAMPLES_CAVEAT,
  CORD_METADATA_CAP_SENTENCE,
  CORD_METADATA_CAPS,
  CORD_REPLY_ROOT_INHERITANCE_RULE,
  CORD_TARGET_KIND_RULE,
  DELETE_KIND5_EXAMPLE,
  missingFixtureTags,
  MULTIBYTE_ASTRAL_CHAR,
  multiByteStringOfBytes,
  multiByteStringOverBytes,
  REACTION_KIND7_EXAMPLE,
  substituteFixtureTags,
  tagValues,
  THREADED_REPLY_KIND1111_EXAMPLE,
  utf8Bytes,
  VOICE_PRESENCE_JOINED_EXAMPLE,
  VOICE_PRESENCE_LEFT_EXAMPLE,
} from "./cord-wire-fixtures.js";

describe("substituteFixtureTags", () => {
  it("throws naming the unresolved token when a placeholder has no binding", () => {
    expect(() => substituteFixtureTags(REACTION_KIND7_EXAMPLE.tags, {})).toThrow("<channel_id>");
  });

  it("passes non-placeholder elements through byte-identical", () => {
    const substituted = substituteFixtureTags(THREADED_REPLY_KIND1111_EXAMPLE.tags, {
      "<channel_id>": "chan1",
      "<thread root rumor id>": "root-id",
      "<root author>": "root-pk",
      "<immediate parent rumor id>": "parent-id",
      "<parent author>": "parent-pk",
    });

    const kTag = substituted.find((tag) => tag[0] === "K");
    expect(kTag?.[1]).toBe("9");

    const eTagUpper = substituted.find((tag) => tag[0] === "E");
    expect(eTagUpper).toHaveLength(4);
    expect(eTagUpper?.[2]).toBe("");
  });
});

describe("missingFixtureTags", () => {
  it("returns empty when actual contains every expected tag in a different order with extras interleaved", () => {
    const expected = REACTION_KIND7_EXAMPLE.tags;
    const actual = [
      ["k", "9"],
      ["unrelated", "extra"],
      ["p", "<message author>"],
      ["channel", "<channel_id>"],
      ["ms", "112"],
      ["another", "extra-tag"],
      ["e", "<message rumor id>"],
      ["epoch", "0"],
    ];

    expect(missingFixtureTags(actual, expected)).toEqual([]);
  });

  it("returns the offending tag when a value differs", () => {
    const expected = [["k", "9"]];
    const actual = [["k", "1111"]];

    expect(missingFixtureTags(actual, expected)).toEqual([["k", "9"]]);
  });

  it("returns the offending tag when it is absent entirely", () => {
    const expected = [
      ["channel", "<channel_id>"],
      ["k", "9"],
    ];
    const actual = [["channel", "<channel_id>"]];

    expect(missingFixtureTags(actual, expected)).toEqual([["k", "9"]]);
  });
});

describe("tagValues", () => {
  it("returns every value for a repeated tag name in encounter order", () => {
    const tags = [
      ["e", "first"],
      ["p", "someone"],
      ["e", "second"],
    ];

    expect(tagValues(tags, "e")).toEqual(["first", "second"]);
  });

  it("returns an empty array for a name that is not present", () => {
    expect(tagValues(REACTION_KIND7_EXAMPLE.tags, "missing")).toEqual([]);
  });
});

describe("vendored fixture shape", () => {
  const examples = [
    REACTION_KIND7_EXAMPLE,
    THREADED_REPLY_KIND1111_EXAMPLE,
    DELETE_KIND5_EXAMPLE,
    VOICE_PRESENCE_JOINED_EXAMPLE,
    VOICE_PRESENCE_LEFT_EXAMPLE,
  ];

  it.each(examples)("$section carries a resolvable citation and non-empty tags", (example) => {
    expect(example.section).toMatch(/examples\.md §\d/);
    expect(example.tags.length).toBeGreaterThan(0);
    for (const tag of example.tags) {
      expect(tag.length).toBeGreaterThan(0);
      for (const element of tag) expect(typeof element).toBe("string");
    }
  });

  it("exports non-empty caveat and prose rule constants", () => {
    expect(CORD_EXAMPLES_CAVEAT.length).toBeGreaterThan(0);
    expect(CORD_REPLY_ROOT_INHERITANCE_RULE.length).toBeGreaterThan(0);
    expect(CORD_TARGET_KIND_RULE.length).toBeGreaterThan(0);
  });
});

describe("CORD_METADATA_CAPS cap-literal round-trip (TEST-01 / D-21)", () => {
  it("equals the two byte counts parsed back out of CORD_METADATA_CAP_SENTENCE", () => {
    const parsed = [...CORD_METADATA_CAP_SENTENCE.matchAll(/(\d+) bytes/g)].map((m) => Number(m[1]));

    expect(parsed).toEqual([CORD_METADATA_CAPS.nameBytes, CORD_METADATA_CAPS.descriptionBytes]);
  });
});

describe("CORD_COMMUNITY_LIST_MEMBERSHIP_CAP cap-literal round-trip (TEST-01 / D-21)", () => {
  it("equals the membership count parsed back out of CORD_COMMUNITY_LIST_CAP_SENTENCE", () => {
    const match = CORD_COMMUNITY_LIST_CAP_SENTENCE.match(/(\d+) memberships/);

    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(CORD_COMMUNITY_LIST_MEMBERSHIP_CAP);
  });
});

describe("MULTIBYTE_ASTRAL_CHAR", () => {
  it("is 2 UTF-16 code units and 4 UTF-8 bytes, diverging from each other", () => {
    expect(MULTIBYTE_ASTRAL_CHAR.length).toBe(2);
    expect(utf8Bytes(MULTIBYTE_ASTRAL_CHAR)).toBe(4);
    expect(MULTIBYTE_ASTRAL_CHAR.length).not.toBe(utf8Bytes(MULTIBYTE_ASTRAL_CHAR));
  });
});

describe("multiByteStringOfBytes", () => {
  it("produces a string of exactly 64 UTF-8 bytes whose UTF-16 length diverges", () => {
    const s = multiByteStringOfBytes(64);

    expect(utf8Bytes(s)).toBe(64);
    expect(s.length).not.toBe(utf8Bytes(s));
  });

  it("produces a string of exactly 10000 UTF-8 bytes", () => {
    const s = multiByteStringOfBytes(10000);

    expect(utf8Bytes(s)).toBe(10000);
    expect(s.length).not.toBe(utf8Bytes(s));
  });

  it("throws for a non-multiple of 4", () => {
    expect(() => multiByteStringOfBytes(65)).toThrow();
  });
});

describe("multiByteStringOverBytes", () => {
  it("produces the shortest string strictly over 64 UTF-8 bytes, diverging from UTF-16 length", () => {
    const s = multiByteStringOverBytes(64);

    expect(utf8Bytes(s)).toBeGreaterThan(64);
    expect(s.length).not.toBe(utf8Bytes(s));
  });
});

describe("citationsOutsideRegistry", () => {
  it("accepts CORD-01's named section, a section range, and CORD-02's named appendix", () => {
    const text = "See CORD-01 §Deletions and CORD-05 §1-2, per CORD-02 §Appendix B.";

    expect(citationsOutsideRegistry(text)).toEqual([]);
  });

  it("reports a section number that is in range for a different document (CORD-07, not CORD-06)", () => {
    expect(citationsOutsideRegistry("see CORD-06 §7 for details")).toEqual(["CORD-06 §7"]);
  });

  it("reports an unknown document", () => {
    expect(citationsOutsideRegistry("see CORD-09 §1 for details")).toEqual(["CORD-09 §1"]);
  });

  it("reports an invalid citation written immediately before a colon", () => {
    expect(citationsOutsideRegistry("CORD-06 §7: not a real section")).toEqual(["CORD-06 §7"]);
  });

  // The non-vacuity test that lived here (D-16 requirement) scanned the four
  // files carrying this phase's twelve invalid `CORD-06 §94` / `CORD-03 §44`
  // citations and asserted the invalid set was non-empty — proof the scanner
  // was non-vacuous against real source before plan 12-06's sweep edited
  // anything. Plan 12-06 swept all twelve sites (now `CORD-06 §3` /
  // `CORD-03 §3`) and removed this test rather than inverting it: an
  // inverted "these four files are now clean" assertion would merely
  // duplicate a subset of `__tests__/cord-citations.test.ts`'s package-wide
  // guard, which now asserts the same emptiness across all of
  // `packages/concord/src` (including these four files) permanently. The
  // guard's own file-count and valid-citation anti-vacuity assertions are
  // this suite's non-vacuity proof now.
});
