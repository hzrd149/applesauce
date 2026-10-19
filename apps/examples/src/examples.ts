import Fuse from "fuse.js";
import { parseMetadata, type ExampleMetadata } from "./metadata";

const modules = import.meta.glob(["./examples/**/*.tsx", "./examples/**/*.ts"]);
const sources = import.meta.glob<string>(["./examples/**/*.tsx", "./examples/**/*.ts"], {
  query: "?raw",
  import: "default",
});
// Parsed at build time by the example-metadata plugin in vite.config.ts
const metadata = import.meta.glob<ExampleMetadata>(["./examples/**/*.tsx", "./examples/**/*.ts"], {
  query: "?meta",
  import: "default",
  eager: true,
});

export type Example = {
  id: string;
  /** The formatted id used for navigation, e.g. "relay discovery / relay directory" */
  name: string;
  /** The formatted file name without the category */
  title: string;
  /** The top level folder of the example */
  category: string;
  path: string;
  load: () => Promise<unknown>;
  source: () => Promise<string>;
  metadata: ExampleMetadata;
};

export type Category = {
  id: string;
  label: string;
  examples: Example[];
};

const CATEGORY_LABELS: Record<string, string> = {
  negentrapy: "Negentropy",
  nwc: "Nostr Wallet Connect",
  "rx-views": "RxJS views",
  nsite: "nsite",
};

function formatCategory(id: string) {
  const label = id.replace(/[-_]/g, " ");
  return CATEGORY_LABELS[id] ?? label.charAt(0).toUpperCase() + label.slice(1);
}

const examples: Example[] = [];

for (const [path, load] of Object.entries(modules)) {
  const id = path.replace(/^.*\/examples\/|\.(tsx|ts)$/g, "");
  const category = id.includes("/") ? id.split("/")[0] : "general";

  let cleanedSourceCache: string | undefined;
  const source = async () => {
    cleanedSourceCache ??= parseMetadata(await sources[path]()).code;
    return cleanedSourceCache;
  };

  examples.push({
    id,
    name: id.replace(/\//g, " / ").replace(/[-_]/g, " "),
    title: id.slice(id.lastIndexOf("/") + 1).replace(/[-_]/g, " "),
    category,
    path,
    load: load as () => Promise<unknown>,
    source,
    metadata: metadata[path] ?? {},
  });
}

/** All examples grouped by their top level folder and sorted by label */
export const categories: Category[] = [];
for (const example of examples) {
  let category = categories.find((c) => c.id === example.category);
  if (!category) {
    category = { id: example.category, label: formatCategory(example.category), examples: [] };
    categories.push(category);
  }
  category.examples.push(example);
}
categories.sort((a, b) => a.label.localeCompare(b.label));

/** Returns the display label for a category id */
export function getCategoryLabel(id: string) {
  return categories.find((c) => c.id === id)?.label ?? formatCategory(id);
}

const fuse = new Fuse(examples, {
  keys: [
    { name: "title", weight: 3 },
    { name: "category", weight: 2, getFn: (e) => [e.category, formatCategory(e.category)] },
    { name: "metadata.tags", weight: 2 },
    { name: "metadata.description", weight: 1 },
  ],
  threshold: 0.35,
  ignoreLocation: true,
});

const searchText = new Map(
  examples.map((e) => [
    e,
    [e.id, e.title, formatCategory(e.category), e.metadata.description, ...(e.metadata.tags ?? [])]
      .join(" ")
      .toLowerCase(),
  ]),
);

/** Returns the examples ranked by a fuzzy match on name, category, tags and description */
export function searchExamples(query: string): Example[] {
  const trimmed = query.trim();
  if (!trimmed) return examples;

  const ranked = fuse.search(trimmed).map((result) => result.item);

  // Fuzzy matching makes "nip-65" match "nip-05", so prefer examples containing every word and only fall back to typos
  const words = trimmed.toLowerCase().split(/\s+/);
  const exact = new Set(examples.filter((e) => words.every((word) => searchText.get(e)!.includes(word))));
  if (exact.size === 0) return ranked;
  return [...ranked.filter((e) => exact.has(e)), ...[...exact].filter((e) => !ranked.includes(e))];
}

export default examples;
