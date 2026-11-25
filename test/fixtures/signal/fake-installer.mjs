// Stands in for playwright-core's installer, and touches no network. `slow <marker>`: on SIGINT it takes a second
// to stop, then writes the marker and exits. `stubborn`: it ignores SIGINT. Either says "installer ready <pid>"
// on stderr once its handler is set.
import { writeFileSync } from "node:fs";

const [mode, marker] = process.argv.slice(2);
process.on("SIGINT", () => {
  if (mode !== "slow") return;
  setTimeout(() => {
    writeFileSync(marker, "stopped\n");
    process.exit(1);
  }, 1_000);
});
process.stderr.write(`installer ready ${process.pid}\n`);
setInterval(() => {}, 60_000);
