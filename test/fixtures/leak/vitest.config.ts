import { defineConfig } from "vitest/config";

// The config for test/fixtures/leak/leak.fixture.ts only; the main config never includes it.
export default defineConfig({
  test: {
    include: ["test/fixtures/leak/leak.fixture.ts"],
    setupFiles: ["test/setup/no-network.ts", "test/setup/private-temp.ts"],
    // Short, so the second test times out while its scan is still waiting for the page.
    testTimeout: 3_000,
    env: { TZ: "UTC" },
  },
});
