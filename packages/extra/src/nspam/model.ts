import { NSPAM_FEATURE_COUNT } from "./features.js";

/** The nspam model version the feature extraction matches */
export const NSPAM_MODEL_VERSION = "v2.4";

/** The Hugging Face URL of the nspam model files, pinned to a commit so upstream retrains can't change scores */
export const NSPAM_MODEL_URL =
  "https://huggingface.co/barrydeen/nspam/resolve/29f76c80010554f64ef385608b20aad50ea0498e/v2.4";

/** A parsed nspam LightGBM model and its isotonic calibration table */
export type NspamModel = {
  /** The index of each tree's root node */
  roots: Int32Array;
  /** The feature index each node splits on */
  feature: Int32Array;
  threshold: Float64Array;
  /** Child node offsets within the tree, negative values are bitwise-inverted leaf indexes */
  left: Int32Array;
  right: Int32Array;
  /** The index of each tree's first leaf */
  leafOffset: Int32Array;
  leafValue: Float64Array;
  /** The summed output of single-leaf trees */
  bias: number;
  calibX: Float64Array;
  calibY: Float64Array;
};

/** The output of the nspam model for one author */
export type NspamScore = {
  /** The uncalibrated model probability */
  raw: number;
  /** The calibrated probability that the author is a reply spammer, between 0 and 1 */
  score: number;
};

/** Returns the raw and calibrated spam probability for an nspam feature vector */
export function predictNspam(model: NspamModel, features: Map<number, number>): NspamScore {
  let margin = model.bias;
  for (let t = 0; t < model.roots.length; t++) {
    const root = model.roots[t];
    let node = 0;
    for (;;) {
      const i = root + node;
      const next = (features.get(model.feature[i]) ?? 0) <= model.threshold[i] ? model.left[i] : model.right[i];
      if (next < 0) {
        margin += model.leafValue[model.leafOffset[t] + ~next];
        break;
      }
      node = next;
    }
  }
  const raw = 1 / (1 + Math.exp(-margin));

  // Isotonic calibration: piecewise-linear interpolation clamped to the end knots
  const { calibX: x, calibY: y } = model;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  if (raw <= x[0]) return { raw, score: clamp(y[0]) };
  const hi = x.findIndex((knot) => raw <= knot);
  if (hi === -1) return { raw, score: clamp(y[y.length - 1]) };
  return { raw, score: clamp(y[hi - 1] + ((raw - x[hi - 1]) / (x[hi] - x[hi - 1])) * (y[hi] - y[hi - 1])) };
}

/** Parses a LightGBM model.txt into flat typed arrays */
function parseLightGBM(text: string) {
  const header = (name: string) => text.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1];
  if (header("objective") !== "binary sigmoid:1") throw new Error("nspam model is not a binary LightGBM model");
  if (Number(header("max_feature_idx")) !== NSPAM_FEATURE_COUNT - 1)
    throw new Error(`nspam model does not have ${NSPAM_FEATURE_COUNT} features`);

  let bias = 0;
  const trees = [];
  for (const block of text.split("\nTree=").slice(1)) {
    const field = (name: string) =>
      block
        .match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]
        .split(" ")
        .map(Number) ?? [];
    const leafValue = field("leaf_value");
    const feature = field("split_feature");
    if (feature.length === 0) {
      bias += leafValue[0];
      continue;
    }
    // Only numerical splits without missing value handling (decision_type 0 or 2) are supported
    if (field("decision_type").some((d) => (d & ~2) !== 0)) throw new Error("nspam model has unsupported splits");
    trees.push({
      feature,
      leafValue,
      threshold: field("threshold"),
      left: field("left_child"),
      right: field("right_child"),
    });
  }

  const nodes = trees.reduce((n, t) => n + t.feature.length, 0);
  const leaves = trees.reduce((n, t) => n + t.leafValue.length, 0);
  const model = {
    roots: new Int32Array(trees.length),
    feature: new Int32Array(nodes),
    threshold: new Float64Array(nodes),
    left: new Int32Array(nodes),
    right: new Int32Array(nodes),
    leafOffset: new Int32Array(trees.length),
    leafValue: new Float64Array(leaves),
    bias,
  };
  let n = 0;
  let l = 0;
  trees.forEach((tree, i) => {
    model.roots[i] = n;
    model.leafOffset[i] = l;
    model.feature.set(tree.feature, n);
    model.threshold.set(tree.threshold, n);
    model.left.set(tree.left, n);
    model.right.set(tree.right, n);
    model.leafValue.set(tree.leafValue, l);
    n += tree.feature.length;
    l += tree.leafValue.length;
  });
  return model;
}

/** Reads the float arrays from a numpy .npz archive */
async function readNpz(buffer: ArrayBuffer): Promise<Record<string, Float64Array>> {
  const view = new DataView(buffer);
  const arrays: Record<string, Float64Array> = {};
  // Walk the zip local file headers
  for (let i = 0; i + 30 <= buffer.byteLength && view.getUint32(i, true) === 0x04034b50;) {
    if (view.getUint16(i + 6, true) & 8) throw new Error("npz entries with data descriptors are not supported");
    const method = view.getUint16(i + 8, true);
    const size = view.getUint32(i + 18, true);
    const nameLength = view.getUint16(i + 26, true);
    const start = i + 30 + nameLength + view.getUint16(i + 28, true);
    const name = new TextDecoder().decode(new Uint8Array(buffer, i + 30, nameLength)).replace(/\.npy$/, "");

    let data: Blob | ReadableStream<Uint8Array> = new Blob([new Uint8Array(buffer, start, size)]);
    if (method === 8) data = data.stream().pipeThrough(new DecompressionStream("deflate-raw"));
    else if (method !== 0) throw new Error(`Unsupported npz compression method ${method}`);
    const npy = new Uint8Array(await new Response(data).arrayBuffer());

    // Skip the .npy magic, version and header
    const headerLength = npy[8] | (npy[9] << 8);
    const descr = new TextDecoder().decode(npy.subarray(10, 10 + headerLength)).match(/'descr':\s*'([^']+)'/)?.[1];
    const body = npy.slice(10 + headerLength).buffer;
    if (descr === "<f4") arrays[name] = Float64Array.from(new Float32Array(body));
    else if (descr === "<f8") arrays[name] = new Float64Array(body);
    else throw new Error(`Unsupported npy dtype ${descr}`);
    i = start + size;
  }
  return arrays;
}

/**
 * Parses the nspam model.txt and calibration.npz files
 * @throws if the files are not a supported nspam model
 */
export async function parseNspamModel(modelText: string, calibration: ArrayBuffer): Promise<NspamModel> {
  const trees = parseLightGBM(modelText);
  const { calib_x, calib_y } = await readNpz(calibration);
  if (!calib_x || !calib_y) throw new Error("nspam calibration is missing calib_x or calib_y");
  return { ...trees, calibX: calib_x, calibY: calib_y };
}

/**
 * Downloads and parses the nspam model (about 9 MB)
 * @param url The directory containing model.txt and calibration.npz, defaults to the pinned Hugging Face model
 * @throws if either download fails or the files are not a supported nspam model
 */
export async function loadNspamModel(url: string = NSPAM_MODEL_URL): Promise<NspamModel> {
  const download = async (file: string) => {
    const res = await fetch(`${url}/${file}`);
    if (!res.ok) throw new Error(`Failed to download nspam ${file}: ${res.status}`);
    return res;
  };
  const [text, calibration] = await Promise.all([
    download("model.txt").then((r) => r.text()),
    download("calibration.npz").then((r) => r.arrayBuffer()),
  ]);
  return parseNspamModel(text, calibration);
}
