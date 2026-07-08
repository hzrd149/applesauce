import { describe, expect, it } from "vitest";

import type { Rumor } from "../../types.js";
import { EDIT_KIND, getEditTarget, getEditText, isValidEdit } from "../edit.js";

const ID = "a".repeat(64);

const rumor = (over: Partial<Rumor> = {}): Rumor =>
  ({
    id: "e".repeat(64),
    pubkey: "b".repeat(64),
    kind: EDIT_KIND,
    content: "",
    tags: [] as string[][],
    created_at: 0,
    ...over,
  }) as Rumor;

describe("edit helpers", () => {
  it("isValidEdit requires the edit kind and an `e` target", () => {
    expect(isValidEdit(rumor({ tags: [["e", ID]] }))).toBe(true);
    expect(isValidEdit(rumor())).toBe(false);
    expect(isValidEdit(rumor({ kind: 9, tags: [["e", ID]] }))).toBe(false);
    expect(isValidEdit(undefined)).toBe(false);
  });

  it("getEditTarget returns an EventPointer for the replaced message", () => {
    expect(getEditTarget(rumor({ tags: [["e", ID]] }))).toEqual({ id: ID });
    expect(getEditTarget(rumor())).toBeUndefined();
  });

  it("getEditText returns the replacement content", () => {
    expect(getEditText(rumor({ content: "fixed typo" }))).toBe("fixed typo");
  });
});
