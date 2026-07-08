import { describe, expect, it } from "vitest";
import { bytesToHex } from "@noble/hashes/utils.js";

import type { RumorTemplate } from "../../types.js";
import { epochKeyCommitment } from "../crypto.js";
import {
  checkContinuity,
  decodeWrappedKey,
  encodeWrappedKey,
  groupRotations,
  parseRekey,
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
    expect(checkContinuity({ prevEpoch: 2n, prevCommit: "00".repeat(32) }, 2n, held)).toEqual({ ok: false, reason: "fork" });
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
});
