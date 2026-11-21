/**
 * `a11y-genie cards [<scan>]` (spec 4.1, 7.2): writes `cards/<name>.md` into the scan folder, one card per finding,
 * worst first (src/cards.ts). It needs no browser and no network.
 *
 * `<scan>` is a scan folder, or the `scan.json` in it; the cards go into the folder that holds the `scan.json`. With
 * none, it reads the latest scan of the only site in the scans folder, and refuses when the folder holds more than
 * one site. The `scan.json` is a file this run did not write, so it is read as `check --baseline` reads one
 * (src/baseline.ts): held to its size limit, parsed as JSON only and checked against the schema before a field is
 * read. Exit 0 on success, 2 on a refusal, with nothing written.
 */

import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { latestScanOfOnlySite, readScanFile } from "./baseline.js";
import { cardFile, cardsOf, CARDS_DIR } from "./cards.js";
import { printable, printableLine } from "./printable.js";
import { Refusal } from "./refusal.js";
import { parseFlags } from "./scan-command.js";
import { defaultScansDir } from "./scans-folder.js";

/** Codes that mean the folder cannot be written here, so the run refuses instead of failing. */
const UNWRITABLE = ["EACCES", "EPERM", "ENOENT", "ENOTDIR", "EROFS", "ENOSPC", "EEXIST", "EISDIR"];

export function cardsCommand(args: string[], helpHint: string): void {
  const { positionals } = parseFlags(args, {}, helpHint);
  if (positionals.length > 1) {
    throw new Refusal(
      `cards takes one scan folder, and got more: ${JSON.stringify(positionals[1]?.slice(0, 80))}`,
      helpHint,
    );
  }
  const given = positionals[0];
  const path = given === undefined || given === "" ? latestScanOfOnlySite(defaultScansDir(), "cards") : given;
  const record = readScanFile(path, "the scan");
  const folder = statSync(path).isDirectory() ? path : dirname(path);
  const cards = cardsOf(record);
  if (cards.length === 0) {
    console.log(printable(`The scan has no open findings, so there is no card to write: ${folder}`));
    return;
  }

  const dir = join(folder, CARDS_DIR);
  let written = 0;
  try {
    mkdirSync(dir, { recursive: true });
    for (const card of cards) {
      writeFileSync(join(dir, card.file), printable(cardFile(card)), "utf8");
      written++;
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "";
    // A refusal writes nothing; once a card is written, a failure is unexpected (exit 3), never a refusal.
    if (written === 0 && UNWRITABLE.includes(code)) {
      throw new Refusal(`cannot write the cards in ${dir}: ${code}`, "give a scan folder you may write to.");
    }
    throw error;
  }

  console.log(
    printable(`Wrote ${cards.length} ${cards.length === 1 ? "card" : "cards"} in ${dir}, worst first:`),
  );
  for (const card of cards) console.log(printableLine(`${card.type}: ${card.title} (${card.file})`));
}
