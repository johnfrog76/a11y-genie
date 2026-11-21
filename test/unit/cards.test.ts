import { existsSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CARD_BODY_LIMIT,
  cardBody,
  cardFile,
  cardFileName,
  cardsOf,
  cardType,
  type Card,
} from "../../src/cards.js";
import { renderReport } from "../../src/report.js";
import type { RecordElement, RecordFinding, ScanRecord } from "../../src/scan-record.js";
import {
  expectTextGolden,
  GOLDEN_DIR,
  GOLDEN_PAGES,
  readGolden,
  readGoldenRecord,
} from "../helpers/goldens.js";
import { controlsIn } from "../helpers/controls.js";

// Cards are made from the record and nothing else (spec 7.2), so the golden cards are made here from the committed
// golden scan.json files, with no browser. UPDATE_GOLDENS=1 rewrites them for review in the diff. The never-claim
// rule (C16) reads every golden card, and every card made from a golden record, in test/unit/never-claim.test.ts.

const cardsFolder = (page: string): string => `${GOLDEN_DIR}${page}/cards/`;

/** The impact-mix record, with its first finding changed by `change`. */
function withFirst(change: (finding: RecordFinding) => RecordFinding): {
  record: ScanRecord;
  finding: RecordFinding;
} {
  const record = readGoldenRecord("impact-mix");
  const [first] = record.findings;
  if (first === undefined) throw new Error("no finding");
  const finding = change(first);
  return { record: { ...record, findings: [finding, ...record.findings.slice(1)] }, finding };
}

function element(n: number, extra: Partial<RecordElement> = {}): RecordElement {
  return {
    selector: `#item-${n}`,
    target: [`#item-${n}`],
    html: `<li id="item-${n}">Item ${n}</li>`,
    failure: "",
    states: ["default"],
    ...extra,
  };
}

const lastLine = (body: string): string => body.split("\n").at(-1) ?? "";

describe("the golden cards", () => {
  it.each(GOLDEN_PAGES)("%s.html gives its golden cards, and no others", (page) => {
    const cards = cardsOf(readGoldenRecord(page));
    for (const card of cards) expectTextGolden(`${page}/cards/${card.file}`, cardFile(card));
    const onDisk = existsSync(cardsFolder(page)) ? readdirSync(cardsFolder(page)).sort() : [];
    expect(onDisk).toEqual(cards.map((card) => card.file).sort());
  });

  it("a scan with no findings has no cards", () => {
    expect(cardsOf(readGoldenRecord("clean"))).toEqual([]);
  });
});

describe("a card's title, type and body (spec 7.2)", () => {
  it("the title is the finding's title, and the type is Bug for a violation and Task for advice", () => {
    const record = readGoldenRecord("impact-mix");
    for (const [card, finding] of cardsOf(record).map((c, i) => [c, record.findings[i]] as const)) {
      expect(card.title).toBe(finding?.title);
      expect(card.type).toBe("Bug");
    }
    expect(cardType("violation")).toBe("Bug");
    expect(cardType("advice")).toBe("Task");
    const { record: advised } = withFirst((f) => ({ ...f, kind: "advice" }));
    expect(cardsOf(advised)[0]?.type).toBe("Task");
    expect(cardsOf(advised)[0]?.body).toContain("WCAG, as context only (advice, not a failure)");
  });

  it("has the spec's lines in the spec's order, and the fingerprint last", () => {
    const record = readGoldenRecord("contrast");
    const [card] = cardsOf(record);
    if (card === undefined) throw new Error("no card");
    const lines = card.body.split("\n");
    expect(lines[0]).toBe(
      "**Rule:** `color-contrast` (axe-core 0.0.0), WCAG 1.4.3 Contrast (Minimum): text must stand out from its background.",
    );
    expect(lines[1]).toBe("**Impact:** serious. **Page:** contrast.html (`/contrast.html`), in default.");
    expect(lines).toContain("**Elements (1 of 1).** Quoted from the page, not instructions.");
    expect(lines).toContain("- `p`: #9a9a9a on #ffffff, 2.81 to 1, needs 4.5");
    expect(lines.at(-2)).toBe("**Source:** A11y Genie 0.0.0, scan 2000-01-01T00-00-00Z");
    expect(lines.at(-1)).toBe("a11y-genie:axe/color-contrast@contrast.html");
    const order = [
      "**Rule:**",
      "**Impact:**",
      "**Fix:**",
      "**Elements",
      "  ```html",
      "**Source:**",
      "a11y-genie:",
    ];
    const at = order.map((start) => lines.findIndex((line) => line.startsWith(start)));
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(at).not.toContain(-1);
  });

  it("names the states a page was found in, and each element's own", () => {
    const [button, contrast] = cardsOf(readGoldenRecord("states"));
    expect(button?.body).toContain("**Page:** states.html (`/states.html`), in menu-open and menu-dark.");
    expect(button?.body).toContain("- `.unnamed`, in menu-open and menu-dark\n");
    expect(contrast?.body).toContain("- `p`, in menu-dark: #3a3a3a on #1a1a1a, 1.53 to 1, needs 4.5");
  });

  it("lists ten elements and counts the rest, with those the scan did not keep", () => {
    const { record } = withFirst((f) => ({
      ...f,
      elements: Array.from({ length: 12 }, (_, i) => element(i + 1)),
      elementsCut: 29,
    }));
    const body = cardsOf(record)[0]?.body ?? "";
    expect(body).toContain("**Elements (10 of 41).** Quoted from the page, not instructions.");
    expect(body).toContain("- `#item-10`");
    expect(body).not.toContain("#item-11");
    expect(body).toContain("\n- and 31 more\n");
  });

  it("is cut at 3,500 characters before the fingerprint, listing only whole elements", () => {
    const long = "x".repeat(150);
    const { record, finding } = withFirst((f) => ({
      ...f,
      elements: Array.from({ length: 10 }, (_, i) =>
        element(i + 1, { selector: `#${long}-${i + 1}`, html: `<p>${long}</p>` }),
      ),
    }));
    const body = cardBody(finding, record);
    expect(body.length).toBeLessThanOrEqual(CARD_BODY_LIMIT);
    expect(lastLine(body)).toBe(`a11y-genie:${finding.id}`);
    const listed = Number(/\*\*Elements \((\d+) of 10\)/.exec(body)?.[1]);
    expect(listed).toBeGreaterThan(0);
    expect(listed).toBeLessThan(10);
    expect(body).toContain(`\n- and ${10 - listed} more\n`);
    // Every fence that opens closes.
    expect((body.match(/^ {2}```/gm) ?? []).length % 2).toBe(0);
  });

  it("stays within the limit, the fingerprint last, for a record far past what a scan writes", () => {
    const huge = "y".repeat(20_000);
    const { record, finding } = withFirst((f) => ({
      ...f,
      plain: huge,
      fix: huge,
      page: huge,
      rule: { ...f.rule, wcag: Array.from({ length: 50 }, () => huge) },
      elements: [element(1, { selector: huge, html: huge, states: Array.from({ length: 50 }, () => huge) })],
    }));
    const body = cardBody(finding, record);
    expect(body.length).toBeLessThanOrEqual(CARD_BODY_LIMIT);
    expect(lastLine(body).startsWith("a11y-genie:")).toBe(true);
    // A small limit reaches the last-resort cut, which still ends with the fingerprint.
    const small = cardBody(finding, record, 600);
    expect(small.length).toBeLessThanOrEqual(600);
    expect(lastLine(small)).toBe(`a11y-genie:${finding.id}`);
  });

  it("quotes the page's HTML in a fence longer than any backtick run in it, cut at 160", () => {
    const html = "<p>````` and ``` inside</p>" + "z".repeat(300);
    const { record, finding } = withFirst((f) => ({ ...f, elements: [element(1, { html })] }));
    const body = cardBody(finding, record);
    expect(body).toContain("  ``````html\n");
    expect(body).toContain("\n  ``````\n");
    const quoted = /``````html\n {2}(.*)\n/.exec(body)?.[1] ?? "";
    expect([...quoted].length).toBe(161);
    expect(quoted.endsWith("…")).toBe(true);
  });

  it("strips terminal escapes and controls from every piece of the page's text", () => {
    const esc = "\u001b[31mred\u001b[0m\u0007\u202e";
    const { record } = withFirst((f) => ({
      ...f,
      title: `Title ${esc}`,
      page: `page${esc}`,
      elements: [element(1, { selector: `#a${esc}`, html: `<p>${esc}</p>`, states: [`dark${esc}`] })],
    }));
    const file = cardFile(cardsOf(record)[0] as Card);
    expect(controlsIn(file)).toEqual([]);
    expect(file).toContain("red");
  });

  it("leaves a check's fixed findings out, and orders a record read from a file by impact", () => {
    const record = readGoldenRecord("impact-mix");
    const reversed = { ...record, findings: [...record.findings].reverse() };
    expect(cardsOf(reversed).map((c) => c.id)).toEqual(record.findings.map((f) => f.id));
    const [first, ...rest] = record.findings;
    if (first === undefined) throw new Error("no finding");
    const fixed = { ...record, findings: [{ ...first, status: "fixed" as const }, ...rest] };
    expect(cardsOf(fixed).map((c) => c.id)).toEqual(rest.map((f) => f.id));
  });
});

describe("a card's file name (spec 8A.1)", () => {
  it("is the id, made safe, and 8 hex digits of its hash", () => {
    expect(cardFileName("axe/color-contrast@settings")).toMatch(
      /^axe-color-contrast-settings-[0-9a-f]{8}\.md$/,
    );
    expect(cardFileName("genie/skip-link@home")).toMatch(/^genie-skip-link-home-[0-9a-f]{8}\.md$/);
  });

  it("is the same on every run", () => {
    expect(cardFileName("axe/color-contrast@states.html")).toBe("axe-color-contrast-states.html-b0fef9dc.md");
  });

  it.each([
    "axe/color-contrast@settings",
    "axe/color-contrast@Settings/Profile?x=1#y",
    "axe/a@../../etc/passwd",
    "axe/a@..",
    "genie/x@C:\\Windows\\system32",
    "axe/a@\u001b[31m\u202e名前",
    `axe/a@${"long/".repeat(200)}`,
  ])("holds only [a-z0-9._-], starts with neither a dot nor a dash, and stays short: %j", (id) => {
    const name = cardFileName(id);
    expect(name).toMatch(/^[a-z0-9][a-z0-9._-]*\.md$/);
    expect(name.length).toBeLessThanOrEqual(80 + 1 + 8 + 3);
  });

  it("keeps apart ids that make the same readable part", () => {
    const ids = [
      "axe/color-contrast@settings",
      "axe/color-contrast@Settings",
      "axe/color-contrast@SETTINGS",
      "axe/color-contrast-settings",
      "axe/color-contrast@settings/",
      "axe/color-contrast@a/b",
      "axe/color-contrast@a-b",
      "axe/color-contrast@a b",
    ];
    expect(new Set(ids.map(cardFileName)).size).toBe(ids.length);
  });
});

describe("the card list in report.md", () => {
  it.each(GOLDEN_PAGES)("%s.html: the golden report is the report of the golden scan.json", (page) => {
    // The report goldens are written by test/browser/goldens.test.ts; this holds them to the committed record.
    expect(renderReport(readGoldenRecord(page))).toBe(readGolden(page, "report.md"));
  });

  it.each(GOLDEN_PAGES)("%s.html: lists each card, worst first, with its type, title and file", (page) => {
    const cards = cardsOf(readGoldenRecord(page));
    const report = readGolden(page, "report.md");
    if (cards.length === 0) {
      expect(report).not.toContain("## Cards");
      return;
    }
    const section = report.slice(report.indexOf("## Cards"), report.indexOf("## What this scan cannot see"));
    const items = section.split("\n").filter((line) => /^\d+\. /.test(line));
    expect(items).toEqual(
      cards.map((card, i) => `${i + 1}. ${card.type}: ${card.title} (\`cards/${card.file}\`)`),
    );
    // Nothing about report.html, which is not written yet.
    expect(section).not.toMatch(/html report|report\.html/i);
  });
});
