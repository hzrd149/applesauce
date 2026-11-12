import { createRequire } from "node:module";
import { dirname } from "node:path";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

// AUDIT-ONLY config for running the kehto security PoC browser tests.
// Mirrors vitest.browser.config.mts but includes only the .audit-poc.test.ts file.
const relayRequire = createRequire(new URL("./packages/relay/package.json", import.meta.url));
const rxjs = dirname(relayRequire.resolve("rxjs/package.json"));

export default defineConfig({
  resolve: { alias: { rxjs } },
  optimizeDeps: { include: ["rxjs"] },
  test: {
    include: ["packages/extra/src/kehto/**/*.audit-poc.test.ts"],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
});
