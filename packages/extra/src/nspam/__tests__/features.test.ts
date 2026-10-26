import type { NostrEvent } from "applesauce-core/helpers";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { charWbNgrams, extractNspamFeatures, hashNgrams, NSPAM_HASH_BUCKETS, wordNgrams } from "../features.js";

// Generated from the Python reference (barrydeen/nostrarchives-api scripts/nspam) with the upstream
// hash and parity fixtures, plus extra bundles covering Unicode whitespace, casefolding and URL edge cases
const fixtures = join(__dirname, "fixtures");
const { hashes, bundles } = JSON.parse(readFileSync(join(fixtures, "nspam-v2.4.json"), "utf8")) as {
  hashes: { token: string; word_buckets: Bucket[]; char_wb_buckets: Bucket[] }[];
  bundles: { notes: NostrEvent[]; hashed: string; dense: number[]; raw: number; score: number }[];
};
type Bucket = { index: number; value: number };

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
