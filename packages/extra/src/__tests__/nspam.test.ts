import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { NostrEvent } from "applesauce-core/helpers";
import { of } from "rxjs";
import { describe, expect, it } from "vitest";

import { NspamClassifier, filterSpam } from "../nspam/classifier.js";
import { charWbNgrams, extractNspamFeatures, hashNgrams, NSPAM_HASH_BUCKETS, wordNgrams } from "../nspam/features.js";
import { parseNspamModel, predictNspam, type NspamModel } from "../nspam/model.js";

// Generated from the Python reference (barrydeen/nostrarchives-api scripts/nspam) with the upstream
// hash and parity fixtures, plus extra bundles covering Unicode whitespace, casefolding and URL edge cases
const fixtures = join(__dirname, "fixtures");
const { hashes, bundles } = JSON.parse(readFileSync(join(fixtures, "nspam-v2.4.json"), "utf8")) as {
  hashes: { token: string; word_buckets: Bucket[]; char_wb_buckets: Bucket[] }[];
  bundles: { notes: NostrEvent[]; hashed: string; dense: number[]; raw: number; score: number }[];
};
type Bucket = { index: number; value: number };
const calibration = new Uint8Array(readFileSync(join(fixtures, "nspam-v2.4-calibration.npz"))).buffer;

const buckets = (grams: string[]) => {
  const features = new Map<number, number>();
  hashNgrams(features, 0, grams);
  return [...features].map(([index, value]) => ({ index, value })).sort((a, b) => a.index - b.index);
};

describe("nspam features", () => {
  it.each(hashes)("hashes $token like sklearn", ({ token, word_buckets, char_wb_buckets }) => {
    expect(buckets(wordNgrams(token))).toEqual(word_buckets);
    // The upstream fixture truncates char buckets at 32 entries
    expect(buckets(charWbNgrams(token)).slice(0, char_wb_buckets.length)).toEqual(char_wb_buckets);
  });

  it.each(bundles.map((b, i) => [i, b] as const))("matches the reference features for bundle %i", (_, bundle) => {
    const features = extractNspamFeatures(bundle.notes);
    const hashed = [...features]
      .filter(([i, v]) => i < NSPAM_HASH_BUCKETS * 2 && v !== 0)
      .sort((a, b) => a[0] - b[0])
      .map(([i, v]) => `${i}:${v}`)
      .join("\n");

    expect(createHash("sha256").update(hashed).digest("hex")).toBe(bundle.hashed);
    expect(bundle.dense.map((_, i) => features.get(NSPAM_HASH_BUCKETS * 2 + i) ?? 0)).toEqual(bundle.dense);
  });
});

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

describe("NspamClassifier", () => {
  // A single tree that flags authors with 3 or more replies in their bundle (the group_size feature)
  const model: NspamModel = {
    roots: Int32Array.of(0),
    feature: Int32Array.of(NSPAM_HASH_BUCKETS * 2 + 17),
    threshold: Float64Array.of(2.5),
    left: Int32Array.of(~0),
    right: Int32Array.of(~1),
    leafOffset: Int32Array.of(0),
    leafValue: Float64Array.of(-5, 5),
    bias: 0,
    calibX: Float64Array.of(0, 1),
    calibY: Float64Array.of(0, 1),
  };

  let id = 0;
  const reply = (pubkey: string, created_at = id): NostrEvent => ({
    id: String(id++),
    pubkey,
    kind: 1,
    created_at,
    content: "gm",
    tags: [["e", "root"]],
    sig: "",
  });

  it("scores authors once they have enough replies", () => {
    const nspam = new NspamClassifier(model);
    expect(nspam.isSpam(reply("bot"))).toBe(false);
    expect(nspam.isSpam(reply("bot"))).toBe(false);
    expect(nspam.isSpam(reply("bot"))).toBe(true);
    expect(nspam.getScore("bot")?.score).toBeGreaterThan(0.99);
  });

  it("ignores duplicate replies and keeps only the newest ten", () => {
    const nspam = new NspamClassifier(model);
    const event = reply("a");
    expect(nspam.add(event)).toBe(true);
    expect(nspam.add(event)).toBe(false);

    for (let i = 0; i < 10; i++) nspam.add(reply("b", 100 + i));
    expect(nspam.add(reply("b", 0))).toBe(false);
  });

  it("never flags events that are not kind 1 replies", () => {
    const nspam = new NspamClassifier(model);
    const note = { ...reply("c"), tags: [] };
    for (let i = 0; i < 3; i++) nspam.add(reply("c"));
    expect(nspam.isSpam(note)).toBe(false);
    expect(() => nspam.score([note])).toThrow();
  });

  it("filters spam replies out of a timeline using every reply as evidence", () => {
    const nspam = new NspamClassifier(model);
    const timeline = [reply("bot"), reply("human"), reply("bot"), reply("bot")];
    let result: NostrEvent[] = [];
    of(timeline)
      .pipe(filterSpam(nspam))
      .subscribe((events) => (result = events));
    expect(result.map((e) => e.pubkey)).toEqual(["human"]);
  });
});
