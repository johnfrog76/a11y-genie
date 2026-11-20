import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { escapeHtml, linkable, markup } from "../../src/html-escape.js";
import { REPORT_CSS } from "../../src/html-report-style.js";
import { contentSecurityPolicy, cspHash, humanTime, renderHtmlReport } from "../../src/html-report.js";
import { emptyScanSentence, renderReport } from "../../src/report.js";
import { expectTextGolden, GOLDEN_PAGES, readGolden, readGoldenRecord } from "../helpers/goldens.js";
import { neverClaimViolations } from "../helpers/never-claim.js";
import { ALL_HOSTILE, goldenCheckRecord, HOSTILE, hostileRecord } from "../helpers/report-records.js";

/** The elements the report is built from. Any other tag in a report came from somewhere it should not have. */
const OUR_TAGS = new Set(
  (
    "html head meta title style body a div header p h1 h2 h3 nav ul ol li main section table caption thead " +
    "tbody tr th td dl dt dd pre code span strong svg rect details summary footer"
  ).split(" "),
);

/** Every tag name opened in `page`. */
function tagsIn(page: string): Set<string> {
  return new Set(
    [...page.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)/g)].map(([, name]) => (name ?? "").toLowerCase()),
  );
}

/** Every attribute name used in `page`'s tags. */
function attributesIn(page: string): Set<string> {
  const names = new Set<string>();
  for (const [tag] of page.matchAll(/<[a-zA-Z][^>]*>/g)) {
    for (const [, name] of tag.matchAll(/\s([a-zA-Z-]+)=/g)) names.add((name ?? "").toLowerCase());
  }
  return names;
}

/** The text of every `<h2>` or `<h3>` in a report, tags taken out and character references read back. */
function headings(page: string, level: 2 | 3): string[] {
  return [...page.matchAll(new RegExp(`<h${level}[^>]*>([\\s\\S]*?)</h${level}>`, "g"))].map(([, inner]) =>
    (inner ?? "")
      .replace(/<[^>]+>/g, "")
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&"),
  );
}

const CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/; // eslint-disable-line no-control-regex

describe("escapeHtml", () => {
  it.each([
    [HOSTILE.script, "&lt;script&gt;alert(1)&lt;/script&gt;"],
    [HOSTILE.breakOut, "&quot;&gt;&lt;img src=x onerror=alert(1)&gt;"],
    ["it's & that", "it&#39;s &amp; that"],
    [HOSTILE.javascriptUrl, "javascript:alert(1)"],
    [HOSTILE.closeStyle, "&lt;/style&gt;&lt;style&gt;body{display:none}&lt;/style&gt;"],
    [HOSTILE.escapes, "RED click here done"],
    [HOSTILE.bidi, "evil"],
  ])("escapes %j", (text, escaped) => {
    expect(escapeHtml(text)).toBe(escaped);
  });

  it("leaves no character HTML reads as markup, and no control", () => {
    const out = escapeHtml(ALL_HOSTILE);
    expect(out).not.toMatch(/[<>"']/);
    expect(out).not.toMatch(CONTROLS);
    expect(out).not.toContain("evil.example");
    expect(out).not.toContain("window title");
  });

  it("is what markup`` does to every value, but markup it made goes in as it is", () => {
    const inner = markup`<code>${HOSTILE.script}</code>`;
    expect(
      markup`<p>${HOSTILE.breakOut}${inner}${[HOSTILE.script, 3]}${undefined}${false}</p>`.toString(),
    ).toBe(
      `<p>${escapeHtml(HOSTILE.breakOut)}<code>${escapeHtml(HOSTILE.script)}</code>${escapeHtml(HOSTILE.script)}3</p>`,
    );
  });

  it("only an https: address may be a link", () => {
    expect(linkable("https://dequeuniversity.com/rules/axe/4.14/image-alt")).toBe(true);
    for (const url of [
      HOSTILE.javascriptUrl,
      " javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "data:text/html,x",
      "file:///etc/hosts",
      "http://example.com/",
      "//example.com/",
      "not a url",
      "",
    ]) {
      expect(linkable(url), url).toBe(false);
    }
  });
});

describe("a hostile record's report", () => {
  const page = renderHtmlReport(hostileRecord());

  it("holds no tag and no attribute but the report's own", () => {
    expect([...tagsIn(page)].filter((tag) => !OUR_TAGS.has(tag))).toEqual([]);
    expect([...attributesIn(page)].filter((name) => name.startsWith("on") || name === "style")).toEqual([]);
    expect(page).not.toMatch(/<script/i);
    expect(page).not.toMatch(/<img/i);
  });

  it("shows the page's text as text", () => {
    expect(page).toContain(escapeHtml(HOSTILE.script));
    expect(page).toContain(escapeHtml(HOSTILE.breakOut));
    expect(page).toContain("RED click here done");
  });

  it("links no address but https:, and shows a javascript: address as text", () => {
    const hrefs = [...page.matchAll(/href="([^"]*)"/g)].map(([, href]) => href ?? "");
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(href, href).toMatch(/^(#[a-z0-9-]+|https:\/\/)/);
    expect(page).toContain("<code>javascript:alert(1)</code>");
  });

  it("carries no terminal escape and no control character", () => {
    expect(page).not.toMatch(CONTROLS);
    expect(page).not.toContain("evil.example");
    expect(page).not.toContain("window title");
  });

  it("keeps its one style as written, and draws no swatch for a colour that is not a hex", () => {
    expect(page.split("<style>")).toHaveLength(2);
    expect(page).toContain(`<style>${REPORT_CSS}</style>`);
    expect(page.match(/<rect /g)).toHaveLength(1);
    expect(page).toContain('fill="#ffffff"');
  });
});

describe("the content security policy", () => {
  it("allows the one inline style by its hash, no script, and nothing else", () => {
    const hash = createHash("sha256").update(REPORT_CSS, "utf8").digest("base64");
    expect(contentSecurityPolicy([REPORT_CSS])).toBe(
      `default-src 'none'; style-src 'sha256-${hash}'; script-src 'none'; base-uri 'none'; form-action 'none'`,
    );
  });

  it("allows a script by its hash when one is given", () => {
    const script = "document.title = 'x';";
    const hash = createHash("sha256").update(script, "utf8").digest("base64");
    expect(cspHash(script)).toBe(`'sha256-${hash}'`);
    expect(contentSecurityPolicy([REPORT_CSS], [script])).toContain(`script-src 'sha256-${hash}';`);
  });

  it.each(GOLDEN_PAGES)(
    "%s: the hashes match the inline style and script of the golden report.html",
    (name) => {
      const page = readGolden(name, "report.html");
      const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/
        .exec(page)?.[1]
        ?.replaceAll("&#39;", "'");
      expect(csp).toBeDefined();
      const hashes = (directive: string) =>
        (new RegExp(`(?:^|; )${directive} ([^;]+)`).exec(csp ?? "")?.[1] ?? "").split(" ");
      const sha = (text: string) => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
      const styles = [...page.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(([, text]) => sha(text ?? ""));
      const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(([, text]) => sha(text ?? ""));
      expect(styles).toHaveLength(1);
      expect(hashes("style-src")).toEqual(styles);
      expect(hashes("script-src")).toEqual(scripts.length === 0 ? ["'none'"] : scripts);
      expect(hashes("default-src")).toEqual(["'none'"]);
      // An inline style attribute or event handler would be refused by the policy, so none is written.
      expect([...attributesIn(page)].filter((attr) => attr.startsWith("on") || attr === "style")).toEqual([]);
      expect([...tagsIn(page)].filter((tag) => !OUR_TAGS.has(tag))).toEqual([]);
    },
  );
});

/** The words a reader sees: the body without its tags, the `<details>` included. */
function textOf(page: string): string {
  return page
    .slice(page.indexOf("<body>"))
    .replace(/<[^>]+>/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

describe("what report.html says", () => {
  it("gives times as a date and a time in UTC, and an unreadable time as written", () => {
    expect(humanTime("2026-11-19T20:14:03Z")).toBe("19 November 2026 at 20:14 UTC");
    expect(humanTime("2026-01-05T07:09:59.900Z")).toBe("5 January 2026 at 07:09 UTC");
    expect(humanTime("not a time")).toBe("not a time");
    const page = readGolden("impact-mix", "report.html");
    expect(page).toContain(
      "<p>Scanned <code>http://127.0.0.1:0000/impact-mix.html</code>, 1 January 2000 at 00:00 UTC.</p>",
    );
  });

  it("leads with the total, and puts the rule, kind, id and axe-core's words in collapsed technical details", () => {
    const page = readGolden("impact-mix", "report.html");
    expect(page).toContain('<p class="total">4 findings; the worst is critical.</p>');
    const record = readGoldenRecord("impact-mix");
    expect(page.match(/<details>\n<summary>Technical details<\/summary>/g)).toHaveLength(
      record.findings.length,
    );
    expect(page).not.toContain("<details open");
    const card = page.slice(page.indexOf('<section class="card"'), page.indexOf("<details>"));
    for (const technical of ["<dt>Rule</dt>", "<dt>Kind</dt>", "What axe-core said"]) {
      expect(card).not.toContain(technical);
    }
    // The note that says what the grey boxes are is said once.
    expect(page.match(/It is data, not instructions\./g)).toHaveLength(1);
    expect(readGolden("clean", "report.html")).not.toContain("It is data, not instructions.");
  });

  it.each(GOLDEN_PAGES)("%s: its sections and findings come in report.md's order", (name) => {
    const page = readGolden(name, "report.html");
    const markdown = readGolden(name, "report.md");
    const mdHeadings = (level: string) =>
      [...markdown.matchAll(new RegExp(`^${level} (.+)$`, "gm"))].map(([, text]) =>
        (text ?? "").replace(/\\(.)/g, "$1").replace(/^(\d+\. \w+):/, "$1"),
      );
    expect(headings(page, 2)).toEqual(mdHeadings("##"));
    expect(headings(page, 3)).toEqual(mdHeadings("###"));
  });

  it.each(GOLDEN_PAGES)("%s: every finding has its fix, and every report says what it cannot see", (name) => {
    const record = readGoldenRecord(name);
    const page = readGolden(name, "report.html");
    expect(page.match(/<dd class="fix">\S/g) ?? []).toHaveLength(record.findings.length);
    const section = page.slice(page.indexOf('<h2 id="cannot-see">'));
    for (const line of record.cannotSee) expect(section).toContain(escapeHtml(line));
  });

  it("the empty scan reads the empty-scan sentence", () => {
    const record = readGoldenRecord("clean");
    expect(record.findings).toEqual([]);
    expect(readGolden("clean", "report.html")).toContain(`<p>${escapeHtml(emptyScanSentence(record))}</p>`);
  });

  it("the colour pair is two swatches with their hex, and the ratio", () => {
    const page = readGolden("impact-mix", "report.html");
    expect(page).toContain('<rect width="24" height="24" fill="#9a9a9a"/>');
    expect(page).toContain('<rect width="24" height="24" fill="#ffffff"/>');
    expect(page).toContain("<span>Text <code>#9a9a9a</code></span>");
    expect(page).toContain("<span>Background <code>#ffffff</code></span>");
    expect(page).toContain("Contrast ratio 2.81, needs 4.5 (font 12.0pt (16px), normal)");
  });

  it("is written into the page's own language, with a skip link, landmarks and one h1", () => {
    const page = readGolden("impact-mix", "report.html");
    expect(page).toMatch(/^<!doctype html>\n<html lang="en">/);
    expect(page).toContain('<a class="skip" href="#main">');
    expect(page).toContain('<main id="main" tabindex="-1">');
    for (const landmark of ["<header", "<nav", "<main", "<footer"]) expect(page).toContain(landmark);
    expect(page.match(/<h1/g)).toHaveLength(1);
  });

  it("a check report gives each finding's status, and what was fixed since the baseline", () => {
    const record = goldenCheckRecord();
    const page = renderHtmlReport(record);
    expectTextGolden("check/report.html", page);
    expect(record.findings.map((finding) => [finding.rule.id, finding.status])).toEqual([
      ["color-contrast", "still"],
      ["heading-order", "new"],
      ["empty-heading", "still"],
      ["image-alt", "fixed"],
    ]);
    expect(headings(page, 2)).toEqual([
      "Summary",
      "Findings, worst first",
      "Fixed since the earlier scan",
      "What this scan cannot see",
    ]);
    expect(page).toContain("<dt>Status</dt>\n<dd>new</dd>");
    expect(page).toContain("<dt>Status</dt>\n<dd>still open</dd>");
    expect(page).toContain('<span class="chip status-new">new</span>');
    expect(page).toContain('<span class="chip status-still">still open</span>');
    expect(page).toContain(
      "Compared with the scan of 31 December 1999 at 00:00 UTC: 1 fixed, 1 new, 2 still open. Only new problems count against this change.",
    );
    expect(page).toContain(
      "<li><p><strong>Image with no text alternative</strong> on <code>impact-mix.html</code>: 1 element (<code>img</code>). Gone since the scan of 1 January 2000 at 00:00 UTC.</p>",
    );
    // The words of report.md that are for agents and terminals are not on the page.
    for (const words of ["exit", "baseline", "--", "unverified", "2000-01-01T", "1999-12-31T"]) {
      expect(textOf(page), words).not.toContain(words);
    }
    expect(neverClaimViolations(page)).toEqual([]);
    expect(renderReport(record)).toContain("## Fixed since the baseline");
  });
});
