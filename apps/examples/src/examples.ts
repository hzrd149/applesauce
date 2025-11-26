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
};

const examples: Example[] = [];

for (const [path, load] of Object.entries(modules)) {
  const source = async () => (await sources[path]()).default as string;

  const id = path.replace(/^.*\/examples\/|\.(tsx|ts)$/g, "");
  const name = id.replace(/\//g, " / ").replace(/[-_]/g, " ");

  examples.push({ id, name, path, load, source });
}

export default examples;
