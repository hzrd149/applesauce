import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      include: ["packages/**/src/**/*"],
      exclude: ["**/src/**/*.test.ts", "**/src/**/__tests__/**/*", "apps/examples/**/*"],
    },
  },
});
