import { describe, expect, it } from "vitest";
import { getTagValue } from "../event.js";
import { EventIndexableTagsSymbol, getIndexableTags } from "../filter.js";

const event = {
  content: "",
  created_at: 1732889913,
  id: "2d53511f321cc82dd13eedfb597c9fe834d12d271c10d8068e9d8cfb8f58d1b4",
  kind: 30000,
  pubkey: "266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5",
  sig: "e6a442487ef44a8a00ec1e0a852e547991fcd5cbf19aa1a4219fa65d6f41022675e0745207649f4b16fe9a6c5c7c3693dc3e13966ffa5b2891634867c874cf22",
  tags: [
    ["d", "qRxLhBbTfRlxsvKSu0iUl"],
    ["title", "Musicians"],
    ["client", "noStrudel", "31990:266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5:1686066542546"],
    ["p", "2842e34860c59dfacd5df48ba7a65065e6760d08c35f779553d83c2c2310b493"],
    ["p", "28ca019b78b494c25a9da2d645975a8501c7e99b11302e5cbe748ee593fcb2cc"],
    ["p", "f46192b8b9be1b43fc30ea27c7cb16210aede17252b3aa9692fbb3f2ba153199"],
  ],
};

describe("getIndexableTags", () => {
  it("should return a set of indexable tags for event", () => {
    expect(Array.from(getIndexableTags(event))).toEqual(
      expect.arrayContaining([
        "p:2842e34860c59dfacd5df48ba7a65065e6760d08c35f779553d83c2c2310b493",
        "p:28ca019b78b494c25a9da2d645975a8501c7e99b11302e5cbe748ee593fcb2cc",
        "p:f46192b8b9be1b43fc30ea27c7cb16210aede17252b3aa9692fbb3f2ba153199",
      ]),
    );
  });

  it("should cache value on EventIndexableTagsSymbol", () => {
    getIndexableTags(event);

    expect(Reflect.has(event, EventIndexableTagsSymbol)).toBe(true);
  });
});

describe("getTagValue", () => {
  it("should return value of tag if present", () => {
    expect(getTagValue(event, "title")).toBe("Musicians");
  });
});
