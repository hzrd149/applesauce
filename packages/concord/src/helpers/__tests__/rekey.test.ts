import { describe, expect, it } from "vitest";
import { bytesToHex } from "@noble/hashes/utils.js";

import type { RumorTemplate } from "../../types.js";
import { epochKeyCommitment } from "../crypto.js";
import {
  buildRekeyRumors,
  checkContinuity,
  decodeWrappedKey,
  encodeWrappedKey,
  groupRotations,
  parseRekey,
  REKEY_KIND,
  rekeyScopeId,
} from "../rekey.js";
import { decoded } from "./test-utils.js";

describe("rekey codec", () => {
  it("wrapped-key round-trips and rejects scope/epoch splices", () => {
    const scopeId = new Uint8Array(32).fill(4);
    const key = new Uint8Array(32).fill(5);
    const enc = encodeWrappedKey(scopeId, 7n, key);
    expect(enc.length).toBe(72);
    expect(bytesToHex(decodeWrappedKey(enc, scopeId, 7n))).toBe(bytesToHex(key));
    expect(() => decodeWrappedKey(enc, new Uint8Array(32).fill(6), 7n)).toThrow(/scope/);
    expect(() => decodeWrappedKey(enc, scopeId, 8n)).toThrow(/epoch/);
  });

  it("checkContinuity distinguishes ok / gap / fork", () => {
    const held = new Uint8Array(32).fill(1);
    const commit = bytesToHex(epochKeyCommitment(2n, held));
    expect(checkContinuity({ prevEpoch: 2n, prevCommit: commit }, 2n, held)).toEqual({ ok: true });
    expect(checkContinuity({ prevEpoch: 2n, prevCommit: "00".repeat(32) }, 2n, held)).toEqual({
      ok: false,
      reason: "fork",
    });
    expect(checkContinuity({ prevEpoch: 5n, prevCommit: commit }, 2n, held)).toEqual({ ok: false, reason: "gap" });
  });

  it("groupRotations marks a single-chunk rotation complete", () => {
    const rumor: RumorTemplate = {
      kind: 3303,
      content: JSON.stringify([{ locator: "aa", wrapped: "bb" }]),
      tags: [
        ["scope", bytesToHex(rekeyScopeId({ kind: "root" }))],
        ["newepoch", "3"],
        ["prevepoch", "2"],
        ["prevcommit", "cc".repeat(32)],
        ["chunk", "1", "1"],
        ["ms", "0"],
      ],
    };
    const parsed = parseRekey(decoded(rumor, "rotator"));
    expect(parsed).not.toBeNull();
    const sets = groupRotations([parsed!]);
    expect(sets).toHaveLength(1);
    expect(sets[0].complete).toBe(true);
  });

  it("buildRekeyRumors chunks blobs into complete 3303 rumors", async () => {
    const blobs = Array.from({ length: 121 }, (_, i) => ({ locator: String(i), wrapped: "w" }));
    const rumors = await Promise.all(
      buildRekeyRumors({ scope: { kind: "root" }, newEpoch: 1n, prevEpoch: 0n, prevCommit: "cc" }, blobs),
    );
    expect(rumors).toHaveLength(2);
    expect(rumors[0].kind).toBe(REKEY_KIND);
    expect(rumors[0].tags).toContainEqual(["chunk", "1", "2"]);
    expect(rumors[1].tags).toContainEqual(["chunk", "2", "2"]);
    expect(JSON.parse(rumors[0].content)).toHaveLength(120);
    expect(JSON.parse(rumors[1].content)).toHaveLength(1);
  });

  it("buildRekeyRumors emits one empty chunk for an empty blob set", async () => {
    const rumors = await Promise.all(
      buildRekeyRumors({ scope: { kind: "root" }, newEpoch: 1n, prevEpoch: 0n, prevCommit: "cc" }, []),
    );
    expect(rumors).toHaveLength(1);
    expect(rumors[0].tags).toContainEqual(["chunk", "1", "1"]);
    expect(JSON.parse(rumors[0].content)).toEqual([]);
  });
});
