/**
 * Builds the project's page: copies `site/` into a folder for GitHub Pages, and fills in the call to watch
 * the deck, or leaves it out.
 *
 * `site/index.html` holds one marker, `<!-- deck-cta -->`, where the deck's button goes. With `DECK_URL` set,
 * the button to watch the deck goes there, before the repository's. Emptied, the marker is taken out and the
 * page has no deck button at all, so there is never a link to nowhere. The page is published only once the
 * repository is public (pages.yml, which also puts the deck page beside it at deck/); `DECK_URL` stays empty
 * until the deck is published too.
 *
 * Run it with `npm run site` (or `node scripts/build-site.ts [folder]`); it writes `_site/` by default.
 * test/unit/site.test.ts checks both cases.
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * The product-intro deck's address, set here and only here. It stays empty, and the page has no deck button,
 * until the deck is published. Then this one line becomes `"https://css-wasteland.com/decks/a11y-genie"`.
 */
export const DECK_URL: string = "";

/** The marker in `site/index.html` the deck's button replaces. */
export const DECK_MARKER = "<!-- deck-cta -->";

/** The deck button's words. */
export const DECK_LABEL = "Watch the deck";

export const SITE_DIR = fileURLToPath(new URL("../site/", import.meta.url));

/** The page's HTML with the deck button filled in, or with no deck button when `deckUrl` is empty. */
export function renderIndex(html: string, deckUrl: string = DECK_URL): string {
  const markers = html.split(DECK_MARKER).length - 1;
  if (markers !== 1)
    throw new Error(`site/index.html must hold ${DECK_MARKER} exactly once, not ${markers} times`);
  if (deckUrl === "") {
    // Take out the marker's whole line, so the built page has no trace of it.
    return html.replace(new RegExp(`^[ \\t]*${DECK_MARKER}\\r?\\n`, "m"), "").replace(DECK_MARKER, "");
  }
  if (!/^https:\/\/[^\s"'<>]+$/.test(deckUrl)) {
    throw new Error(
      `DECK_URL must be an https: address with no spaces, quotes or angle brackets: ${deckUrl}`,
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
