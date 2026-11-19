import { afterEach } from "vitest";
import { installNoNetworkGuard, takeBlockedAttempts } from "../helpers/no-network.js";

installNoNetworkGuard();

// A test that reached off loopback fails, even if the code under test swallowed the error.
afterEach(() => {
  const blocked = takeBlockedAttempts();
  if (blocked.length > 0) {
    throw new Error(`A test tried to reach off loopback: ${blocked.join(", ")}`);
  }
});
