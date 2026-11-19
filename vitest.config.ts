import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup/no-network.ts"],
    env: {
      TZ: "UTC",
      // Every Playwright browser download, in this process or a child, goes to a dead loopback port, so
      // a test that reached playwright-core's real installer by mistake fails at once instead of downloading.
      PLAYWRIGHT_DOWNLOAD_HOST: "http://127.0.0.1:9",
      PLAYWRIGHT_CHROMIUM_DOWNLOAD_HOST: "http://127.0.0.1:9",
    },
  },
});
