import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cardsOf } from "../../src/cards.js";
import { SCANS_DIR_ENV } from "../../src/scans-folder.js";
import { builtCli } from "../helpers/built-cli.js";
import { GOLDEN_DIR, readGolden, readGoldenRecord } from "../helpers/goldens.js";

// Runs the built command (npm test builds first), as a person would. `cards` needs no browser or network: it reads a
// scan.json and writes Markdown files beside it.
const cli = builtCli();

const made: string[] = [];
afterAll(() => {
  for (const folder of made) rmSync(folder, { recursive: true, force: true });
});
function fresh(): string {
  const folder = mkdtempSync(join(tmpdir(), "a11y-genie-cards-"));
  made.push(folder);
  return folder;
}

/** A scan folder holding the golden `page`'s scan.json, at `<root>/<site>/<time>/`. */
function scanFolder(
  page: string,
  root = fresh(),
  site = "127.0.0.1-4173",
  time = "2026-11-19T20-14-03Z",
): string {
  const folder = join(root, site, time);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "scan.json"), readGolden(page, "scan.json"));
  return folder;
}

function run(
  args: string[],
  scans: string = fresh(),
): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [cli, "cards", ...args], {
    encoding: "utf8",
    env: { ...process.env, [SCANS_DIR_ENV]: scans },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function expectRefusal(r: ReturnType<typeof run>, error: RegExp): void {
  expect(r.status).toBe(2);
  expect(r.stdout).toBe("");
  const lines = r.stderr.trimEnd().split("\n");
  expect(lines).toHaveLength(2);
  expect(lines[0]).toMatch(/^Error: /);
  expect(lines[0]).toMatch(error);
  expect(lines[1]).toMatch(/^Hint: /);
}

describe("a11y-genie cards <scan>", () => {
  it("writes the golden cards into the scan folder, worst first, and says so", () => {
    const folder = scanFolder("impact-mix");
    const r = run([folder]);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    const cards = cardsOf(readGoldenRecord("impact-mix"));
    expect(readdirSync(join(folder, "cards")).sort()).toEqual(cards.map((c) => c.file).sort());
    for (const card of cards) {
      expect(readFileSync(join(folder, "cards", card.file), "utf8")).toBe(
        readFileSync(`${GOLDEN_DIR}impact-mix/cards/${card.file}`, "utf8"),
      );
    }
    const lines = r.stdout.trimEnd().split("\n");
    expect(lines[0]).toBe(`Wrote 4 cards in ${join(folder, "cards")}, worst first:`);
    expect(lines.slice(1)).toEqual(cards.map((c) => `${c.type}: ${c.title} (${c.file})`));
  });

  it("takes the scan.json itself, and writes the same cards again on a second run", () => {
    const folder = scanFolder("states");
    expect(run([join(folder, "scan.json")]).status).toBe(0);
    const first = readdirSync(join(folder, "cards")).map((f) =>
      readFileSync(join(folder, "cards", f), "utf8"),
    );
    expect(run([folder]).status).toBe(0);
    const again = readdirSync(join(folder, "cards")).map((f) =>
      readFileSync(join(folder, "cards", f), "utf8"),
    );
    expect(again).toEqual(first);
    expect(first).toHaveLength(2);
  });

  it("writes no card for a scan with no findings, and says so", () => {
    const folder = scanFolder("clean");
    const r = run([folder]);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(`The scan has no open findings, so there is no card to write: ${folder}\n`);
    expect(existsSync(join(folder, "cards"))).toBe(false);
  });

  it("refuses a scan.json it cannot read as one, and writes nothing", () => {
    const folder = join(fresh(), "scan");
    mkdirSync(folder);
    writeFileSync(join(folder, "scan.json"), "{ not json");
    expectRefusal(run([folder]), /^Error: the scan is not a scan\.json: .* is not JSON\.$/);
    expect(existsSync(join(folder, "cards"))).toBe(false);
    expectRefusal(run([join(fresh(), "missing")]), /^Error: the scan cannot be read: .*\(ENOENT\)$/);
    const bad = JSON.parse(readGolden("impact-mix", "scan.json")) as { findings: { impact: string }[] };
    (bad.findings[0] as { impact: string }).impact = "severe";
    writeFileSync(join(folder, "scan.json"), JSON.stringify(bad));
    expectRefusal(run([folder]), /does not match schema\/scan-1\.json at/);
    expect(existsSync(join(folder, "cards"))).toBe(false);
  });

  it("refuses a second argument and an unknown flag", () => {
    expectRefusal(run(["a", "b"]), /^Error: cards takes one scan folder, and got more: "b"$/);
    expectRefusal(run(["--toolkit"]), /^Error: Unknown option '--toolkit'/);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "refuses a scan folder it cannot write to, and writes nothing",
    () => {
      const folder = scanFolder("contrast");
      chmodSync(folder, 0o500);
      try {
        expectRefusal(run([folder]), /^Error: cannot write the cards in .*cards: EACCES$/);
      } finally {
        chmodSync(folder, 0o700);
      }
      expect(existsSync(join(folder, "cards"))).toBe(false);
    },
  );
});

describe("a11y-genie cards, with no <scan>", () => {
  it("reads the latest scan of the only site in the scans folder", () => {
    const root = fresh();
    scanFolder("contrast", root, "127.0.0.1-4173", "2026-11-19T20-14-03Z");
    const latest = scanFolder("states", root, "127.0.0.1-4173", "2026-11-19T20-14-03Z-2");
    mkdirSync(join(root, "127.0.0.1-4173", "not-a-scan"));
    // A folder with no scan in it is not a site.
    mkdirSync(join(root, "empty-site"));
    const r = run([], root);
    expect(r.status).toBe(0);
    expect(readdirSync(join(latest, "cards")).sort()).toEqual(
      cardsOf(readGoldenRecord("states"))
        .map((c) => c.file)
        .sort(),
    );
  });

  it("refuses when the scans folder holds more than one site, and the hint lists them", () => {
    const root = fresh();
    scanFolder("contrast", root, "localhost-5173");
    const other = scanFolder("states", root, "127.0.0.1-4173");
    const r = run([], root);
    expectRefusal(
      r,
      /^Error: the scans folder holds scans of 2 sites, so cards cannot tell which one to read\.$/,
    );
    expect(r.stderr).toContain(`Hint: give the scan folder to read, such as a11y-genie cards "${other}".`);
    expect(r.stderr).toContain("The sites: 127.0.0.1-4173, localhost-5173.");
    expect(existsSync(join(other, "cards"))).toBe(false);
  });

  it("refuses when the scans folder holds no scan", () => {
    const root = fresh();
    expectRefusal(run([], root), /^Error: there is no scan in the scans folder for cards to read: /);
    expectRefusal(run([], join(root, "missing")), /^Error: there is no scan in the scans folder/);
  });
});

describe("a11y-genie --help", () => {
  it("lists cards with the commands that work, not with those still coming", () => {
    const help = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" }).stdout;
    const coming = help.indexOf("Commands (coming");
    expect(help.indexOf("  a11y-genie cards [<scan>]")).toBeGreaterThan(0);
    expect(help.indexOf("\n  cards      ")).toBeGreaterThan(0);
    expect(help.indexOf("\n  cards      ")).toBeLessThan(coming);
    expect(help.slice(coming)).not.toContain("cards");
  });
});
