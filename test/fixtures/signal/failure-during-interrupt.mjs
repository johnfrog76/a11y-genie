// A run waiting on something the signal's cleanup breaks, as a scan waiting on the browser that Ctrl-C closes:
// the cleanup makes the wait fail, then takes a moment more to settle, as closing a browser does. The failure
// goes to the same report as the command's (src/cli.ts). test/cli/interrupt-failure.test.ts sends it a signal.
import { installInterruptHandler, onInterrupted } from "../../../dist/interrupt.js";
import { reportFailure } from "../../../dist/refusal.js";

installInterruptHandler();
let fail;
const waiting = new Promise((_, reject) => (fail = reject));
onInterrupted(async () => {
  fail(new Error("page.evaluate: Target page, context or browser has been closed"));
  await new Promise((done) => setTimeout(done, 200));
});
process.stdout.write("ready\n");
// A scan keeps the process alive with its browser; this does the same until the interrupt exits.
setInterval(() => {}, 60_000);
try {
  await waiting;
} catch (error) {
  reportFailure(error);
}
