import { describe, expect, it } from "vitest";
import * as exports from "../index.js";

describe("exports", () => {
  it("should export the expected functions", () => {
    expect(Object.keys(exports).sort()).toMatchInlineSnapshot(`
      [
        "CASTS_SYMBOL",
        "CAST_REF_SYMBOL",
        "Cast",
        "Comment",
        "Mailboxes",
        "Note",
        "Profile",
        "Stream",
        "StreamChatMessage",
        "Zap",
        "cast",
      ]
    `);
  });
});
