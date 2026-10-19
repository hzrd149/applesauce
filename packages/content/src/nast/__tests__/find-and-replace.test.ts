import { describe, expect, it } from "vitest";
import { findAndReplace } from "../find-and-replace.js";
import { Root, Text } from "../types.js";

function tree(...values: string[]): Root {
  return { type: "root", children: values.map((value) => ({ type: "text", value })) };
}

describe("findAndReplace", () => {
  it("preserves unmatched nodes and visits matching nodes after them", () => {
    const root = tree("unmatched", "also unmatched", "target");
    const original = root.children.slice();
    findAndReplace(root, [[/target/g, () => "changed"]]);
    expect(root.children).toEqual([original[0], original[1], { type: "text", value: "changed" }]);
    expect(root.children[0]).toBe(original[0]);
    expect(root.children[1]).toBe(original[1]);
  });

  it("skips replacement nodes while continuing through adjacent original nodes", () => {
    const root = tree("a", "a", "untouched", "a");
    let replacements = 0;
    findAndReplace(root, [
      [
        /a/g,
        () => {
          replacements++;
          return [
            { type: "text", value: "a!" },
            { type: "hashtag", hashtag: "tag" },
          ];
        },
      ],
    ]);
    expect(replacements).toBe(3);
    expect(root.children).toEqual([
      { type: "text", value: "a!" },
      { type: "hashtag", hashtag: "tag" },
      { type: "text", value: "a!" },
      { type: "hashtag", hashtag: "tag" },
      { type: "text", value: "untouched" },
      { type: "text", value: "a!" },
      { type: "hashtag", hashtag: "tag" },
    ]);
  });

  it("preserves rejected matches and continues to subsequent text nodes", () => {
    const root = tree("skip", "keep", "skip");
    const originals = root.children.slice();
    findAndReplace(root, [[/skip|keep/g, (match) => (match === "skip" ? false : "changed")]]);
    expect(root.children).toEqual([originals[0], { type: "text", value: "changed" }, originals[2]]);
    expect(root.children[0]).toBe(originals[0]);
    expect(root.children[2]).toBe(originals[2]);
  });

  it("handles deletion, global matches, and subsequent transformer passes", () => {
    const root = tree("remove", "aba", "remaining");
    findAndReplace(root, [
      [/^remove$/, () => null],
      [/a/g, () => "A"],
      [/b/, () => "B"],
    ]);
    expect((root.children as Text[]).map((node) => node.value).join("")).toBe("ABAremAining");
  });
});
