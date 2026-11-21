import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/setup/global-chromium.ts", "test/setup/run-folder.ts"],
    setupFiles: ["test/setup/no-network.ts", "test/setup/private-temp.ts"],
    // Browser and command tests launch a real browser, which takes more than the default 5 s on a busy machine.
    testTimeout: 30_000,
    env: {
      TZ: "UTC",
      // Every Playwright browser download, in this process or a child, goes to a dead loopback port, so
      // a test that reached playwright-core's real installer by mistake fails at once instead of downloading.
      PLAYWRIGHT_DOWNLOAD_HOST: "http://127.0.0.1:9",
      PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST: "http://127.0.0.1:9",
    },
  },
});
