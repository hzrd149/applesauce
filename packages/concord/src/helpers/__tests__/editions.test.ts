import { describe, expect, it } from "vitest";
import { hexToBytes } from "@noble/hashes/utils.js";

import { VSK } from "../../types.js";
import { editionHash } from "../crypto.js";
import { computeEditionHash, resolveEditionPin } from "../editions.js";
import type { DecodedEvent } from "../../types.js";

describe("edition builder", () => {
  it("computeEditionHash matches editionHash", () => {
    const eid = "11".repeat(32);
    const content = JSON.stringify({ name: "x" });
    expect(computeEditionHash({ vsk: VSK.METADATA, eid, version: 1, content })).toBe(
      editionHash(hexToBytes(eid), 1, undefined, new TextEncoder().encode(content)),
    );
  });
});

describe("resolveEditionPin", () => {
  const eid = "11".repeat(32);
  const content = '{"member":"' + "22".repeat(32) + '","role_ids":["' + "33".repeat(32) + '"]}';
  // Fixed independently generated CORD-04 edition_hash vector for
  // eid=11*32, ev=1, no ep, and the exact content above.
  const hash = "a0287dcbd0498f211f99d7a9e94f57a58ed6d70fa330df3acbd17e0f88612f5c";
  const edition = {
    rumor: {
      id: "44".repeat(32),
      pubkey: "55".repeat(32),
      created_at: 1,
      kind: 3308,
      tags: [
        ["vsk", String(VSK.GRANT)],
        ["eid", eid],
        ["ev", "1"],
      ],
      content,
    },
    author: "55".repeat(32),
    wrapId: "66".repeat(32),
    sealKind: 20014,
    ms: 1000,
  } as DecodedEvent;

  it("matches the exact coordinate, version, and content hash", () => {
    expect(resolveEditionPin([edition], [eid, "1", hash])).toMatchObject({ kind: "matched" });
  });

  it("distinguishes unavailable versions from same-version hash mismatches", () => {
    expect(resolveEditionPin([edition], [eid, "2", hash])).toEqual({ kind: "missing", eid, version: 2 });
    expect(resolveEditionPin([edition], [eid, "1", "ff".repeat(32)])).toEqual({
      kind: "mismatch",
      eid,
      version: 1,
    });
  });

  it("classifies malformed pins without throwing", () => {
    expect(resolveEditionPin([edition], [eid, "1.5", hash])).toEqual({ kind: "malformed" });
  });
});
