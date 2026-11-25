import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
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
  SITE_DIR,
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
