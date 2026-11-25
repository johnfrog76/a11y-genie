// A run whose cleanup never settles, as a browser that will not close: it takes its own temp folder, registers
// the cleanup, says "ready" with the folder's path, and waits. test/cli/interrupt-cap.test.ts sends it a signal.
import { installInterruptHandler, onInterrupted } from "../../../dist/interrupt.js";
import { usePrivateTemp } from "../../../dist/private-temp.js";

installInterruptHandler();
const folder = usePrivateTemp();
onInterrupted(() => new Promise(() => {}));
process.stdout.write(`ready ${folder}\n`);
setInterval(() => {}, 60_000);
