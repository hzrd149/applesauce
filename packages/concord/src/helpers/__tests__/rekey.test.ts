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

  it("groupRotations marks a bucket inconsistent when chunks disagree on chunkCount (n)", () => {
    // CORD-06 §2's removal rule reads a rotation's blobs "once you hold all n
    // chunks" — n is a single fact about ONE rotation generation. Two chunks in
    // the same (rotator, scope, newEpoch, prevCommit) bucket that disagree on n
    // cannot both belong to the rotation CORD-06 describes, so hand-derived
    // expectation: the bucket is unresolvable (consistent === false) and can
    // never satisfy "hold all n chunks" (complete === false) — never mind
    // whether the first-arriving generation's own chunks happen to be fully
    // present (chunks.size meets ITS chunkCount).
    const base = {
      scope: bytesToHex(rekeyScopeId({ kind: "root" })),
      newepoch: "3",
      prevepoch: "2",
      prevcommit: "cc".repeat(32),
    };
    const genA1: RumorTemplate = {
      kind: 3303,
      content: JSON.stringify([{ locator: "a1", wrapped: "w" }]),
      tags: [
        ["scope", base.scope],
        ["newepoch", base.newepoch],
        ["prevepoch", base.prevepoch],
        ["prevcommit", base.prevcommit],
        ["chunk", "1", "2"],
        ["ms", "0"],
      ],
    };
    const genA2: RumorTemplate = {
      kind: 3303,
      content: JSON.stringify([{ locator: "a2", wrapped: "w" }]),
      tags: [
        ["scope", base.scope],
        ["newepoch", base.newepoch],
        ["prevepoch", base.prevepoch],
        ["prevcommit", base.prevcommit],
        ["chunk", "2", "2"],
        ["ms", "0"],
      ],
    };
    const genB1: RumorTemplate = {
      kind: 3303,
      content: JSON.stringify([{ locator: "b1", wrapped: "w" }]),
      tags: [
        ["scope", base.scope],
        ["newepoch", base.newepoch],
        ["prevepoch", base.prevepoch],
        ["prevcommit", base.prevcommit],
        ["chunk", "1", "3"],
        ["ms", "0"],
      ],
    };
    const parsed = [genA1, genA2, genB1]
      .map((rumor) => parseRekey(decoded(rumor, "rotator")))
      .filter((p): p is NonNullable<typeof p> => p !== null);
    expect(parsed).toHaveLength(3);
    const sets = groupRotations(parsed);
    expect(sets).toHaveLength(1);
    // Generation A alone (index 1 + 2, chunkCount 2) would satisfy "chunks.size
    // >= chunkCount" — proving the guard fires on disagreement, not on a missing
    // chunk count.
    expect(sets[0].chunks.size).toBeGreaterThanOrEqual(2);
    expect(sets[0].consistent).toBe(false);
    expect(sets[0].complete).toBe(false);
  });

  it("groupRotations marks a bucket inconsistent when chunks disagree on prevEpoch", () => {
    // CORD-06 §2: continuity is checked against ONE prevEpoch per rotation. Two
    // chunks correlated into the same bucket that name different prevEpoch
    // values cannot both describe the same rotation, so the hand-derived
    // expectation is the same unresolvable-bucket outcome as the n-disagreement
    // case: consistent === false, complete === false.
    const scope = bytesToHex(rekeyScopeId({ kind: "root" }));
    const prevcommit = "dd".repeat(32);
    const chunkPrevEpoch2: RumorTemplate = {
      kind: 3303,
      content: JSON.stringify([{ locator: "p1", wrapped: "w" }]),
      tags: [
        ["scope", scope],
        ["newepoch", "5"],
        ["prevepoch", "2"],
        ["prevcommit", prevcommit],
        ["chunk", "1", "1"],
        ["ms", "0"],
      ],
    };
    const chunkPrevEpoch4: RumorTemplate = {
      kind: 3303,
      content: JSON.stringify([{ locator: "p2", wrapped: "w" }]),
      tags: [
        ["scope", scope],
        ["newepoch", "5"],
        ["prevepoch", "4"],
        ["prevcommit", prevcommit],
        ["chunk", "1", "1"],
        ["ms", "0"],
      ],
    };
    const parsed = [chunkPrevEpoch2, chunkPrevEpoch4]
      .map((rumor) => parseRekey(decoded(rumor, "rotator")))
      .filter((p): p is NonNullable<typeof p> => p !== null);
    expect(parsed).toHaveLength(2);
    const sets = groupRotations(parsed);
    expect(sets).toHaveLength(1);
    expect(sets[0].consistent).toBe(false);
    expect(sets[0].complete).toBe(false);
  });

  it("groupRotations: matching n and prevEpoch across all chunks yields a consistent, complete set (positive control)", () => {
    const scope = bytesToHex(rekeyScopeId({ kind: "root" }));
    const chunk1: RumorTemplate = {
      kind: 3303,
      content: JSON.stringify([{ locator: "ok1", wrapped: "w" }]),
      tags: [
        ["scope", scope],
        ["newepoch", "9"],
        ["prevepoch", "8"],
        ["prevcommit", "ee".repeat(32)],
        ["chunk", "1", "2"],
        ["ms", "0"],
      ],
    };
    const chunk2: RumorTemplate = {
      kind: 3303,
      content: JSON.stringify([{ locator: "ok2", wrapped: "w" }]),
      tags: [
        ["scope", scope],
        ["newepoch", "9"],
        ["prevepoch", "8"],
        ["prevcommit", "ee".repeat(32)],
        ["chunk", "2", "2"],
        ["ms", "0"],
      ],
    };
    const parsed = [chunk1, chunk2]
      .map((rumor) => parseRekey(decoded(rumor, "rotator")))
      .filter((p): p is NonNullable<typeof p> => p !== null);
    expect(parsed).toHaveLength(2);
    const sets = groupRotations(parsed);
    expect(sets).toHaveLength(1);
    expect(sets[0].consistent).toBe(true);
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
