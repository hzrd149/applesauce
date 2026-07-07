import { describe, expect, it } from "vitest";
import * as exports from "../index.js";

describe("concord exports", () => {
  it("should export the expected symbols", () => {
    expect(Object.keys(exports).sort()).toMatchInlineSnapshot(`
      [
        "ADMIN_PERMS",
        "KIND",
        "PERM",
        "VSK",
        "ZERO_32",
        "ZERO_32_HEX",
        "concatBytes",
        "fromBase64url",
        "fromHex",
        "fromUtf8",
        "randomBytes",
        "toBase64url",
        "toHex",
        "u64be",
        "utf8",
      ]
    `);
  });
});
