import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures";
import { getAddressPointerFromATag } from "../pointers.js";
import { isATag, isNameValueTag, processTags } from "../tags.js";

const user = new FakeUser();

describe("isNameValueTag", () => {
  it("should return true if tag has at least two indexes", () => {
    expect(isNameValueTag(["a", "30000:pubkey:list"])).toBe(true);
    expect(isNameValueTag(["title", "article", "other-value"])).toBe(true);
  });

  it("should ignore tags without values", () => {
    expect(isNameValueTag(["a"])).toBe(false);
    expect(isNameValueTag(["title"])).toBe(false);
  });
});

describe("processTags", () => {
  it("should filter out errors", () => {
    const result = processTags([["a", "bad coordinate"], ["e"], ["a", `30000:${user.pubkey}:list`]], (t) => {
      if (t[1] === "bad coordinate") throw new Error("Bad coordinate");
      return getAddressPointerFromATag(t) ?? undefined;
    });

    expect(result).toEqual([{ kind: 30000, pubkey: user.pubkey, identifier: "list" }]);
  });

  it("should correctly parse urls as identifier", () => {
    const result = processTags([["a", `30000:${user.pubkey}:https://identifier.org/`]], (t) => {
      if (t[1] === "bad coordinate") throw new Error("Bad coordinate");
      return getAddressPointerFromATag(t) ?? undefined;
    });

    expect(result).toEqual([{ kind: 30000, pubkey: user.pubkey, identifier: "https://identifier.org/" }]);
  });


  it("should filter out undefined", () => {
    expect(
      processTags([["a", "bad coordinate"], ["e"], ["a", "30000:pubkey:list"]], (tag) =>
        isATag(tag) ? tag : undefined,
      ),
    ).toEqual([
      ["a", "bad coordinate"],
      ["a", "30000:pubkey:list"],
    ]);
  });
});
