import { describe, expect, it } from "vitest";

import {
  RefoundingPublicationError,
  evaluateCommonRelayCoverage,
  type RefoundingArtifactPublication,
} from "../refounding.js";

const A = "wss://a.test";
const B = "wss://b.test";
const C = "wss://c.test";
const EXTRA = "wss://extra.test";

function publication(id: string, accepted: string[]): RefoundingArtifactPublication {
  return {
    artifact: { id, kind: id === "control" ? "control-compaction" : "root-rekey" },
    responses: accepted.map((from) => ({ ok: true, from })),
  };
}

describe("evaluateCommonRelayCoverage", () => {
  it("accepts one strict common majority across every mandatory artifact", () => {
    const coverage = evaluateCommonRelayCoverage(
      [publication("root-1", [A, B]), publication("root-2", [A, B]), publication("control", [A, B])],
      [A, B, C],
    );

    expect(coverage.accepted).toBe(true);
    expect(coverage.commonRelays).toEqual([A, B]);
    expect(coverage.required).toBe(2);
  });

  it("rejects disjoint per-artifact majorities", () => {
    const coverage = evaluateCommonRelayCoverage(
      [publication("one", [A, B]), publication("two", [B, C]), publication("control", [A, C])],
      [A, B, C],
    );

    expect(coverage.accepted).toBe(false);
    expect(coverage.commonRelays).toEqual([]);
    expect(coverage.evidence.map((row) => row.acceptedRelays)).toEqual([
      [A, B],
      [B, C],
      [A, C],
    ]);
  });

  it("excludes transport-only relays from the denominator and intersection", () => {
    const coverage = evaluateCommonRelayCoverage(
      [publication("root", [A, B, EXTRA]), publication("control", [A, B, EXTRA])],
      [A, B, C],
    );

    expect(coverage.accepted).toBe(true);
    expect(coverage.commonRelays).toEqual([A, B]);
    expect(coverage.evidence.every((row) => !row.acceptedRelays.includes(EXTRA))).toBe(true);
  });

  it("normalizes duplicate protocol relays and malformed response origins", () => {
    const coverage = evaluateCommonRelayCoverage(
      [
        {
          artifact: { id: "root", kind: "root-rekey" },
          responses: [
            { ok: true, from: `${A}/` },
            { ok: true, from: "" },
          ],
        },
      ],
      [A, `${A}/`, ""],
    );

    expect(coverage.accepted).toBe(true);
    expect(coverage.protocolRelays).toEqual([A]);
  });
});

describe("RefoundingPublicationError", () => {
  it("exposes stable evidence and causes without putting relay text in its message", () => {
    const cause = new Error("relay-controlled secret text");
    const coverage = evaluateCommonRelayCoverage(
      [{ artifact: { id: "root-id", kind: "root-rekey" }, responses: [], cause }],
      [A],
    );
    const error = new RefoundingPublicationError("rotation-id", coverage.evidence);

    expect(error.rotationId).toBe("rotation-id");
    expect(error.failedArtifactIds).toEqual(["root-id"]);
    expect(error.causes).toEqual([cause]);
    expect(error.message).not.toContain("relay-controlled secret text");
  });
});
