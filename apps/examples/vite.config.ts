import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { build, defineConfig, type Plugin, type Rolldown } from "vite";
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

/**
 * Loads `index.html?napplet` as one self-contained HTML string, bundling its module script and imported CSS inline
 * because napplets run from a sandboxed srcdoc whose CSP only allows inline scripts and styles
 */
function builtInNapplets(): Plugin {
  return {
    name: "built-in-napplets",
    async load(id) {
      if (!id.endsWith(".html?napplet")) return;
      const htmlFile = id.slice(0, -"?napplet".length);
      this.addWatchFile(htmlFile);
      const html = await readFile(htmlFile, "utf-8");

      const scriptTag = html.match(/<script\s+type="module"\s+src="([^"]+)"\s*><\/script>/);
      if (!scriptTag) throw new Error(`${htmlFile} needs one <script type="module" src="..."> entry`);
      const entry = resolve(dirname(htmlFile), scriptTag[1]);

      const result = await build({
        configFile: false,
        logLevel: "silent",
        build: {
          write: false,
          target: "es2022",
          minify: false,
          cssCodeSplit: false,
          rolldownOptions: { input: entry, output: { format: "iife" } },
        },
      });

      const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[];
      let script = "";
      let style = "";
      for (const file of outputs.flatMap((output) => output.output)) {
        if (file.type === "chunk") {
          script += file.code;
          for (const moduleId of file.moduleIds) if (!moduleId.includes("node_modules")) this.addWatchFile(moduleId);
        } else if (file.fileName.endsWith(".css")) {
          style += String(file.source);
        }
      }

      // Keep bundled code from closing the inline tags early
      const inlineScript = `<script>${script.replace(/<\/script/gi, "<\\/script")}</script>`;
      const inlineStyle = style ? `<style>${style.replace(/<\/style/gi, "<\\/style")}</style>` : "";
      const output = html.replace(scriptTag[0], () => inlineScript).replace("</head>", () => `${inlineStyle}</head>`);

      return `export default ${JSON.stringify(output)}`;
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
  plugins: [exampleMetadata(), builtInNapplets(), react(), tailwindcss()],
});
