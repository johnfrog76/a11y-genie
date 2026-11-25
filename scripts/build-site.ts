/**
 * Builds the project's page: copies `site/` into a folder for GitHub Pages, and fills in the call to watch
 * the deck, or leaves it out.
 *
 * `site/index.html` holds one marker, `<!-- deck-cta -->`, where the deck's button goes. With `DECK_URL` set,
 * the button to watch the deck goes there, before the repository's. Emptied, the marker is taken out and the
 * page has no deck button at all, so there is never a link to nowhere. The page is published only once the
 * repository is public (pages.yml, which also puts the deck page beside it at deck/, the address the button
 * opens).
 *
 * It also fills a second marker, `<!-- share-tags -->`, with the Open Graph and Twitter tags a link preview reads.
 * A preview needs whole addresses, so the page's own address is set once, in `SITE_URL`, and every tag is built
 * from it and from `SHARE_IMAGE`, the picture in `site/`.
 *
 * Run it with `npm run site` (or `node scripts/build-site.ts [folder]`); it writes `_site/` by default.
 * test/unit/site.test.ts checks both cases.
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * The product deck's address, set here and only here: the deck page `web/` builds, which Pages serves at `deck/`
 * beside this page (docs/DECK.md). Emptied, the page has no deck button at all.
 */
export const DECK_URL: string = "deck/";

/** The one address that is not an https: one: the deck page beside this one. */
export const DECK_PAGE = "deck/";

/** The marker in `site/index.html` the deck's button replaces. */
export const DECK_MARKER = "<!-- deck-cta -->";

/** The deck button's words. */
export const DECK_LABEL = "Watch the video";

export const SITE_DIR = fileURLToPath(new URL("../site/", import.meta.url));

/** The page's own address once published, set here and only here. Every share tag's address is built from it. */
export const SITE_URL = "https://johnfrog76.github.io/a11y-genie/";

/** The marker in `site/index.html` the share tags replace. */
export const SHARE_MARKER = "<!-- share-tags -->";

/** The picture a link preview shows, a file in `site/` (1200 by 630 pixels). */
export const SHARE_IMAGE = "a11y-genie-share-1200x630.png";

/** What the picture shows, for someone who cannot see it. */
export const SHARE_IMAGE_ALT =
  "The name A11y Genie in large gold letters above a smiling genie floating on a red-and-teal magic carpet " +
  "across a moonlit night stage, with a glowing glass bottle on the shelf below.";

/** The words of a link preview. */
export const SHARE_TITLE = "A11y Genie";
export const SHARE_DESCRIPTION = "An accessibility scanner for agents and people.";

function attribute(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** The share tags, one per line at `indent`, each with a whole https: address where it takes one. */
export function shareTags(indent: string, base: string = SITE_URL): string {
  if (!/^https:\/\/[^\s"'<>]+\/$/.test(base)) {
    throw new Error(
      `SITE_URL must be an https: address ending in a slash, with no spaces, quotes or angle brackets: ${base}`,
    );
  }
  const tags: [string, string, string][] = [
    ["property", "og:title", SHARE_TITLE],
    ["property", "og:description", SHARE_DESCRIPTION],
    ["property", "og:type", "website"],
    ["property", "og:url", base],
    ["property", "og:image", new URL(SHARE_IMAGE, base).href],
    ["property", "og:image:alt", SHARE_IMAGE_ALT],
    ["name", "twitter:card", "summary_large_image"],
  ];
  return tags
    .map(([kind, key, value]) => `${indent}<meta ${kind}="${key}" content="${attribute(value)}" />`)
    .join("\n");
}

/** The page's HTML with its share tags, and with the deck button filled in, or none when `deckUrl` is empty. */
export function renderIndex(html: string, deckUrl: string = DECK_URL): string {
  for (const marker of [SHARE_MARKER, DECK_MARKER]) {
    const count = html.split(marker).length - 1;
    if (count !== 1) throw new Error(`site/index.html must hold ${marker} exactly once, not ${count} times`);
  }
  html = html.replace(new RegExp(`^([ \\t]*)${SHARE_MARKER}`, "m"), (_line, indent: string) =>
    shareTags(indent),
  );
  if (deckUrl === "") {
    // Take out the marker's whole line, so the built page has no trace of it.
    return html.replace(new RegExp(`^[ \\t]*${DECK_MARKER}\\r?\\n`, "m"), "").replace(DECK_MARKER, "");
  }
  if (deckUrl !== DECK_PAGE && !/^https:\/\/[^\s"'<>]+$/.test(deckUrl)) {
    throw new Error(
      `DECK_URL must be ${DECK_PAGE}, or an https: address with no spaces, quotes or angle brackets: ${deckUrl}`,
    );
  }
  const button = `<a class="lp-cta-button" data-cta="deck" href="${deckUrl.replaceAll("&", "&amp;")}">${DECK_LABEL}</a>`;
  return html.replace(DECK_MARKER, button);
}

/** Writes the page into `out`, replacing whatever was there. */
export function buildSite(out: string, deckUrl: string = DECK_URL, from: string = SITE_DIR): void {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(from, out, { recursive: true });
  const index = join(out, "index.html");
  writeFileSync(index, renderIndex(readFileSync(index, "utf8"), deckUrl));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const out = resolve(process.argv[2] ?? "_site");
  buildSite(out);
  console.log(`Built the page into ${out}${DECK_URL === "" ? ", with no deck button yet" : ""}.`);
}
