import { parseMetadata, type ExampleMetadata } from "./metadata";

const modules = import.meta.glob("./examples/**/*.(tsx|ts)");
const sources = import.meta.glob("./examples/**/*.(tsx|ts)", { query: "?raw" }) as Record<
  string,
  () => Promise<{ default: string }>
>;

export type Example = {
  id: string;
  name: string;
  path: string;
  load: () => Promise<unknown>;
  source: () => Promise<string>;
  metadata?: ExampleMetadata;
};

const examples: Example[] = [];

for (const [path, load] of Object.entries(modules)) {
  const id = path.replace(/^.*\/examples\/|\.(tsx|ts)$/g, "");
  const generatedName = id.replace(/\//g, " / ").replace(/[-_]/g, " ");

  // Cache for frontmatter and cleaned source
  let frontmatterCache: ExampleMetadata | undefined;
  let cleanedSourceCache: string | undefined;

  const source = async () => {
    if (cleanedSourceCache !== undefined) {
      return cleanedSourceCache;
    }

    const rawSource = (await sources[path]()).default as string;
    const { metadata: frontmatter, code } = parseMetadata(rawSource);

    frontmatterCache = frontmatter || undefined;
    cleanedSourceCache = code;

    return cleanedSourceCache;
  };

  examples.push({
    id,
    name: generatedName, // Always use the formatted path for navigation
    path,
    load: load as () => Promise<unknown>,
    source,
    get metadata() {
      return frontmatterCache;
    },
  });
}

export default examples;
