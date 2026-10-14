import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

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
  plugins: [react(), tailwindcss()],
});
