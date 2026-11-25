import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  buildSite,
  DECK_LABEL,
  DECK_MARKER,
  DECK_PAGE,
  DECK_URL,
  renderIndex,
  REPO_ROOT,
  SITE_DIR,
  unsafeOutFolder,
} from "../../scripts/build-site.js";
import { neverClaimViolations } from "../helpers/never-claim.js";

// The project's page (site/) and its build (scripts/build-site.ts). DECK_URL is the deck page beside it, deck/
// (#139): the calls to action are the deck, then the repository. Emptied, the page has no deck link at all.
const source = readFileSync(join(SITE_DIR, "index.html"), "utf8");

/** The `href` of every call-to-action button, in order, with its `data-cta`. */
function ctas(html: string): { cta: string; href: string }[] {
  return [...html.matchAll(/<a\s[^>]*class="lp-cta-button[^"]*"[^>]*>/g)].map(([tag]) => ({
    cta: /data-cta="([^"]*)"/.exec(tag)?.[1] ?? "",
    href: /href="([^"]*)"/.exec(tag)?.[1] ?? "",
  }));
}

describe("the deck button", () => {
  it("opens the deck page beside the project's page, deck/, first, with the repository second", () => {
    expect(DECK_URL).toBe(DECK_PAGE);
    expect(DECK_PAGE).toBe("deck/");
    const html = renderIndex(source);
    expect(ctas(html)).toEqual([
      { cta: "deck", href: "deck/" },
      { cta: "repository", href: "https://github.com/johnfrog76/a11y-genie" },
    ]);
    expect(html).toContain(`>${DECK_LABEL}</a>`);
    expect(DECK_LABEL).toBe("Watch the video");
    expect(html).not.toContain("css-wasteland.com");
  });

  it("leaves no deck link at all when DECK_URL is emptied, and the repository is the only call to action", () => {
    const html = renderIndex(source, "");
    expect(html).not.toContain(DECK_MARKER);
    expect(html).not.toContain(DECK_LABEL);
    expect(html).not.toContain('data-cta="deck"');
    expect(ctas(html)).toEqual([{ cta: "repository", href: "https://github.com/johnfrog76/a11y-genie" }]);
  });

  it("once set, comes first, filled, with the repository second", () => {
    const html = renderIndex(source, "https://example.com/deck/?a=1&b=2");
    expect(ctas(html)).toEqual([
      { cta: "deck", href: "https://example.com/deck/?a=1&amp;b=2" },
      { cta: "repository", href: "https://github.com/johnfrog76/a11y-genie" },
    ]);
    expect(html).toContain(`class="lp-cta-button" data-cta="deck"`);
    expect(html).toContain("lp-cta-button lp-cta-button--secondary");
  });

  it("refuses an address that is not https: or deck/, or that could break out of the attribute", () => {
    for (const bad of [
      "http://example.com/",
      "javascript:alert(1)",
      'https://example.com/"><script>',
      "../deck/",
      "deck",
      "deck/../../x",
    ]) {
      expect(() => renderIndex(source, bad)).toThrow(/DECK_URL/);
    }
  });

  it("needs the marker in site/index.html exactly once", () => {
    expect(source.split(DECK_MARKER)).toHaveLength(2);
    expect(() => renderIndex(source.replace(DECK_MARKER, ""))).toThrow(/exactly once/);
  });
});

describe("the build", () => {
  const out = mkdtempSync(join(tmpdir(), "a11y-genie-site-"));
  afterAll(() => rmSync(out, { recursive: true, force: true }));

  it("copies every file in site/ and writes index.html with the deck button opening deck/", () => {
    buildSite(out);
    expect(readdirSync(out).sort()).toEqual(readdirSync(SITE_DIR).sort());
    const built = readFileSync(join(out, "index.html"), "utf8");
    expect(built).toBe(renderIndex(source));
    expect(ctas(built)[0]).toEqual({ cta: "deck", href: "deck/" });
    expect(built).not.toContain("css-wasteland.com");
  });

  it("leaves the deck button out when the build is given no address", () => {
    const without = mkdtempSync(join(tmpdir(), "a11y-genie-site-"));
    try {
      buildSite(without, "");
      expect(readFileSync(join(without, "index.html"), "utf8")).not.toContain('data-cta="deck"');
    } finally {
      rmSync(without, { recursive: true, force: true });
    }
  });

  it("brings the deck button back when the build is given the deck's address", () => {
    const withDeck = mkdtempSync(join(tmpdir(), "a11y-genie-site-"));
    try {
      buildSite(withDeck, "https://css-wasteland.com/decks/a11y-genie");
      expect(ctas(readFileSync(join(withDeck, "index.html"), "utf8"))).toEqual([
        { cta: "deck", href: "https://css-wasteland.com/decks/a11y-genie" },
        { cta: "repository", href: "https://github.com/johnfrog76/a11y-genie" },
      ]);
    } finally {
      rmSync(withDeck, { recursive: true, force: true });
    }
  });
});

describe("the page's own words", () => {
  it.each(readdirSync(SITE_DIR))("site/%s claims nothing", (name) => {
    expect(neverClaimViolations(readFileSync(join(SITE_DIR, name), "utf8"))).toEqual([]);
  });

  it("and the deck button's words claim nothing", () => {
    expect(neverClaimViolations(DECK_LABEL)).toEqual([]);
  });
});

describe("the build's output folder", () => {
  const scratch: string[] = [];
  afterAll(() => {
    for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  });

  it("refuses the repository root, site/, a folder inside site/ and a parent of the repository", () => {
    for (const out of [
      REPO_ROOT,
      SITE_DIR,
      join(SITE_DIR, "nested"),
      join(REPO_ROOT, ".."),
      join(REPO_ROOT, "x", ".."),
    ]) {
      expect(unsafeOutFolder(out), out).toMatch(/^Refusing /);
      expect(() => buildSite(out), out).toThrow(/^Refusing /);
    }
    expect(readFileSync(join(SITE_DIR, "index.html"), "utf8")).toBe(source);
  });

  it("refuses any folder of the repository but _site", () => {
    for (const out of [join(REPO_ROOT, "src"), join(REPO_ROOT, "docs"), join(REPO_ROOT, "_site2")]) {
      expect(unsafeOutFolder(out), out).toMatch(/^Refusing .*only _site may be emptied/);
    }
    expect(unsafeOutFolder(join(REPO_ROOT, "_site", "inner"))).toBeUndefined();
  });

  it("refuses a link that leads to site/", () => {
    const dir = mkdtempSync(join(tmpdir(), "a11y-genie-site-"));
    scratch.push(dir);
    const link = join(dir, "link");
    symlinkSync(SITE_DIR, link, "dir");
    expect(unsafeOutFolder(link)).toMatch(/^Refusing /);
    expect(unsafeOutFolder(join(link, "deeper"))).toMatch(/^Refusing /);
  });

  it("exits non-zero from the command before deleting anything", () => {
    const result = spawnSync(process.execPath, [join(REPO_ROOT, "scripts", "build-site.ts"), SITE_DIR], {
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^Refusing /);
    expect(readFileSync(join(SITE_DIR, "index.html"), "utf8")).toBe(source);
  });

  it("still builds into a fresh folder, and into one that does not exist yet", () => {
    const dir = mkdtempSync(join(tmpdir(), "a11y-genie-site-"));
    scratch.push(dir);
    expect(unsafeOutFolder(dir)).toBeUndefined();
    expect(unsafeOutFolder(join(REPO_ROOT, "_site"))).toBeUndefined();
    buildSite(join(dir, "later"));
    expect(readFileSync(join(dir, "later", "index.html"), "utf8")).toContain(DECK_LABEL);
  });
});
