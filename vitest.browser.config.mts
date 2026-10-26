import { createRequire } from "node:module";
import { dirname } from "node:path";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

// Resolve RxJS from its workspace so browser dependencies can be optimized before tests start.
const relayRequire = createRequire(new URL("./packages/relay/package.json", import.meta.url));
const rxjs = dirname(relayRequire.resolve("rxjs/package.json"));

export default defineConfig({
  resolve: { alias: { rxjs } },
  optimizeDeps: { include: ["rxjs"] },
  test: {
    include: [
      "packages/extra/src/kehto/host/__tests__/host.browser.test.ts",
      "packages/core/src/helpers/__tests__/url.test.ts",
      "packages/core/src/helpers/__tests__/url-native.test.ts",
      "packages/relay/src/operators/__tests__/liveness.test.ts",
    ],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }, { browser: "firefox" }],
    },
  },
});
