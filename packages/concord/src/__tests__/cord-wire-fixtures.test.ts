// Proves the vendored CORD wire fixtures' helpers are non-vacuous: an
// unbound placeholder throws (T-11-02), and tag-set comparison is
// order-independent so downstream WIRE-02/03/04/05 assertions are not
// pinned to our own composition order (T-11-01 caveat).

import { describe, expect, it } from "vitest";

import {
  CORD_EXAMPLES_CAVEAT,
  CORD_REPLY_ROOT_INHERITANCE_RULE,
  CORD_TARGET_KIND_RULE,
  DELETE_KIND5_EXAMPLE,
  missingFixtureTags,
  REACTION_KIND7_EXAMPLE,
  substituteFixtureTags,
  tagValues,
  THREADED_REPLY_KIND1111_EXAMPLE,
  VOICE_PRESENCE_JOINED_EXAMPLE,
  VOICE_PRESENCE_LEFT_EXAMPLE,
} from "./cord-wire-fixtures.js";

describe("substituteFixtureTags", () => {
  it("throws naming the unresolved token when a placeholder has no binding", () => {
    expect(() => substituteFixtureTags(REACTION_KIND7_EXAMPLE.tags, {})).toThrow(
      "<channel_id>",
    );
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
    const expected = [["channel", "<channel_id>"], ["k", "9"]];
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
