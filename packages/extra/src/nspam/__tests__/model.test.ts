import type { NostrEvent } from "applesauce-core/helpers";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { extractNspamFeatures } from "../features.js";
import { parseNspamModel, predictNspam } from "../model.js";

// Generated from the Python reference (barrydeen/nostrarchives-api scripts/nspam) with the upstream
// hash and parity fixtures, plus extra bundles covering Unicode whitespace, casefolding and URL edge cases
const fixtures = join(__dirname, "fixtures");
const { bundles } = JSON.parse(readFileSync(join(fixtures, "nspam-v2.4.json"), "utf8")) as {
  bundles: { notes: NostrEvent[]; hashed: string; dense: number[]; raw: number; score: number }[];
};
const calibration = new Uint8Array(readFileSync(join(fixtures, "nspam-v2.4-calibration.npz"))).buffer;

describe("parseNspamModel", () => {
  it("reads the calibration table", async () => {
    const model = await parseNspamModel("objective=binary sigmoid:1\nmax_feature_idx=262166\n", calibration);
    expect(model.calibX.length).toBeGreaterThan(1);
    expect(model.calibX.length).toBe(model.calibY.length);
    expect([...model.calibX]).toEqual([...model.calibX].sort((a, b) => a - b));
  });

  it("rejects models with a different feature layout", async () => {
    await expect(
      parseNspamModel("objective=binary sigmoid:1\nmax_feature_idx=10\n", new ArrayBuffer(0)),
    ).rejects.toThrow("features");
  });
});

// The 9 MB model is not committed, run with NSPAM_MODEL_DIR pointing at a download of the pinned v2.4 files

describe.skipIf(!process.env.NSPAM_MODEL_DIR)("nspam model parity", () => {
  it("matches the reference scores", async () => {
    const dir = process.env.NSPAM_MODEL_DIR!;
    const model = await parseNspamModel(readFileSync(join(dir, "model.txt"), "utf8"), calibration);
    for (const bundle of bundles) {
      const { raw, score } = predictNspam(model, extractNspamFeatures(bundle.notes));
      expect(raw).toBeCloseTo(bundle.raw, 9);
      expect(score).toBeCloseTo(bundle.score, 9);
    }
  });
});
