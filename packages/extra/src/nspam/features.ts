import type { NostrEvent } from "applesauce-core/helpers";

// A port of the nspam v2.4 Python reference feature extraction:
// github.com/barrydeen/nostrarchives-api/tree/master/scripts/nspam (features.py, preprocess.py)
// Any mismatch silently produces wrong scores, so every regex below mirrors a Python definition.

/** The number of hash buckets in each of the char and word n-gram blocks */
export const NSPAM_HASH_BUCKETS = 131072;
/** The total width of an nspam feature vector: two hashed blocks plus 17 structural and 6 group features */
export const NSPAM_FEATURE_COUNT = NSPAM_HASH_BUCKETS * 2 + 23;

/** The parts of a note the nspam features read */
export type NspamNote = Pick<NostrEvent, "content" | "tags" | "created_at">;

// The zero-width and bidi characters from the model's config.json
const INVISIBLE = /[᠎​-‏‪-‮⁠-⁤⁦-⁩﻿]/gu;
// Python's str.isspace() (used by sklearn) and the `regex` module's \s and \w differ from JS
const PY_WS = "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const RX_WS = "\\t\\n\\v\\f\\r \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const RX_W = "\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}\\u200c\\u200d";

const PY_SPLIT = new RegExp(`[${PY_WS}]+`, "u");
const PY_COLLAPSE = new RegExp(`[${PY_WS}]{2,}`, "gu");
const PY_TRIM = new RegExp(`^[${PY_WS}]+|[${PY_WS}]+$`, "gu");
const RX_WS_RUN = new RegExp(`[${RX_WS}]+`, "gu");
const URL_NORMALIZE = new RegExp(`https?://([^${RX_WS}/]+)(/[^${RX_WS}]*)?`, "giu");
const URL_HOST = new RegExp(`https?://([^${RX_WS}/]+)`, "giu");
// The lookbehind stands in for the `regex` module's Unicode-aware \b
const MENTION = new RegExp(`(?<![${RX_W}])(?:nostr:)?(?:npub1|note1|nprofile1|nevent1|naddr1)[0-9a-z]+`, "giu");
const HASHTAG = new RegExp(`#[${RX_W}]+`, "gu");
const WS_TOKEN = new RegExp(`[^${RX_WS}]+`, "gu");
const GROUP_TOKEN = new RegExp(`\\p{L}[\\p{L}\\p{M}\\p{N}_]*|\\p{N}+|https?://[^${RX_WS}]+|[#@][${RX_W}]+`, "gu");
// sklearn's default token_pattern (?u)\b\w\w+\b, where Python's \w is str.isalnum() plus _
const SK_WORD_TOKEN = /[\p{L}\p{N}_]{2,}/gu;
const EMOJI = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu;

// Python's str.casefold() is toLowerCase() plus these full case foldings, and Cherokee folds to uppercase
const FOLDS = new Map(
  "\u00b5\u03bc,\u00df\u0073\u0073,\u0149\u02bc\u006e,\u017f\u0073,\u01f0\u006a\u030c,\u0345\u03b9,\u0390\u03b9\u0308\u0301,\u03b0\u03c5\u0308\u0301,\u03c2\u03c3,\u03d0\u03b2,\u03d1\u03b8,\u03d5\u03c6,\u03d6\u03c0,\u03f0\u03ba,\u03f1\u03c1,\u03f5\u03b5,\u0587\u0565\u0582,\u1c80\u0432,\u1c81\u0434,\u1c82\u043e,\u1c83\u0441,\u1c84\u0442,\u1c85\u0442,\u1c86\u044a,\u1c87\u0463,\u1c88\ua64b,\u1e96\u0068\u0331,\u1e97\u0074\u0308,\u1e98\u0077\u030a,\u1e99\u0079\u030a,\u1e9a\u0061\u02be,\u1e9b\u1e61,\u1f50\u03c5\u0313,\u1f52\u03c5\u0313\u0300,\u1f54\u03c5\u0313\u0301,\u1f56\u03c5\u0313\u0342,\u1f80\u1f00\u03b9,\u1f81\u1f01\u03b9,\u1f82\u1f02\u03b9,\u1f83\u1f03\u03b9,\u1f84\u1f04\u03b9,\u1f85\u1f05\u03b9,\u1f86\u1f06\u03b9,\u1f87\u1f07\u03b9,\u1f90\u1f20\u03b9,\u1f91\u1f21\u03b9,\u1f92\u1f22\u03b9,\u1f93\u1f23\u03b9,\u1f94\u1f24\u03b9,\u1f95\u1f25\u03b9,\u1f96\u1f26\u03b9,\u1f97\u1f27\u03b9,\u1fa0\u1f60\u03b9,\u1fa1\u1f61\u03b9,\u1fa2\u1f62\u03b9,\u1fa3\u1f63\u03b9,\u1fa4\u1f64\u03b9,\u1fa5\u1f65\u03b9,\u1fa6\u1f66\u03b9,\u1fa7\u1f67\u03b9,\u1fb2\u1f70\u03b9,\u1fb3\u03b1\u03b9,\u1fb4\u03ac\u03b9,\u1fb6\u03b1\u0342,\u1fb7\u03b1\u0342\u03b9,\u1fbe\u03b9,\u1fc2\u1f74\u03b9,\u1fc3\u03b7\u03b9,\u1fc4\u03ae\u03b9,\u1fc6\u03b7\u0342,\u1fc7\u03b7\u0342\u03b9,\u1fd2\u03b9\u0308\u0300,\u1fd3\u03b9\u0308\u0301,\u1fd6\u03b9\u0342,\u1fd7\u03b9\u0308\u0342,\u1fe2\u03c5\u0308\u0300,\u1fe3\u03c5\u0308\u0301,\u1fe4\u03c1\u0313,\u1fe6\u03c5\u0342,\u1fe7\u03c5\u0308\u0342,\u1ff2\u1f7c\u03b9,\u1ff3\u03c9\u03b9,\u1ff4\u03ce\u03b9,\u1ff6\u03c9\u0342,\u1ff7\u03c9\u0342\u03b9,\ufb00\u0066\u0066,\ufb01\u0066\u0069,\ufb02\u0066\u006c,\ufb03\u0066\u0066\u0069,\ufb04\u0066\u0066\u006c,\ufb05\u0073\u0074,\ufb06\u0073\u0074,\ufb13\u0574\u0576,\ufb14\u0574\u0565,\ufb15\u0574\u056b,\ufb16\u057e\u0576,\ufb17\u0574\u056d"
    .split(",")
    .map((entry) => [entry[0], entry.slice(1)]),
);
const FOLDABLE = new RegExp(`[${[...FOLDS.keys()].join("")}\\u13f8-\\u13fd\\uab70-\\uabbf]`, "gu");

const count = (text: string, re: RegExp) => text.match(re)?.length ?? 0;
const codepoints = (text: string) => Array.from(text).length;
const casefold = (text: string) =>
  text
    .toLowerCase()
    .replace(FOLDABLE, (ch) => FOLDS.get(ch) ?? String.fromCharCode(ch.charCodeAt(0) - (ch >= "ꭰ" ? 0x97d0 : 8)));
const encoder = new TextEncoder();

/** MurmurHash3 x86 32-bit with seed 0, the hash sklearn's HashingVectorizer uses */
function murmur3(key: Uint8Array): number {
  let h = 0;
  const blocks = key.length >> 2;
  for (let i = 0; i < blocks; i++) {
    const j = i * 4;
    let k = key[j] | (key[j + 1] << 8) | (key[j + 2] << 16) | (key[j + 3] << 24);
    k = Math.imul(k, 0xcc9e2d51);
    k = Math.imul((k << 15) | (k >>> 17), 0x1b873593);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  const tail = blocks * 4;
  const rest = key.length & 3;
  if (rest > 0) {
    let k = key[tail];
    if (rest > 1) k |= key[tail + 1] << 8;
    if (rest > 2) k |= key[tail + 2] << 16;
    k = Math.imul(k, 0xcc9e2d51);
    k = Math.imul((k << 15) | (k >>> 17), 0x1b873593);
    h ^= k;
  }
  h ^= key.length;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return h ^ (h >>> 16);
}

/** Adds n-grams to a feature map using sklearn's bucket and alternate_sign conventions */
export function hashNgrams(features: Map<number, number>, offset: number, grams: Iterable<string>) {
  const n = NSPAM_HASH_BUCKETS;
  for (const gram of grams) {
    const h = murmur3(encoder.encode(gram));
    const index = offset + (h === -2147483648 ? (2147483647 - (n - 1)) % n : Math.abs(h) % n);
    features.set(index, (features.get(index) ?? 0) + (h >= 0 ? 1 : -1));
  }
}

/** sklearn's char_wb analyzer: padded character 3-5 grams inside each word */
export function charWbNgrams(text: string, min = 3, max = 5): string[] {
  const grams: string[] = [];
  for (const word of text.replace(PY_COLLAPSE, " ").split(PY_SPLIT)) {
    if (!word) continue;
    const chars = Array.from(` ${word} `);
    for (let n = min; n <= max; n++) {
      let offset = 0;
      grams.push(chars.slice(0, n).join(""));
      while (offset + n < chars.length) {
        offset++;
        grams.push(chars.slice(offset, offset + n).join(""));
      }
      // Short words are only counted once
      if (offset === 0) break;
    }
  }
  return grams;
}

/** sklearn's word analyzer: unigrams and bigrams of 2+ character words */
export function wordNgrams(text: string): string[] {
  const words = text.match(SK_WORD_TOKEN) ?? [];
  const grams = [...words];
  for (let i = 0; i + 1 < words.length; i++) grams.push(`${words[i]} ${words[i + 1]}`);
  return grams;
}

/** The 17 per-note structural features, computed on the raw content */
function structural({ content, tags }: NspamNote): number[] {
  const len = codepoints(content);
  const ratio = (n: number, d: number) => (d > 0 ? n / d : 0);
  const hosts = Array.from(content.matchAll(URL_HOST), (m) => m[1].toLowerCase());
  const emoji = count(content, EMOJI);
  const tag = (name: string) => tags.filter((t) => t[0] === name).length;
  const other = tags.filter((t) => t.length > 0 && !["p", "e", "t"].includes(t[0])).length;

  return [
    len,
    count(content, WS_TOKEN),
    hosts.length,
    new Set(hosts).size,
    count(content, MENTION),
    count(content, HASHTAG),
    tag("p"),
    tag("e"),
    tag("t"),
    other,
    emoji,
    ratio(emoji, len),
    count(content, INVISIBLE),
    ratio(count(content, /\p{Lu}/gu), count(content, /\p{L}/gu)),
    ratio(count(content, /\p{N}/gu), len),
    ratio(count(content, /\p{P}/gu), len),
    0, // dup_body_bucket is a training-only signal
  ];
}

/** The 6 group features describing how similar an author's notes are to each other */
function groupFeatures(notes: NspamNote[]): number[] {
  const contents = notes.map((n) => n.content);
  const bodies = new Set(
    contents.map((c) =>
      Array.from(casefold(c.replace(INVISIBLE, "")).replace(PY_TRIM, ""))
        .slice(0, 200)
        .join(""),
    ),
  );
  bodies.delete("");
  if (notes.length < 2) return [notes.length, 0, bodies.size, 0, 0, 0];

  const stamps = notes.map((n) => n.created_at).filter((s) => s !== 0);
  const span = stamps.length >= 2 ? (Math.max(...stamps) - Math.min(...stamps)) / 3600 : 0;
  const lens = contents.map(codepoints);
  const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
  const std = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length);

  const tokens = contents.map((c) => casefold(c).match(GROUP_TOKEN) ?? []);
  const firsts = new Map<string, number>();
  for (const t of tokens) if (t.length) firsts.set(t[0], (firsts.get(t[0]) ?? 0) + 1);
  const sameFirst = firsts.size ? Math.max(...firsts.values()) / notes.length : 0;

  const sets = tokens.map((t) => new Set(t));
  const sims: number[] = [];
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const inter = [...sets[i]].filter((x) => sets[j].has(x)).length;
      const union = sets[i].size + sets[j].size - inter;
      if (union > 0) sims.push(inter / union);
    }
  }
  const jaccard = sims.length ? sims.reduce((a, b) => a + b, 0) / sims.length : 0;

  return [notes.length, span, bodies.size, std, sameFirst, jaccard];
}

/** Builds the sparse nspam feature vector for a bundle of replies from one author */
export function extractNspamFeatures(notes: NspamNote[]): Map<number, number> {
  const features = new Map<number, number>();

  // The bundle is vectorized as one document: char grams read NFKC text, word grams read fully normalized text
  const nfkc = notes.map((n) => n.content.normalize("NFKC"));
  hashNgrams(features, 0, charWbNgrams(nfkc.join(" ")));

  const normalized = nfkc.map((text) => {
    const urls = text
      .replace(INVISIBLE, "")
      .replace(URL_NORMALIZE, (_, host: string) => `http://${host.toLowerCase()}`);
    return casefold(urls).replace(RX_WS_RUN, " ").replace(PY_TRIM, "");
  });
  hashNgrams(features, NSPAM_HASH_BUCKETS, wordNgrams(normalized.join(" ")));

  // Structural features are averaged over the bundle and cast to float32 like the reference
  const rows = notes.map(structural);
  const dense = rows[0]?.map((_, i) => rows.reduce((sum, row) => sum + row[i], 0) / rows.length) ?? Array(17).fill(0);
  dense.push(...groupFeatures(notes));
  dense.forEach((v, i) => {
    if (v !== 0) features.set(NSPAM_HASH_BUCKETS * 2 + i, Math.fround(v));
  });

  return features;
}
