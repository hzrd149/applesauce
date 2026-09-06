import { describe, expect, it } from "vitest";
import { PrivateKeySigner } from "applesauce-signers/signers/private-key-signer";
import { generateSecretKey } from "applesauce-core/helpers/keys";

import {
  RefoundingPublicationError,
  evaluateCommonRelayCoverage,
  type RefoundingArtifactPublication,
} from "../refounding.js";
import { PendingRefoundingStore, memoryStorage } from "../storage.js";

const A = "wss://a.test/";
const B = "wss://b.test/";
const C = "wss://c.test/";
const EXTRA = "wss://extra.test/";

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
            { ok: true, from: A.slice(0, -1) },
            { ok: true, from: "" },
          ],
        },
      ],
      [A, A.slice(0, -1), ""],
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

  it("retains typed causes from negative relay acknowledgements", () => {
    const cause = new Error("relay rejected publication");
    const coverage = evaluateCommonRelayCoverage(
      [
        {
          artifact: { id: "control-id", kind: "control-compaction" },
          responses: [{ ok: false, from: A, error: cause, message: "untrusted relay text" }],
        },
      ],
      [A],
    );
    const error = new RefoundingPublicationError("rotation-id", coverage.evidence);

    expect(error.causes).toEqual([cause]);
    expect(error.message).not.toContain("untrusted relay text");
  });
});

describe("PendingRefoundingStore", () => {
  it("round-trips the complete prepared operation through self-encrypted storage", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const storage = memoryStorage();
    const pending = new PendingRefoundingStore(storage, signer, pubkey, "community-a");
    const record = {
      version: 1 as const,
      communityId: "community-a",
      priorEpoch: 3,
      rotationId: "rotation-id",
      stage: "prepared" as const,
      plan: {
        rekeyWraps: [{ id: "root-wrap", content: "signed-secret" }],
        channelRekeyWraps: [],
        compactionWraps: [],
        snapshotWraps: [],
        next: { material: { community_id: "community-a", community_root: "next-root", root_epoch: 4 } },
        newEpoch: 4,
        rekeyKey: { sk: new Uint8Array([1, 2]), pk: "stream", convKey: new Uint8Array([3, 4]) },
        channelRekeyKeys: [],
      },
      mandatoryEvidence: [],
      commonRelays: [],
      warnings: [],
    };

    await pending.save(record as never);
    const raw = await storage.getItem(pending.key);
    expect(raw).not.toContain("signed-secret");
    expect(raw).not.toContain("next-root");
    expect(await pending.load()).toEqual(record);
  });

  it("rejects authenticated records for a different community", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const storage = memoryStorage();
    const first = new PendingRefoundingStore(storage, signer, pubkey, "community-a");
    const second = new PendingRefoundingStore(storage, signer, pubkey, "community-b", first.key);
    await first.save({ version: 1, communityId: "community-a", priorEpoch: 1 } as never);
    await expect(second.load()).rejects.toThrow("community");
  });
});
