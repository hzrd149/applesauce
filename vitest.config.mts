import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "**/*.browser.test.ts"],
    server: {
      deps: {
        inline: ["vitest-websocket-mock"],
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      include: ["packages/**/src/**/*.{ts,tsx}"],
      exclude: ["**/src/**/*.test.ts", "**/src/**/__tests__/**/*", "apps/examples/**/*"],
    },
  },
});
