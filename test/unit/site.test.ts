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
  SHARE_IMAGE,
  SHARE_IMAGE_ALT,
  SHARE_MARKER,
  shareTags,
  SITE_DIR,
  SITE_URL,
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

/** Each `<meta>` in the page, by its `property` or `name`, with its `content` read back from the attribute. */
function metas(html: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const [tag] of html.matchAll(/<meta\s[^>]*>/g)) {
    const key = /(?:property|name)="([^"]*)"/.exec(tag)?.[1];
    const content = /content="([^"]*)"/.exec(tag)?.[1];
    if (key === undefined || content === undefined) continue;
    const value = content
      .replaceAll("&quot;", '"')
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&amp;", "&");
    found.set(key, [...(found.get(key) ?? []), value]);
  }
  return found;
}

describe("the link preview (Open Graph and Twitter tags)", () => {
  const out = mkdtempSync(join(tmpdir(), "a11y-genie-site-"));
  afterAll(() => rmSync(out, { recursive: true, force: true }));

  it("the built page holds every tag once, each address whole and built from SITE_URL", () => {
    buildSite(out);
    const tags = metas(readFileSync(join(out, "index.html"), "utf8"));
    const expected: Record<string, string> = {
      "og:title": "A11y Genie",
      "og:description": "An accessibility scanner for agents and people.",
      "og:type": "website",
      "og:url": "https://johnfrog76.github.io/a11y-genie/",
      "og:image": "https://johnfrog76.github.io/a11y-genie/a11y-genie-share-1200x630.png",
      "og:image:alt": SHARE_IMAGE_ALT,
      "twitter:card": "summary_large_image",
    };
    for (const [key, value] of Object.entries(expected)) expect(tags.get(key), key).toEqual([value]);
    expect(SITE_URL).toBe("https://johnfrog76.github.io/a11y-genie/");
    for (const key of ["og:url", "og:image"]) {
      const address = new URL(tags.get(key)?.[0] ?? "");
      expect(address.protocol, key).toBe("https:");
      expect(address.href.startsWith(SITE_URL), key).toBe(true);
    }
    expect(SHARE_IMAGE_ALT).toMatch(/^The name A11y Genie .+ on the shelf below\.$/);
  });

  it("the picture it names is in the built folder, a 1200 by 630 PNG, the same bytes as in site/", () => {
    buildSite(out);
    const built = readFileSync(join(out, SHARE_IMAGE));
    expect(built.equals(readFileSync(join(SITE_DIR, SHARE_IMAGE)))).toBe(true);
    expect(built.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(built.subarray(12, 16).toString("latin1")).toBe("IHDR");
    expect([built.readUInt32BE(16), built.readUInt32BE(20)]).toEqual([1200, 630]);
  });

  it("needs its marker in site/index.html exactly once, and leaves no marker in the built page", () => {
    expect(source.split(SHARE_MARKER)).toHaveLength(2);
    expect(() => renderIndex(source.replace(SHARE_MARKER, ""))).toThrow(/exactly once/);
    expect(renderIndex(source)).not.toContain(SHARE_MARKER);
  });

  it("refuses a SITE_URL that is not a whole https: address ending in a slash", () => {
    for (const bad of [
      "http://example.com/",
      "https://example.com",
      "/a11y-genie/",
      'https://x/"><script>/',
    ]) {
      expect(() => shareTags("", bad), bad).toThrow(/SITE_URL/);
    }
  });

  it("claims nothing in the preview's words", () => {
    const words = [...metas(renderIndex(source)).entries()]
      .filter(([key]) => key.startsWith("og:") && key !== "og:url" && key !== "og:image")
      .map(([, values]) => values.join(" "))
      .join("\n");
    expect(neverClaimViolations(words)).toEqual([]);
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
