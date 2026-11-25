// A download, with a fake installer in place of playwright-core's: its script and arguments come after this
// file's. The installer's "installer ready" line comes out on its stderr. test/cli/interrupt-download.test.ts signals it.
import { installInterruptHandler } from "../../../dist/interrupt.js";
import { runInstaller } from "../../../dist/chromium-download.js";
import { reportFailure } from "../../../dist/refusal.js";

installInterruptHandler();
try {
  await runInstaller(process.argv.slice(2));
} catch (error) {
  reportFailure(error);
}
