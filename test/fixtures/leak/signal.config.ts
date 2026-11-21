import { defineConfig } from "vitest/config";

// The config for test/fixtures/leak/signal.fixture.ts only; the main config never includes it.
export default defineConfig({
  test: {
    include: ["test/fixtures/leak/signal.fixture.ts"],
    // As the main config: the run's folder, and its cleanup when vitest itself is stopped by a signal.
    globalSetup: ["test/setup/run-folder.ts"],
    setupFiles: ["test/setup/no-network.ts", "test/setup/private-temp.ts"],
    // Long: the run is stopped by SIGTERM while the test still waits, never by its own timeout.
    testTimeout: 60_000,
    env: { TZ: "UTC" },
  },
});
