// Preloaded into the built command (node --import) by test/cli/private-temp.test.ts: every write to a file
// fails, so a scan that has finished loading its page ends in an unexpected error (exit 3).
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

fs.writeFileSync = () => {
  throw new Error("disk full");
};
syncBuiltinESMExports();
