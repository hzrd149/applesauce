import { describe, expect, it } from "vitest";
import { hexToBytes } from "@noble/hashes/utils.js";

import { VSK } from "../../types.js";
import { editionHash } from "../crypto.js";
import { computeEditionHash } from "../editions.js";

describe("edition builder", () => {
  it("computeEditionHash matches editionHash", () => {
    const eid = "11".repeat(32);
    const content = JSON.stringify({ name: "x" });
    expect(computeEditionHash({ vsk: VSK.METADATA, eid, version: 1, content })).toBe(
      editionHash(hexToBytes(eid), 1, undefined, new TextEncoder().encode(content)),
    );
  });
});
