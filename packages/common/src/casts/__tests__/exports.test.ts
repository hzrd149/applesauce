import { describe, expect, it } from "vitest";
import * as exports from "../index.js";

describe("exports", () => {
  it("should export the expected functions", () => {
    expect(Object.keys(exports).sort()).toMatchInlineSnapshot(`
      [
        "BaseCast",
        "CASTS_SYMBOL",
        "CAST_REF_SYMBOL",
        "Comment",
        "Mailboxes",
        "Note",
        "Profile",
        "Zap",
        "cast",
        "getStore",
        "ref",
      ]
    `);
  });
});
