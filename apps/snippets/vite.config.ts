import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  base: process.env.VITE_BASE || "/",
  build: {
    target: ["chrome89", "edge89", "firefox89", "safari15"],
    sourcemap: true,
  },
  plugins: [react(), tailwindcss()],
  worker: {
    format: "es",
  },
});
