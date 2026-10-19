import { readFile } from "node:fs/promises";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

import { parseMetadata } from "./src/metadata.ts";

/** Loads `file?meta` as the parsed JSDoc metadata of an example so the landing page can search without bundling sources */
function exampleMetadata(): Plugin {
  return {
    name: "example-metadata",
    async load(id) {
      if (!id.endsWith("?meta")) return;
      const file = id.slice(0, -"?meta".length);
      this.addWatchFile(file);
      const { metadata } = parseMetadata(await readFile(file, "utf-8"));
      return `export default ${JSON.stringify(metadata ?? {})}`;
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  base: process.env.VITE_BASE || "/",
  build: {
    target: "es2022",
    sourcemap: true,
  },
  oxc: {
    target: "es2022",
  },
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
  },
  plugins: [exampleMetadata(), react(), tailwindcss()],
});
